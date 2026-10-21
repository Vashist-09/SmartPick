-- One-time data migration for the physical layout change.
-- Coordinate mapping is a transpose that preserves the six existing compartment IDs:
-- old (slot, compartment) -> new (slot, compartment)
-- (1,1)->(1,1), (1,2)->(2,1), (1,3)->(3,1)
-- (2,1)->(1,2), (2,2)->(2,2), (2,3)->(3,2)
-- Parcel and event foreign keys remain attached to their original compartment IDs.

BEGIN;

LOCK TABLE slots, compartments IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM slots) <> 2
     OR EXISTS (SELECT 1 FROM slots WHERE slot_no NOT IN (1, 2)) THEN
    RAISE EXCEPTION 'Expected exactly slots 1 and 2 before the layout migration';
  END IF;

  IF (SELECT COUNT(*) FROM compartments) <> 6
     OR EXISTS (
       SELECT s.slot_no
       FROM slots s
       LEFT JOIN compartments c USING (slot_id)
       GROUP BY s.slot_no
       HAVING COUNT(c.compartment_id) <> 3
          OR ARRAY_AGG(c.compartment_no ORDER BY c.compartment_no) <> ARRAY[1, 2, 3]
     ) THEN
    RAISE EXCEPTION 'Expected compartments 1, 2, and 3 in each existing slot';
  END IF;
END $$;

INSERT INTO slots (slot_no, slot_name, slot_status)
VALUES (3, 'Slot 3', 'ACTIVE');

-- Move numbers to a positive temporary range to avoid collisions with the unique
-- (slot_id, compartment_no) constraint while slot membership is transposed.
UPDATE compartments c
SET compartment_no = c.compartment_no + 100
FROM slots s
WHERE c.slot_id = s.slot_id
  AND s.slot_no IN (1, 2);

WITH coordinate_map AS (
  SELECT c.compartment_id,
         origin.slot_no AS new_compartment_no,
         destination.slot_id AS new_slot_id
  FROM compartments c
  JOIN slots origin ON origin.slot_id = c.slot_id
  JOIN slots destination ON destination.slot_no = c.compartment_no - 100
  WHERE origin.slot_no IN (1, 2)
)
UPDATE compartments c
SET slot_id = m.new_slot_id,
    compartment_no = m.new_compartment_no
FROM coordinate_map m
WHERE c.compartment_id = m.compartment_id;

COMMIT;

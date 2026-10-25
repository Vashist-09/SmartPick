import { Router } from 'express';
import { pool } from '../db';
import { requireOperator } from '../middleware/auth';

const router = Router();
router.get('/', requireOperator, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT s.slot_id,s.slot_no,s.slot_name,s.slot_status,c.compartment_id,c.compartment_no,c.occupancy_status,p.parcel_id,p.tracking_id,p.parcel_status,p.payment_type
      FROM slots s LEFT JOIN compartments c USING(slot_id) LEFT JOIN parcels p ON p.compartment_id=c.compartment_id AND p.parcel_status='STORED' ORDER BY s.slot_no,c.compartment_no`);
    const slots = new Map<string, { slotId:string; slotNo:number; slotName:string; status:string; compartments:unknown[] }>();
    for (const r of rows) {
      if (!slots.has(r.slot_id)) slots.set(r.slot_id, { slotId:r.slot_id,slotNo:r.slot_no,slotName:r.slot_name,status:r.slot_status,compartments:[] });
      if (r.compartment_id) slots.get(r.slot_id)!.compartments.push({ compartmentId:r.compartment_id,compartmentNo:r.compartment_no,occupancyStatus:r.occupancy_status,parcel:r.parcel_id ? {parcelId:r.parcel_id,trackingId:r.tracking_id,status:r.parcel_status,paymentType:r.payment_type} : null });
    }
    res.json([...slots.values()]);
  } catch (error) { next(error); }
});
export default router;

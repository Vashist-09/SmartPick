import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db';
import { requireOperator } from '../middleware/auth';
import { registrationSchema } from '../schemas';
import { resolveStudent } from '../students';

const router = Router();
const asyncRoute = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };
router.use(requireOperator);

// GET /api/students/:registrationNo/parcels
// 200 {registrationNo, parcels[]} for a known student (parcels may be empty), 404 for an unknown
// registration number, 409 if a case-insensitive match is ambiguous, 400 for malformed input.
router.get('/:registrationNo/parcels', asyncRoute(async (req, res) => {
  const input = registrationSchema.safeParse(req.params.registrationNo);
  if (!input.success) return res.status(400).json({ error: input.error.issues[0]?.message ?? 'Invalid registration number' });
  const match = await resolveStudent(pool, input.data);
  if (match.kind === 'none') return res.status(404).json({ error: 'No student with that registration number' });
  if (match.kind === 'ambiguous') return res.status(409).json({ error: 'More than one student matches that registration number when letter case is ignored. Enter it exactly as registered.' });
  const { rows } = await pool.query(
    `SELECT p.parcel_id, p.tracking_id, p.parcel_status, p.compartment_id, s.slot_no, c.compartment_no
       FROM parcels p LEFT JOIN compartments c USING (compartment_id) LEFT JOIN slots s USING (slot_id)
      WHERE p.student_id = $1 ORDER BY p.created_at DESC`, [match.studentId]);
  res.json({ registrationNo: match.registrationNo, parcels: rows });
}));

export default router;

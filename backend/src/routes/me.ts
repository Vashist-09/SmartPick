import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { requireAccount, requireStudent } from '../middleware/auth';
import { route, parse, id } from '../http';
import { parcelSelect, ownedParcel, workflowTx } from '../workflows';
const router = Router();
router.use(requireAccount);
router.get('/', route(async (req, res) => res.json(req.account)));
router.patch('/', route(async (req, res) => {
    const b = parse(z.object({ fullName: z.string().trim().min(2).max(80), phone: z.string().trim().max(30), notificationsEnabled: z.boolean() }), req.body);
    await pool.query(`UPDATE app_accounts SET full_name=$2,phone=$3,notifications_enabled=$4 WHERE account_id=$1`, [req.account!.account_id, b.fullName, b.phone, b.notificationsEnabled]);
    res.json({ status: 'SAVED' });
}));
router.get('/parcels', requireStudent, route(async (req, res) => {
    const page = Math.max(0, Number(req.query.page) || 0);
    const { rows } = await pool.query(`${parcelSelect} WHERE upper(st.registration_no)=$1 ORDER BY p.created_at DESC,p.parcel_id LIMIT 50 OFFSET $2`, [req.account!.registration_no, Math.min(page, 10000) * 50]);
    res.json(rows);
}));
router.get('/parcels/:parcelId', requireStudent, route(async (req, res) => res.json(await workflowTx(c => ownedParcel(c, parse(id, req.params.parcelId), req.account!)))));
router.get('/activity', requireStudent, route(async (req, res) => {
    const page = Math.max(0, Number(req.query.page) || 0);
    const { rows } = await pool.query(`SELECT a.audit_id,a.event_type,a.details,a.created_at,p.tracking_id FROM app_audit a JOIN parcels p USING(parcel_id) JOIN students st USING(student_id) WHERE upper(st.registration_no)=$1 ORDER BY a.created_at DESC LIMIT 50 OFFSET $2`, [req.account!.registration_no, Math.min(page, 10000) * 50]);
    res.json(rows);
}));
router.get('/notifications', route(async (req, res) => {
    const { rows } = await pool.query(`SELECT notification_id,subject,body,read_at,created_at FROM app_notifications WHERE account_id=$1 AND kind NOT IN ('VERIFY','RESET') ORDER BY created_at DESC LIMIT 50`, [req.account!.account_id]);
    res.json(rows);
}));
router.post('/notifications/:notificationId/read', route(async (req, res) => {
    await pool.query(`UPDATE app_notifications SET read_at=now() WHERE notification_id=$1 AND account_id=$2`, [parse(id, req.params.notificationId), req.account!.account_id]);
    res.json({ status: 'READ' });
}));
export default router;

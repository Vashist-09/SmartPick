import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { requireOperator } from '../middleware/auth';
import { route, parse, id, registration, HttpError } from '../http';
import { workflowTx, audit, parcelSelect } from '../workflows';
import { enqueue } from '../mail';
import { challenge } from './auth';
const router = Router();
router.use(requireOperator);
router.get('/students/:registrationNo/parcels', route(async (req, res) => {
    const { rows } = await pool.query(`${parcelSelect} WHERE upper(st.registration_no)=$1 ORDER BY p.created_at DESC LIMIT 100`, [parse(registration, req.params.registrationNo)]);
    res.json(rows);
}));
router.get('/accounts/pending', route(async (_req, res) => {
    const { rows } = await pool.query(`SELECT account_id,email,registration_no,full_name,email_verified_at,created_at FROM app_accounts WHERE role='STUDENT' AND approved_at IS NULL ORDER BY created_at LIMIT 100`);
    res.json(rows);
}));
router.post('/accounts/:accountId/approve', route(async (req, res) => {
    const b = parse(z.object({ reason: z.string().trim().min(5).max(500) }), req.body);
    await workflowTx(async (c) => {
        const aid = parse(id, req.params.accountId);
        const { rows } = await c.query(`SELECT * FROM app_accounts WHERE account_id=$1 AND role='STUDENT' FOR UPDATE`, [aid]);
        const a = rows[0];
        if (!a)
            throw new HttpError(404, 'Account not found.');
        if (!a.email_verified_at)
            throw new HttpError(409, 'Student must verify their email first.');
        if (a.approved_at)
            return;
        const student = await c.query(`SELECT student_id FROM students WHERE upper(registration_no)=$1`, [a.registration_no]);
        if (student.rowCount !== 1)
            throw new HttpError(409, 'Registration must match exactly one existing student. Register the incoming parcel first if needed.');
        const existing = await c.query(`SELECT 1 FROM app_accounts WHERE registration_no=$1 AND approved_at IS NOT NULL AND account_id<>$2`, [a.registration_no, aid]);
        if (existing.rowCount)
            throw new HttpError(409, 'This student identity is already approved for another account.');
        await c.query(`UPDATE app_accounts SET approved_at=now(),approved_by=$2 WHERE account_id=$1`, [aid, req.account!.account_id]);
        await audit(c, req.account!.account_id, null, 'IDENTITY_APPROVED', { accountId: aid, registration: a.registration_no, reason: b.reason });
        await enqueue(c, aid, a.email, 'Student identity approved', 'Your student identity was approved. Log in to see your parcels.', 'IDENTITY_APPROVED');
    });
    res.json({ status: 'APPROVED' });
}));
router.get('/devices/status', route(async (_req, res) => {
    const { rows } = await pool.query(`SELECT device_id,last_seen_at,(last_seen_at>now()-interval '30 seconds') AS online FROM hardware_devices ORDER BY created_at`);
    res.json(rows);
}));
router.get('/accounts/find', route(async (req, res) => {
    const email = parse(z.string().trim().email().transform(s => s.toLowerCase()), req.query.email);
    const { rows } = await pool.query(`SELECT account_id,email,registration_no,full_name,email_verified_at,approved_at FROM app_accounts WHERE email=$1 AND role='STUDENT'`, [email]);
    if (!rows[0])
        throw new HttpError(404, 'Student account not found.');
    res.json(rows[0]);
}));
router.patch('/accounts/:accountId/identity', route(async (req, res) => {
    const b = parse(z.object({ email: z.string().trim().email().max(254).transform(s => s.toLowerCase()), registrationNo: registration, reason: z.string().trim().min(5).max(500) }), req.body);
    try {
        await workflowTx(async (c) => {
            const aid = parse(id, req.params.accountId);
            const { rows } = await c.query(`SELECT * FROM app_accounts WHERE account_id=$1 AND role='STUDENT' FOR UPDATE`, [aid]);
            const a = rows[0];
            if (!a)
                throw new HttpError(404, 'Student account not found.');
            const emailChanged = a.email !== b.email;
            await c.query(`UPDATE app_accounts SET email=$2,registration_no=$3,approved_at=NULL,approved_by=NULL,email_verified_at=CASE WHEN $4 THEN NULL ELSE email_verified_at END WHERE account_id=$1`, [aid, b.email, b.registrationNo, emailChanged]);
            await c.query(`DELETE FROM app_sessions WHERE account_id=$1`, [aid]);
            await c.query(`DELETE FROM app_challenges WHERE account_id=$1`, [aid]);
            await c.query(`UPDATE app_notifications SET body='Identity changed',status='SENT' WHERE account_id=$1 AND kind IN ('VERIFY','RESET') AND status IN ('PENDING','FAILED')`, [aid]);
            if (emailChanged)
                await challenge(c, { ...a, email: b.email }, 'VERIFY');
            await audit(c, req.account!.account_id, null, 'IDENTITY_CORRECTED', { accountId: aid, previousRegistration: a.registration_no, registration: b.registrationNo, reason: b.reason });
        });
    }
    catch (e) {
        if ((e as any).code === '23505')
            throw new HttpError(409, 'That email is already in use.');
        throw e;
    }
    res.json({ status: 'APPROVAL_REQUIRED' });
}));
router.get('/commands/:commandId', route(async (req, res) => {
    const { rows } = await pool.query(`SELECT command_id,parcel_id,command_status,created_at,acknowledged_at,completed_at FROM hardware_commands WHERE command_id=$1`, [parse(id, req.params.commandId)]);
    if (!rows[0])
        throw new HttpError(404, 'Command not found.');
    res.json(rows[0]);
}));
router.get('/activity', route(async (req, res) => {
    const page = Math.max(0, Number(req.query.page) || 0);
    const { rows } = await pool.query(`SELECT a.*,p.tracking_id FROM app_audit a LEFT JOIN parcels p USING(parcel_id) ORDER BY a.created_at DESC LIMIT 50 OFFSET $1`, [Math.min(page, 10000) * 50]);
    res.json(rows);
}));
router.get('/notifications', route(async (_req, res) => {
    const { rows } = await pool.query(`SELECT notification_id,subject,kind,status,attempts,created_at FROM app_notifications WHERE kind NOT IN ('VERIFY','RESET') ORDER BY created_at DESC LIMIT 50`);
    res.json(rows);
}));
router.post('/notifications/:notificationId/retry', route(async (req, res) => {
    await pool.query(`UPDATE app_notifications SET status='PENDING',attempts=0,available_at=now() WHERE notification_id=$1 AND status='FAILED' AND kind NOT IN ('VERIFY','RESET')`, [parse(id, req.params.notificationId)]);
    res.json({ status: 'QUEUED' });
}));
export default router;

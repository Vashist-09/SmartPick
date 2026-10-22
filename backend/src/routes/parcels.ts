import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { requireOperator } from '../middleware/auth';
import { route, parse, id, registration, HttpError } from '../http';
import { parcelSelect, workflowTx, audit, createPickup, collect, ownedParcel } from '../workflows';
import { enqueue } from '../mail';
const router = Router();
router.use(requireOperator);
router.get('/', route(async (req, res) => {
    const status = parse(z.enum(['REGISTERED', 'STORED', 'COLLECTED']).default('REGISTERED'), req.query.status);
    const page = Math.max(0, Number(req.query.page) || 0);
    const { rows } = await pool.query(`${parcelSelect} WHERE p.parcel_status=$1 AND p.workflow_status='ACTIVE' ORDER BY p.created_at,p.parcel_id LIMIT 50 OFFSET $2`, [status, Math.min(page, 10000) * 50]);
    res.json(rows);
}));
router.get('/:parcelId', route(async (req, res) => res.json(await workflowTx(c => ownedParcel(c, parse(id, req.params.parcelId), req.account!)))));
router.post('/', route(async (req, res) => {
    const b = parse(z.object({ registrationNo: registration, studentName: z.string().trim().min(2).max(80), trackingId: z.string().trim().min(1).max(100), paymentType: z.enum(['PREPAID', 'COD']) }), req.body);
    try {
        const out = await workflowTx(async (c) => {
            // Reuse existing identity without silently renaming a student.
            const found = await c.query(`SELECT student_id FROM students WHERE upper(registration_no)=$1`, [b.registrationNo]);
            if (found.rowCount && found.rowCount > 1)
                throw new HttpError(409, 'Duplicate student identities require staff reconciliation.');
            let student = found.rows[0]?.student_id;
            if (!student) {
                const { rows } = await c.query(`INSERT INTO students(registration_no,student_name) VALUES($1,$2) RETURNING student_id`, [b.registrationNo, b.studentName]);
                student = rows[0].student_id;
            }
            const { rows } = await c.query(`INSERT INTO parcels(tracking_id,student_id,parcel_status,payment_type,payment_status) VALUES($1,$2,'REGISTERED',$3,$4) RETURNING parcel_id,tracking_id,parcel_status`, [b.trackingId, student, b.paymentType, b.paymentType === 'COD' ? 'PENDING' : 'PAID']);
            await audit(c, req.account!.account_id, rows[0].parcel_id, 'REGISTERED');
            return rows[0];
        });
        res.status(201).json(out);
    }
    catch (e) {
        if ((e as any).code === '23505')
            throw new HttpError(409, 'Tracking ID already exists.');
        throw e;
    }
}));
router.post('/:parcelId/store', route(async (req, res) => {
    const parcelId = parse(id, req.params.parcelId), b = parse(z.object({ compartmentId: id }), req.body);
    await workflowTx(async (c) => {
        const p = await c.query(`SELECT * FROM parcels WHERE parcel_id=$1 FOR UPDATE`, [parcelId]);
        if (!p.rows[0])
            throw new HttpError(404, 'Parcel not found.');
        if (p.rows[0].workflow_status !== 'ACTIVE' || p.rows[0].parcel_status !== 'REGISTERED')
            throw new HttpError(409, 'Parcel is not registered.');
        const comp = await c.query(`SELECT c.*,s.slot_status,s.slot_no FROM compartments c JOIN slots s USING(slot_id) WHERE compartment_id=$1 FOR UPDATE OF c`, [b.compartmentId]);
        const loc = comp.rows[0];
        if (!loc)
            throw new HttpError(404, 'Compartment not found.');
        if (loc.occupancy_status !== 'EMPTY' || loc.slot_status !== 'ACTIVE')
            throw new HttpError(409, 'Compartment is no longer available.');
        await c.query(`UPDATE parcels SET compartment_id=$2,parcel_status='STORED',stored_at=now() WHERE parcel_id=$1`, [parcelId, b.compartmentId]);
        await c.query(`UPDATE compartments SET occupancy_status='OCCUPIED' WHERE compartment_id=$1`, [b.compartmentId]);
        await audit(c, req.account!.account_id, parcelId, 'STORED', { slot: loc.slot_no, compartment: loc.compartment_no });
        await c.query(`INSERT INTO activity_logs(parcel_id,student_id,slot_id,compartment_id,event_type,details) VALUES($1,$2,$3,$4,'PARCEL_STORED',$5)`, [parcelId, p.rows[0].student_id, loc.slot_id, b.compartmentId, { slotNo: loc.slot_no, compartmentNo: loc.compartment_no }]);
        const { rows: accounts } = await c.query(`SELECT a.* FROM app_accounts a JOIN students st ON upper(st.registration_no)=a.registration_no WHERE st.student_id=$1 AND a.approved_at IS NOT NULL AND a.email_verified_at IS NOT NULL AND a.notifications_enabled=true`, [p.rows[0].student_id]);
        for (const a of accounts)
            await enqueue(c, a.account_id, a.email, 'Your parcel is ready', `Parcel ${p.rows[0].tracking_id} is ready at Slot ${loc.slot_no}, Compartment ${loc.compartment_no}.`, 'PARCEL_READY', parcelId);
    });
    res.json({ status: 'STORED' });
}));
router.post('/:parcelId/retrieve', route(async (req, res) => {
    const b = parse(z.object({ collectorVerified: z.literal(true), verificationNote: z.string().trim().min(5).max(500) }), req.body);
    const out = await workflowTx(c => createPickup(c, parse(id, req.params.parcelId), req.account!, b.verificationNote));
    res.status(202).json(out);
}));
router.post('/:parcelId/payment', route(async (req, res) => {
    const b = parse(z.object({ reference: z.string().trim().min(3).max(200) }), req.body);
    await workflowTx(async (c) => {
        const pid = parse(id, req.params.parcelId);
        const { rows } = await c.query(`SELECT * FROM parcels WHERE parcel_id=$1 FOR UPDATE`, [pid]);
        const p = rows[0];
        if (!p)
            throw new HttpError(404, 'Parcel not found.');
        if (p.payment_type !== 'COD' || p.workflow_status !== 'ACTIVE' || p.parcel_status === 'COLLECTED')
            throw new HttpError(409, 'Payment cannot be recorded for this parcel.');
        if (p.payment_status === 'PAID')
            return;
        await c.query(`UPDATE parcels SET payment_status='PAID' WHERE parcel_id=$1`, [pid]);
        await audit(c, req.account!.account_id, pid, 'PAYMENT_SETTLED', { reference: b.reference });
    });
    res.json({ status: 'PAID' });
}));
router.patch('/:parcelId', route(async (req, res) => {
    const b = parse(z.object({ registrationNo: registration, reason: z.string().trim().min(5).max(500) }), req.body);
    await workflowTx(async (c) => {
        const pid = parse(id, req.params.parcelId);
        const p = await c.query(`SELECT * FROM parcels WHERE parcel_id=$1 FOR UPDATE`, [pid]);
        if (!p.rows[0])
            throw new HttpError(404, 'Parcel not found.');
        if (p.rows[0].parcel_status !== 'REGISTERED' || p.rows[0].workflow_status !== 'ACTIVE')
            throw new HttpError(409, 'Only an unstored parcel can change recipient.');
        const st = await c.query(`SELECT student_id FROM students WHERE upper(registration_no)=$1`, [b.registrationNo]);
        if (st.rowCount !== 1)
            throw new HttpError(409, 'Recipient must match one existing student record.');
        await c.query(`UPDATE parcels SET student_id=$2 WHERE parcel_id=$1`, [pid, st.rows[0].student_id]);
        await audit(c, req.account!.account_id, pid, 'RECIPIENT_CORRECTED', { fromStudentId: p.rows[0].student_id, toStudentId: st.rows[0].student_id, reason: b.reason });
    });
    res.json({ status: 'SAVED' });
}));
router.post('/:parcelId/resolve', route(async (req, res) => {
    const b = parse(z.object({ action: z.enum(['CANCEL', 'RETURN', 'MANUAL_COLLECT']), reason: z.string().trim().min(5).max(500) }), req.body);
    await workflowTx(async (c) => {
        const pid = parse(id, req.params.parcelId);
        const { rows } = await c.query(`SELECT * FROM parcels WHERE parcel_id=$1 FOR UPDATE`, [pid]);
        const p = rows[0];
        if (!p)
            throw new HttpError(404, 'Parcel not found.');
        if (b.action === 'MANUAL_COLLECT') {
            if (p.payment_type === 'COD' && p.payment_status !== 'PAID')
                throw new HttpError(409, 'Record COD settlement first.');
            await collect(c, pid, req.account!.account_id, b.reason);
            return;
        }
        const target = b.action === 'CANCEL' ? 'CANCELLED' : 'RETURNED';
        if (p.workflow_status === target)
            return;
        if (p.workflow_status !== 'ACTIVE' || (b.action === 'CANCEL' ? p.parcel_status !== 'REGISTERED' : p.parcel_status !== 'STORED'))
            throw new HttpError(409, 'This action is not valid for the parcel state.');
        await c.query(`UPDATE parcels SET workflow_status=$2 WHERE parcel_id=$1`, [pid, target]);
        if (p.compartment_id)
            await c.query(`UPDATE compartments SET occupancy_status='EMPTY' WHERE compartment_id=$1`, [p.compartment_id]);
        await c.query(`UPDATE hardware_commands SET command_status='FAILED',completed_at=now() WHERE parcel_id=$1 AND command_status IN ('PENDING','ACKNOWLEDGED')`, [pid]);
        await c.query(`UPDATE pickup_attempts SET status='CANCELLED',completed_at=now() WHERE parcel_id=$1 AND status='ACTIVE'`, [pid]);
        await audit(c, req.account!.account_id, pid, target, { reason: b.reason });
    });
    res.json({ status: 'RESOLVED' });
}));
export default router;

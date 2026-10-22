import { Router } from 'express';
import { z } from 'zod';
import { requireDevice } from '../middleware/auth';
import { route, parse, id, HttpError } from '../http';
import { workflowTx, expireWork, collect, audit } from '../workflows';
const router = Router();
router.use(requireDevice);
router.get('/commands/next', route(async (_req, res) => {
    const command = await workflowTx(async (c) => {
        await expireWork(c);
        const device = await c.query(`UPDATE hardware_devices SET last_seen_at=now(),device_status='ONLINE' WHERE device_id=(SELECT device_id FROM hardware_devices ORDER BY created_at LIMIT 1) RETURNING device_id`);
        if (!device.rows[0])
            throw new HttpError(503, 'No device configured.');
        const { rows } = await c.query(`SELECT h.command_id,h.command_type,h.parcel_id,h.compartment_id,s.slot_no,c.compartment_no FROM hardware_commands h JOIN parcels p USING(parcel_id) JOIN compartments c ON c.compartment_id=h.compartment_id JOIN slots s USING(slot_id) JOIN pickup_attempts a ON a.command_id=h.command_id AND a.status='ACTIVE' WHERE h.device_id=$1 AND h.command_status='PENDING' AND p.parcel_status='STORED' AND p.workflow_status='ACTIVE' AND p.compartment_id=h.compartment_id AND s.slot_status='ACTIVE' AND c.occupancy_status='OCCUPIED' AND (p.payment_type<>'COD' OR p.payment_status='PAID') ORDER BY h.created_at FOR UPDATE OF h SKIP LOCKED LIMIT 1`, [device.rows[0].device_id]);
        if (!rows[0])
            return null;
        await c.query(`UPDATE hardware_commands SET command_status='ACKNOWLEDGED',acknowledged_at=now() WHERE command_id=$1`, [rows[0].command_id]);
        return rows[0];
    });
    res.json({ command });
}));
router.post('/commands/:commandId/result', route(async (req, res) => {
    const commandId = parse(id, req.params.commandId), b = parse(z.object({ result: z.enum(['EXECUTED', 'FAILED']) }), req.body);
    await workflowTx(async (c) => {
        await expireWork(c);
        const { rows } = await c.query(`SELECT * FROM hardware_commands WHERE command_id=$1 FOR UPDATE`, [commandId]);
        const h = rows[0];
        if (!h)
            throw new HttpError(404, 'Command not found.');
        if (h.command_status === b.result)
            return;
        if (h.command_status !== 'ACKNOWLEDGED')
            throw new HttpError(409, 'Command expired, was cancelled, or is not acknowledged.');
        await c.query(`UPDATE hardware_commands SET command_status=$2,completed_at=now() WHERE command_id=$1`, [commandId, b.result]);
        if (b.result === 'FAILED')
            await c.query(`UPDATE pickup_attempts SET status='FAILED',completed_at=now() WHERE command_id=$1 AND status='ACTIVE'`, [commandId]);
        await audit(c, null, h.parcel_id, `LIGHT_${b.result}`, { commandId });
    });
    res.json({ status: b.result });
}));
router.post('/events', route(async (req, res) => {
    const b = parse(z.object({ sourceEventKey: z.string().min(1).max(100), parcelId: id, compartmentId: id, occurredAt: z.string().datetime().optional() }), req.body);
    if (b.occurredAt && Date.parse(b.occurredAt) > Date.now() + 60000)
        throw new HttpError(400, 'Event time is in the future.');
    const out = await workflowTx(async (c) => {
        await expireWork(c);
        const device = await c.query(`SELECT device_id FROM hardware_devices ORDER BY created_at LIMIT 1`);
        if (!device.rows[0])
            throw new HttpError(503, 'No device configured.');
        const deviceId = device.rows[0].device_id;
        const prev = await c.query(`SELECT parcel_id,compartment_id,processing_status FROM hardware_events WHERE device_id=$1 AND source_event_key=$2`, [deviceId, b.sourceEventKey]);
        if (prev.rows[0]) {
            if (prev.rows[0].parcel_id !== b.parcelId || prev.rows[0].compartment_id !== b.compartmentId)
                throw new HttpError(409, 'Event key was reused for another event.');
            return { duplicate: true, status: prev.rows[0].processing_status };
        }
        const { rows } = await c.query(`SELECT p.*,c.occupancy_status FROM parcels p LEFT JOIN compartments c USING(compartment_id) WHERE parcel_id=$1 FOR UPDATE OF p`, [b.parcelId]);
        const p = rows[0];
        const comp = await c.query(`SELECT 1 FROM compartments WHERE compartment_id=$1`, [b.compartmentId]);
        if (!p || !comp.rowCount)
            throw new HttpError(409, 'Parcel or compartment does not exist.');
        const valid = p.parcel_status === 'STORED' && p.workflow_status === 'ACTIVE' && p.compartment_id === b.compartmentId && p.occupancy_status === 'OCCUPIED' && (!b.occurredAt || !p.stored_at || Date.parse(b.occurredAt) >= new Date(p.stored_at).getTime());
        const event = await c.query(`INSERT INTO hardware_events(device_id,source_event_key,parcel_id,compartment_id,event_type,processing_status,occurred_at) VALUES($1,$2,$3,$4,'PARCEL_REMOVED',$5,COALESCE($6::timestamptz,now())) RETURNING event_id`, [deviceId, b.sourceEventKey, b.parcelId, b.compartmentId, valid ? 'RECEIVED' : 'REJECTED', b.occurredAt || null]);
        if (!valid) {
            await c.query(`UPDATE hardware_events SET processed_at=now() WHERE event_id=$1`, [event.rows[0].event_id]);
            return { status: 'REJECTED' };
        }
        const active = await c.query(`SELECT 1 FROM pickup_attempts a JOIN hardware_commands h USING(command_id) WHERE a.parcel_id=$1 AND a.status='ACTIVE' AND h.command_status IN ('ACKNOWLEDGED','EXECUTED')`, [b.parcelId]);
        // Sensor truth frees inventory even on unexpected removal, with an explicit staff exception.
        if (!active.rowCount || p.payment_type === 'COD' && p.payment_status !== 'PAID')
            await audit(c, null, b.parcelId, 'UNEXPECTED_REMOVAL', { sourceEventKey: b.sourceEventKey, paymentStatus: p.payment_status });
        await collect(c, b.parcelId, null, `Sensor event ${b.sourceEventKey}`);
        await c.query(`UPDATE hardware_events SET processing_status='PROCESSED',processed_at=now() WHERE event_id=$1`, [event.rows[0].event_id]);
        return { status: 'PROCESSED' };
    });
    res.status(out.status === 'REJECTED' ? 409 : 200).json(out);
}));
export default router;

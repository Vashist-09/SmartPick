import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { withTx } from './db';
import { HttpError } from './http';
import type { Account } from './middleware/auth';
export const workflowTx = <T>(fn: (c: PoolClient) => Promise<T>) => withTx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(734921)');
    return fn(c);
});
export async function audit(c: PoolClient, actor: string | null, parcel: string | null, event: string, details: unknown = {}) {
    await c.query(`INSERT INTO app_audit(audit_id,account_id,parcel_id,event_type,details) VALUES($1,$2,$3,$4,$5)`, [randomUUID(), actor, parcel, event, details]);
}
export async function expireWork(c: PoolClient) {
    await c.query(`UPDATE hardware_commands SET command_status='FAILED',completed_at=now() WHERE command_status IN ('PENDING','ACKNOWLEDGED') AND (created_at<now()-interval '5 minutes' OR (command_status='ACKNOWLEDGED' AND acknowledged_at<now()-interval '30 seconds') OR NOT EXISTS(SELECT 1 FROM parcels p WHERE p.parcel_id=hardware_commands.parcel_id AND p.parcel_status='STORED' AND p.workflow_status='ACTIVE' AND p.compartment_id=hardware_commands.compartment_id))`);
    await c.query(`UPDATE pickup_attempts a SET status=CASE WHEN p.parcel_status='COLLECTED' THEN 'COLLECTED' WHEN a.expires_at<=now() THEN 'EXPIRED' ELSE 'FAILED' END,completed_at=now() FROM parcels p,hardware_commands h WHERE a.parcel_id=p.parcel_id AND a.command_id=h.command_id AND a.status='ACTIVE' AND (a.expires_at<=now() OR h.command_status='FAILED' OR p.parcel_status='COLLECTED' OR p.workflow_status<>'ACTIVE')`);
    await c.query(`UPDATE hardware_commands h SET command_status='FAILED',completed_at=now() WHERE h.command_status IN ('PENDING','ACKNOWLEDGED') AND EXISTS(SELECT 1 FROM pickup_attempts a WHERE a.command_id=h.command_id AND a.status<>'ACTIVE') AND NOT EXISTS(SELECT 1 FROM pickup_attempts a WHERE a.command_id=h.command_id AND a.status='ACTIVE')`);
}
export const parcelSelect = `SELECT p.parcel_id,p.tracking_id,p.parcel_status,p.workflow_status,p.payment_type,p.payment_status,p.compartment_id,p.created_at,p.stored_at,p.collected_at,st.registration_no,st.student_name,s.slot_no,c.compartment_no,c.occupancy_status,s.slot_status FROM parcels p JOIN students st USING(student_id) LEFT JOIN compartments c USING(compartment_id) LEFT JOIN slots s USING(slot_id)`;
export async function ownedParcel(c: PoolClient, parcelId: string, account: Account) {
    const { rows } = await c.query(`${parcelSelect} WHERE p.parcel_id=$1`, [parcelId]);
    const p = rows[0];
    if (!p || (account.role !== 'OPERATOR' && p.registration_no.toUpperCase() !== account.registration_no))
        throw new HttpError(404, 'Parcel not found.');
    return p;
}
export function pickupEligibility(p: any) {
    if (p.parcel_status !== 'STORED' || p.workflow_status !== 'ACTIVE')
        throw new HttpError(409, 'Parcel is not available for pickup.');
    if (p.payment_type === 'COD' && p.payment_status !== 'PAID')
        throw new HttpError(409, 'Please settle cash on delivery with staff first.', 'PAYMENT_REQUIRED');
    if (p.slot_status !== 'ACTIVE' || p.occupancy_status !== 'OCCUPIED')
        throw new HttpError(409, 'This location needs staff assistance.');
}
export async function createPickup(c: PoolClient, parcelId: string, account: Account, verificationNote: string | null = null) {
    if (account.role === 'OPERATOR' && !verificationNote)
        throw new HttpError(400, 'Record the collector identity check before starting pickup.');
    await expireWork(c);
    const p = await ownedParcel(c, parcelId, account);
    pickupEligibility(p);
    const active = await c.query(`SELECT pickup_id FROM pickup_attempts WHERE parcel_id=$1 AND status='ACTIVE'`, [parcelId]);
    if (active.rows[0])
        return active.rows[0];
    const count = await c.query(`SELECT count(*)::int AS count FROM pickup_attempts WHERE parcel_id=$1 AND created_at>now()-interval '15 minutes'`, [parcelId]);
    if (count.rows[0].count >= 3)
        throw new HttpError(429, 'Too many pickup attempts. Please ask staff for help or retry after 15 minutes.');
    const { rows: devices } = await c.query(`SELECT device_id FROM hardware_devices WHERE last_seen_at>now()-interval '30 seconds' ORDER BY created_at LIMIT 1`);
    if (!devices[0])
        throw new HttpError(503, 'The pickup device is offline. Please ask staff for help.', 'DEVICE_OFFLINE');
    const existing = await c.query(`SELECT command_id FROM hardware_commands WHERE parcel_id=$1 AND command_status IN ('PENDING','ACKNOWLEDGED') LIMIT 1`, [parcelId]);
    let commandId = existing.rows[0]?.command_id;
    if (!commandId) {
        const { rows } = await c.query(`INSERT INTO hardware_commands(device_id,parcel_id,compartment_id,command_type,command_status) VALUES($1,$2,$3,'LIGHT_COMPARTMENT','PENDING') RETURNING command_id`, [devices[0].device_id, parcelId, p.compartment_id]);
        commandId = rows[0].command_id;
    }
    const pickupId = randomUUID();
    await c.query(`INSERT INTO pickup_attempts(pickup_id,parcel_id,account_id,command_id,status,expires_at) VALUES($1,$2,$3,$4,'ACTIVE',now()+interval '5 minutes')`, [pickupId, parcelId, account.account_id, commandId]);
    await audit(c, account.account_id, parcelId, 'PICKUP_STARTED', { pickupId, verificationNote });
    return { pickup_id: pickupId };
}
export async function pickupStatus(c: PoolClient, pickupId: string, account: Account) {
    await expireWork(c);
    const { rows } = await c.query(`SELECT a.*,h.command_status,p.parcel_status,p.workflow_status,p.collected_at,p.tracking_id,s.slot_no,c.compartment_no FROM pickup_attempts a JOIN parcels p USING(parcel_id) JOIN students st USING(student_id) LEFT JOIN hardware_commands h USING(command_id) LEFT JOIN compartments c ON c.compartment_id=p.compartment_id LEFT JOIN slots s USING(slot_id) WHERE a.pickup_id=$1 AND ($2='OPERATOR' OR upper(st.registration_no)=$3)`, [pickupId, account.role, account.registration_no]);
    if (!rows[0])
        throw new HttpError(404, 'Pickup not found.');
    return rows[0];
}
export async function collect(c: PoolClient, parcelId: string, actor: string | null, reason: string) {
    const { rows } = await c.query(`SELECT p.*,c.slot_id FROM parcels p LEFT JOIN compartments c USING(compartment_id) WHERE parcel_id=$1 FOR UPDATE OF p`, [parcelId]);
    const p = rows[0];
    if (!p || p.parcel_status !== 'STORED' || p.workflow_status !== 'ACTIVE')
        throw new HttpError(409, 'Parcel is not stored.');
    await c.query(`UPDATE parcels SET parcel_status='COLLECTED',collected_at=now() WHERE parcel_id=$1`, [parcelId]);
    await c.query(`UPDATE compartments SET occupancy_status='EMPTY' WHERE compartment_id=$1`, [p.compartment_id]);
    await c.query(`UPDATE hardware_commands SET command_status='FAILED',completed_at=now() WHERE parcel_id=$1 AND command_status IN ('PENDING','ACKNOWLEDGED')`, [parcelId]);
    await c.query(`UPDATE pickup_attempts SET status='COLLECTED',completed_at=now() WHERE parcel_id=$1 AND status='ACTIVE'`, [parcelId]);
    await audit(c, actor, parcelId, 'COLLECTED', { reason });
    await c.query(`INSERT INTO activity_logs(parcel_id,student_id,slot_id,compartment_id,event_type,details) VALUES($1,$2,$3,$4,'PARCEL_REMOVED',$5)`, [parcelId, p.student_id, p.slot_id, p.compartment_id, { reason }]);
}

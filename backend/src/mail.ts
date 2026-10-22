import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, withTx } from './db';
// A trusted HTTPS mail gateway accepts {to,subject,text,idempotencyKey}.
// Development messages are inspected through the explicit local-only mailbox endpoint.
export async function enqueue(c: PoolClient, accountId: string, destination: string, subject: string, body: string, kind: string, parcelId: string | null = null) {
    await c.query(`INSERT INTO app_notifications(notification_id,account_id,parcel_id,destination,subject,body,kind) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(account_id,parcel_id,kind) DO NOTHING`, [randomUUID(), accountId, parcelId, destination, subject, body, kind]);
}
let sending = false;
export async function deliverMail() {
    if (sending || !process.env.MAIL_WEBHOOK_URL)
        return;
    sending = true;
    try {
        const message = await withTx(async (c) => {
            await c.query(`UPDATE app_notifications SET status='PENDING' WHERE status='SENDING' AND locked_at<now()-interval '2 minutes'`);
            const { rows } = await c.query(`SELECT * FROM app_notifications WHERE status IN ('PENDING','FAILED') AND attempts<5 AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
            if (!rows[0])
                return null;
            await c.query(`UPDATE app_notifications SET status='SENDING',locked_at=now(),attempts=attempts+1 WHERE notification_id=$1`, [rows[0].notification_id]);
            return rows[0];
        });
        if (!message)
            return;
        try {
            const url = new URL(process.env.MAIL_WEBHOOK_URL);
            if (url.protocol !== 'https:')
                throw new Error('Mail gateway requires HTTPS');
            const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MAIL_WEBHOOK_KEY || ''}` }, body: JSON.stringify({ to: message.destination, subject: message.subject, text: message.body, idempotencyKey: message.notification_id }), signal: AbortSignal.timeout(10000) });
            if (!response.ok)
                throw new Error('Mail gateway rejected message');
            await pool.query(`UPDATE app_notifications SET status='SENT' WHERE notification_id=$1`, [message.notification_id]);
        }
        catch {
            await pool.query(`UPDATE app_notifications SET status='FAILED',available_at=now()+interval '5 minutes' WHERE notification_id=$1`, [message.notification_id]);
        }
    }
    finally {
        sending = false;
    }
}

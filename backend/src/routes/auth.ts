import { Router, Response, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool, withTx } from '../db';
import { route, parse, HttpError, registration } from '../http';
import { hashPassword, checkPassword, token, digest } from '../security';
import { requireAccount, sessionToken, cookieName } from '../middleware/auth';
import { enqueue } from '../mail';
const router = Router();
const email = z.string().trim().email().max(254).transform(s => s.toLowerCase());
const password = z.string().min(12).max(128);
const cookie = (req: Request, res: Response, value: string, maxAge: number) => res.cookie(cookieName(req), value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge });
async function session(req: Request, res: Response, accountId: string) {
    const secret = token();
    await pool.query(`INSERT INTO app_sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '12 hours')`, [digest(secret), accountId]);
    cookie(req, res, secret, 12 * 3600 * 1000);
}
export async function challenge(c: import('pg').PoolClient, account: any, purpose: 'VERIFY' | 'RESET') {
    const recent = await c.query(`SELECT 1 FROM app_challenges WHERE account_id=$1 AND purpose=$2 AND created_at>now()-interval '60 seconds'`, [account.account_id, purpose]);
    if (recent.rowCount)
        return;
    await c.query(`DELETE FROM app_challenges WHERE account_id=$1 AND purpose=$2`, [account.account_id, purpose]);
    // Revoke unsent superseded messages; never put auth links into the in-app inbox.
    await c.query(`UPDATE app_notifications SET status='SENT',body='Superseded' WHERE account_id=$1 AND kind=$2 AND status IN ('PENDING','FAILED')`, [account.account_id, purpose]);
    const secret = token();
    await c.query(`INSERT INTO app_challenges(token_hash,account_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')`, [digest(secret), account.account_id, purpose]);
    const origin = process.env.STUDENT_APP_ORIGIN || 'http://localhost:5173';
    const link = `${origin}/#${purpose === 'VERIFY' ? 'verify' : 'reset'}?token=${secret}`;
    await enqueue(c, account.account_id, account.email, purpose === 'VERIFY' ? 'Verify your SmartPick email' : 'Reset your SmartPick password', `Open ${link}\nThis link expires in 30 minutes.`, purpose);
}
async function consumeChallenge(c: import('pg').PoolClient, secret: string, purpose: 'VERIFY' | 'RESET') {
    const key = digest(secret);
    const found = await c.query(`SELECT account_id FROM app_challenges WHERE token_hash=$1 AND purpose=$2`, [key, purpose]);
    if (!found.rows[0])
        throw new HttpError(400, 'This link is invalid, expired or already used. Request a fresh link.');
    // Match the account -> challenge lock order used by resend/recovery.
    await c.query(`SELECT account_id FROM app_accounts WHERE account_id=$1 FOR UPDATE`, [found.rows[0].account_id]);
    const { rows } = await c.query(`SELECT * FROM app_challenges WHERE token_hash=$1 AND purpose=$2 AND expires_at>now() FOR UPDATE`, [key, purpose]);
    if (!rows[0])
        throw new HttpError(400, 'This link is invalid, expired or already used. Request a fresh link.');
    return rows[0];
}
router.post('/register', route(async (req, res) => {
    const body = parse(z.object({ email, password, fullName: z.string().trim().min(2).max(80), registrationNo: registration, phone: z.string().trim().max(30).optional() }), req.body);
    const passwordHash = await hashPassword(body.password);
    try {
        await withTx(async (c) => {
            const a = { account_id: randomUUID(), email: body.email };
            await c.query(`INSERT INTO app_accounts(account_id,email,registration_no,full_name,phone,password_hash) VALUES($1,$2,$3,$4,$5,$6)`, [a.account_id, body.email, body.registrationNo, body.fullName, body.phone || '', passwordHash]);
            await challenge(c, a, 'VERIFY');
        });
    }
    catch (e) {
        if ((e as any).code !== '23505')
            throw e;
    }
    res.status(202).json({ message: 'If these details can be registered, a verification link will arrive. Verify your email, then log in. Existing users can log in or recover their account.' });
}));
router.post('/login', route(async (req, res) => {
    const body = parse(z.object({ email, password: z.string().min(1).max(128) }), req.body);
    const { rows } = await pool.query(`SELECT * FROM app_accounts WHERE email=$1`, [body.email]);
    const dummy = 'scrypt$00000000000000000000000000000000$' + '00'.repeat(64);
    if (!await checkPassword(body.password, rows[0]?.password_hash || dummy) || !rows[0])
        throw new HttpError(401, 'Email or password is incorrect.');
    if (req.header('x-smartpick-client') === 'operator' && rows[0].role !== 'OPERATOR')
        throw new HttpError(403, 'Staff access required.');
    await pool.query(`DELETE FROM app_sessions WHERE token_hash=$1 OR expires_at<=now()`, [digest(sessionToken(req))]);
    await session(req, res, rows[0].account_id);
    res.json({ status: 'SIGNED_IN' });
}));
router.post('/logout', route(async (req, res) => {
    await pool.query(`DELETE FROM app_sessions WHERE token_hash=$1`, [digest(sessionToken(req))]);
    cookie(req, res, '', 0);
    res.json({ status: 'SIGNED_OUT' });
}));
router.get('/session', requireAccount, route(async (req, res) => res.json(req.account)));
router.post('/resend', route(async (req, res) => {
    const b = parse(z.object({ email }), req.body);
    await withTx(async (c) => {
        const { rows } = await c.query(`SELECT * FROM app_accounts WHERE email=$1 FOR UPDATE`, [b.email]);
        if (rows[0] && !rows[0].email_verified_at)
            await challenge(c, rows[0], 'VERIFY');
    });
    res.status(202).json({ message: 'If verification is needed, a link will arrive. You can request another after 60 seconds.' });
}));
router.post('/forgot', route(async (req, res) => {
    const b = parse(z.object({ email }), req.body);
    await withTx(async (c) => {
        const { rows } = await c.query(`SELECT * FROM app_accounts WHERE email=$1 FOR UPDATE`, [b.email]);
        if (rows[0])
            await challenge(c, rows[0], 'RESET');
    });
    res.status(202).json({ message: 'If the account exists, a reset link will arrive.' });
}));
router.post('/verify', route(async (req, res) => {
    const b = parse(z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }), req.body);
    const accountId = await withTx(async (c) => {
        const rows = [await consumeChallenge(c, b.token, 'VERIFY')];
        await c.query(`UPDATE app_accounts SET email_verified_at=COALESCE(email_verified_at,now()) WHERE account_id=$1`, [rows[0].account_id]);
        await c.query(`DELETE FROM app_challenges WHERE account_id=$1 AND purpose='VERIFY'`, [rows[0].account_id]);
        await c.query(`UPDATE app_notifications SET status='SENT',body='Verification completed' WHERE account_id=$1 AND kind='VERIFY' AND status IN ('PENDING','FAILED')`, [rows[0].account_id]);
        return rows[0].account_id;
    });
    // Email ownership permits a session, not access to a claimed campus identity.
    await pool.query(`DELETE FROM app_sessions WHERE token_hash=$1`, [digest(sessionToken(req))]);
    await session(req, res, accountId);
    res.json({ status: 'VERIFIED', message: 'Email verified. Staff approval is required before parcels are accessible.' });
}));
router.post('/reset', route(async (req, res) => {
    const b = parse(z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password }), req.body);
    const hash = await hashPassword(b.password);
    await withTx(async (c) => {
        const rows = [await consumeChallenge(c, b.token, 'RESET')];
        await c.query(`UPDATE app_accounts SET password_hash=$2 WHERE account_id=$1`, [rows[0].account_id, hash]);
        await c.query(`DELETE FROM app_sessions WHERE account_id=$1`, [rows[0].account_id]);
        await c.query(`DELETE FROM app_challenges WHERE account_id=$1 AND purpose='RESET'`, [rows[0].account_id]);
        await c.query(`UPDATE app_notifications SET status='SENT',body='Password reset completed' WHERE account_id=$1 AND kind='RESET' AND status IN ('PENDING','FAILED')`, [rows[0].account_id]);
    });
    cookie(req, res, '', 0);
    res.json({ message: 'Password updated. Log in with your new password.' });
}));
router.get('/dev-mailbox', route(async (req, res) => {
    if (process.env.NODE_ENV === 'production' || process.env.ENABLE_DEV_MAILBOX !== 'true' || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || ''))
        throw new HttpError(404, 'Not found.');
    const { rows } = await pool.query(`SELECT subject,body,created_at FROM app_notifications WHERE destination=$1 AND kind IN ('VERIFY','RESET') AND created_at>now()-interval '30 minutes' AND body<>'Superseded' ORDER BY created_at DESC LIMIT 5`, [parse(email, req.query.email)]);
    res.json(rows);
}));
export default router;

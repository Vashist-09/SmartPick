import { NextFunction, Request, Response } from 'express';
import { pool } from '../db';
import { digest } from '../security';
import { HttpError } from '../http';
export type Account = {
    account_id: string;
    email: string;
    registration_no: string | null;
    full_name: string;
    phone: string;
    role: 'STUDENT' | 'OPERATOR';
    email_verified_at: string | null;
    approved_at: string | null;
    notifications_enabled: boolean;
};
declare global {
    namespace Express {
        interface Request {
            account?: Account;
        }
    }
}
export function cookieName(req: Request) {
    return req.header('x-smartpick-client') === 'operator' ? 'smartpick_operator' : 'smartpick_session';
}
export function sessionToken(req: Request) {
    const name = cookieName(req) + '=';
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(name));
    return cookie?.slice(name.length) || '';
}
export function requireAccount(req: Request, _res: Response, next: NextFunction) {
    void (async () => {
        const secret = sessionToken(req);
        if (!secret)
            throw new HttpError(401, 'Please log in.', 'SESSION_REQUIRED');
        const { rows } = await pool.query(`SELECT a.account_id,a.email,a.registration_no,a.full_name,a.phone,a.role,a.email_verified_at,a.approved_at,a.notifications_enabled FROM app_sessions s JOIN app_accounts a USING(account_id) WHERE s.token_hash=$1 AND s.expires_at>now()`, [digest(secret)]);
        if (!rows[0])
            throw new HttpError(401, 'Your session expired. Please log in.', 'SESSION_EXPIRED');
        req.account = rows[0];
        next();
    })().catch(next);
}
export function requireOperator(req: Request, res: Response, next: NextFunction) {
    requireAccount(req, res, error => {
        if (error)
            return next(error);
        if (req.account?.role !== 'OPERATOR')
            return next(new HttpError(403, 'Staff access required.'));
        next();
    });
}
export function requireStudent(req: Request, res: Response, next: NextFunction) {
    requireAccount(req, res, error => {
        if (error)
            return next(error);
        if (req.account?.role !== 'STUDENT')
            return next(new HttpError(403, 'Student access required.'));
        if (!req.account.email_verified_at)
            return next(new HttpError(403, 'Verify your email first.', 'EMAIL_UNVERIFIED'));
        if (!req.account.approved_at)
            return next(new HttpError(403, 'Staff must approve your student identity.', 'IDENTITY_PENDING'));
        next();
    });
}
export function requireDevice(req: Request, _res: Response, next: NextFunction) {
    const key = process.env.ESP32_API_KEY;
    if (!key || digest(req.header('x-device-key') || '') !== digest(key))
        return next(new HttpError(401, 'Device authentication failed.'));
    next();
}

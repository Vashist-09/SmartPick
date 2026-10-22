import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { pool } from './db';
import { z } from 'zod';
import { hashPassword } from './security';
async function main() {
    const email = process.env.STAFF_EMAIL?.trim().toLowerCase(), password = process.env.STAFF_PASSWORD;
    if (!z.string().email().max(254).safeParse(email).success || !password || password.length < 12 || password.length > 128)
        throw new Error('Set STAFF_EMAIL and STAFF_PASSWORD (12+ characters).');
    await pool.query(`INSERT INTO app_accounts(account_id,email,full_name,password_hash,role,email_verified_at,approved_at) VALUES($1,$2,'Parcel desk',$3,'OPERATOR',now(),now())`, [randomUUID(), email, await hashPassword(password)]);
    console.log('Operator account created.');
}
void main().catch(() => {
    console.error('Operator provisioning failed. Check inputs, migration and duplicate email.');
    process.exitCode = 1;
}).finally(() => pool.end());

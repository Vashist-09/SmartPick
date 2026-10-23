// Disposable local preview only; never accepts a production database.
const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { hashPassword } = require('../dist/security');
(async () => {
    const connectionString = process.env.TEST_DATABASE_URL;
    if (new URL(connectionString).pathname !== '/smartpick_test')
        throw new Error('Disposable smartpick_test database required');
    const c = new Client({ connectionString });
    await c.connect();
    await c.query('CREATE SCHEMA IF NOT EXISTS preview');
    await c.query('SET search_path TO preview,public');
    if (!(await c.query("SELECT to_regclass('preview.parcels') AS existing")).rows[0].existing) {
        await c.query(fs.readFileSync(path.join(__dirname, '../test/fixture.sql'), 'utf8'));
        await c.query(fs.readFileSync(path.join(__dirname, '../migrations/001_workflows.sql'), 'utf8'));
        const staff = randomUUID(), student = randomUUID(), password = await hashPassword('SmartPick preview 2026');
        await c.query(`INSERT INTO app_accounts(account_id,email,full_name,password_hash,role,email_verified_at,approved_at,registration_no) VALUES($1,'desk@example.test','Parcel desk',$3,'OPERATOR',now(),now(),null),($2,'student@example.test','Asha Patel',$3,'STUDENT',now(),now(),'24CS104')`, [staff, student, password]);
        const s = (await c.query(`INSERT INTO students(registration_no,student_name) VALUES('24CS104','Asha Patel') RETURNING student_id`)).rows[0];
        for (let i = 1; i <= 3; i++) {
            const slot = (await c.query(`INSERT INTO slots(slot_no,slot_name) VALUES($1,$2) RETURNING slot_id`, [i, `Unit ${i}`])).rows[0];
            await c.query(`INSERT INTO compartments(slot_id,compartment_no) VALUES($1,1),($1,2)`, [slot.slot_id]);
        }
        await c.query(`INSERT INTO parcels(tracking_id,student_id,parcel_status,payment_type,payment_status) VALUES('SP-PREVIEW-1',$1,'REGISTERED','PREPAID','PAID')`, [s.student_id]);
        await c.query(`INSERT INTO hardware_devices(device_status,last_seen_at) VALUES('OFFLINE',null)`);
    }
    await c.end();
    console.log('Disposable preview ready.');
})().catch(e => {
    console.error(e.message);
    process.exitCode = 1;
});

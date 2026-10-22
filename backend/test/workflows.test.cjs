const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
// Refuse to touch an unmarked database. Fixture initialization only runs in this named test DB.
const url = process.env.TEST_DATABASE_URL;
test('full account, authorization, inventory and device lifecycle', { skip: !url }, async (t) => {
    const { Client } = require('pg');
    assert.equal(new URL(url).pathname, '/smartpick_test', 'Use a disposable smartpick_test database');
    process.env.DATABASE_URL = url;
    process.env.CORS_ORIGIN = 'http://localhost:5173';
    process.env.ENABLE_DEV_MAILBOX = 'true';
    process.env.ESP32_API_KEY = 'test-device-key';
    const admin = new Client({ connectionString: url });
    await admin.connect();
    const schema = `test_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path TO ${schema},public`);
    const target = new URL(url);
    target.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = target.toString();
    let server, pool;
    try {
        await admin.query(fs.readFileSync(path.join(__dirname, 'fixture.sql'), 'utf8'));
        await admin.query(fs.readFileSync(path.join(__dirname, '../migrations/001_workflows.sql'), 'utf8'));
        // Migration can be explicitly applied again without data loss.
        await admin.query(fs.readFileSync(path.join(__dirname, '../migrations/001_workflows.sql'), 'utf8'));
        const { app } = require('../dist/app');
        pool = require('../dist/db').pool;
        const { hashPassword } = require('../dist/security');
        const staff = randomUUID();
        await admin.query(`INSERT INTO app_accounts(account_id,email,full_name,password_hash,role,email_verified_at,approved_at) VALUES($1,'staff@example.test','Staff',$2,'OPERATOR',now(),now())`, [staff, await hashPassword('a long staff password')]);
        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}`;
        async function req(route, { method = 'GET', body, cookie, device = false, origin = 'http://localhost:5173' } = {}) {
            const r = await fetch(base + route, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(cookie?.startsWith('smartpick_operator=') || body?.email === 'staff@example.test' ? { 'x-smartpick-client': 'operator' } : {}), ...(device ? { 'x-device-key': 'test-device-key' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
            return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
        }
        const login = await req('/api/auth/login', { method: 'POST', body: { email: 'staff@example.test', password: 'a long staff password' } });
        assert.equal(login.status, 200);
        const staffCookie = login.cookie;
        assert.ok(staffCookie);
        assert.ok((await req('/api/auth/session', { cookie: staffCookie })).data.role === 'OPERATOR');
        await t.test('malformed requests, forged origins and legacy keys are rejected', async () => {
            assert.equal((await req('/api/no-such-route')).status, 404);
            assert.equal((await req('/api/slots')).status, 401);
            assert.equal((await req('/api/auth/logout', { method: 'POST', origin: 'https://forged.example' })).status, 403);
            const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, body: '{broken' });
            assert.equal(r.status, 400);
        });
        await t.test('same-origin deployment serves both apps and allows browser writes', {skip:!fs.existsSync(path.join(__dirname,'../../dist/index.html'))||!fs.existsSync(path.join(__dirname,'../../frontend/dist/index.html'))}, async()=>{
            assert.match(await (await fetch(base+'/')).text(), /Parcel desk/);
            assert.match(await (await fetch(base+'/student/')).text(), /Your parcel, found/);
            assert.equal((await fetch(base+'/src/live.js')).status,200);
            assert.equal((await req('/api/auth/logout',{method:'POST',origin:base})).status,200);
        });
        let studentCookie, studentId, otherCookie;
        await t.test('verification is single-use and does not approve a typed identity', async () => {
            const register = await req('/api/auth/register', { method: 'POST', body: { email: 'asha@example.test', password: 'a long student password', fullName: 'Asha Patel', registrationNo: '24cs104' } });
            assert.equal(register.status, 202);
            let r = await req('/api/auth/login', { method: 'POST', body: { email: 'asha@example.test', password: 'a long student password' } });
            studentCookie = r.cookie;
            assert.equal((await req('/api/me/parcels', { cookie: studentCookie })).status, 403);
            const mail = await req('/api/auth/dev-mailbox?email=asha%40example.test');
            const token = mail.data[0].body.match(/token=([a-f0-9]+)/)[1];
            r = await req('/api/auth/verify', { method: 'POST', body: { token } });
            assert.equal(r.status, 200);
            studentCookie = r.cookie;
            assert.equal((await req('/api/auth/verify', { method: 'POST', body: { token } })).status, 400);
            assert.equal((await req('/api/me/parcels', { cookie: studentCookie })).status, 403);
            studentId = (await req('/api/auth/session', { cookie: studentCookie })).data.account_id;
        });
        let parcelId, compartment, secondComp;
        await t.test('register, queue, assign, approve identity and restrict ownership', async () => {
            const s = await admin.query(`INSERT INTO slots(slot_no,slot_name) VALUES(1,'A') RETURNING slot_id`);
            const c = await admin.query(`INSERT INTO compartments(slot_id,compartment_no) VALUES($1,1),($1,2) RETURNING compartment_id`, [s.rows[0].slot_id]);
            compartment = c.rows[0].compartment_id;
            secondComp = c.rows[1].compartment_id;
            let r = await req('/api/parcels', { method: 'POST', cookie: staffCookie, body: { registrationNo: '24CS104', studentName: 'Asha Patel', trackingId: 'TRACK-1', paymentType: 'COD' } });
            assert.equal(r.status, 201);
            parcelId = r.data.parcel_id;
            assert.equal((await req('/api/parcels?status=REGISTERED', { cookie: staffCookie })).data.length, 1);
            r = await req(`/api/parcels/${parcelId}/store`, { method: 'POST', cookie: staffCookie, body: { compartmentId: compartment } });
            assert.equal(r.status, 200);
            assert.equal((await req(`/api/operator/accounts/${studentId}/approve`, { method: 'POST', cookie: staffCookie, body: { reason: 'Campus ID checked in person' } })).status, 200);
            assert.equal((await req('/api/me/parcels', { cookie: studentCookie })).data.length, 1);
            assert.equal((await req(`/api/operator/accounts/${studentId}/approve`, { method: 'POST', cookie: studentCookie, body: { reason: 'Self approval' } })).status, 403);
            const other = randomUUID();
            await admin.query(`INSERT INTO app_accounts(account_id,email,registration_no,full_name,password_hash,email_verified_at,approved_at) VALUES($1,'other@example.test','OTHER','Other',$2,now(),now())`, [other, await hashPassword('another student password')]);
            otherCookie = (await req('/api/auth/login', { method: 'POST', body: { email: 'other@example.test', password: 'another student password' } })).cookie;
            assert.equal((await req(`/api/me/parcels/${parcelId}`, { cookie: otherCookie })).status, 404);
            assert.equal((await req(`/api/parcels/${parcelId}/pickups`, { method: 'POST', cookie: otherCookie })).status, 404);
        });
        let pickupId, command;
        await t.test('COD and offline gates, duplicate pickup and command execution', async () => {
            assert.equal((await req(`/api/parcels/${parcelId}/pickups`, { method: 'POST', cookie: studentCookie })).data.code, 'PAYMENT_REQUIRED');
            assert.equal((await req(`/api/parcels/${parcelId}/payment`, { method: 'POST', cookie: staffCookie, body: { reference: 'Cash receipt 42' } })).status, 200);
            assert.equal((await req(`/api/parcels/${parcelId}/pickups`, { method: 'POST', cookie: studentCookie })).status, 503);
            await admin.query(`INSERT INTO hardware_devices(device_status,last_seen_at) VALUES('ONLINE',now())`);
            const results = await Promise.all([req(`/api/parcels/${parcelId}/pickups`, { method: 'POST', cookie: studentCookie }), req(`/api/parcels/${parcelId}/pickups`, { method: 'POST', cookie: studentCookie })]);
            assert.equal(results[0].status, 202);
            assert.equal(results[0].data.pickup_id, results[1].data.pickup_id);
            pickupId = results[0].data.pickup_id;
            assert.equal((await req(`/api/pickups/${pickupId}`, { cookie: otherCookie })).status, 404);
            let r = await req('/api/device/commands/next', { device: true });
            assert.equal(r.status, 200);
            command = r.data.command;
            assert.ok(command);
            assert.equal((await req('/api/device/commands/next', { device: true })).data.command, null);
            for (let i = 0; i < 2; i++)
                assert.equal((await req(`/api/device/commands/${command.command_id}/result`, { method: 'POST', device: true, body: { result: 'EXECUTED' } })).status, 200);
            const p = await req(`/api/pickups/${pickupId}`, { cookie: studentCookie });
            assert.equal(p.data.command_status, 'EXECUTED');
            assert.equal(p.data.status, 'ACTIVE');
            assert.equal((await req(`/api/me/parcels/${parcelId}`, { cookie: studentCookie })).data.parcel_status, 'STORED');
        });
        await t.test('sensor collection, duplicate events, receipt, and history', async () => {
            const body = { sourceEventKey: 'event-1', parcelId, compartmentId: compartment };
            let r = await req('/api/device/events', { method: 'POST', device: true, body });
            assert.equal(r.status, 200);
            assert.equal(r.data.status, 'PROCESSED');
            assert.equal((await req('/api/device/events', { method: 'POST', device: true, body })).data.duplicate, true);
            assert.equal((await req('/api/device/events', { method: 'POST', device: true, body: { ...body, compartmentId: secondComp } })).status, 409);
            assert.equal((await req(`/api/pickups/${pickupId}`, { cookie: studentCookie })).data.status, 'COLLECTED');
            assert.equal((await req('/api/slots', { cookie: staffCookie })).data[0].compartments[0].occupancyStatus, 'EMPTY');
            assert.ok((await req('/api/me/activity', { cookie: studentCookie })).data.some(a => a.event_type === 'COLLECTED'));
        });
        await t.test('lost acknowledgement expires and stale work cannot be dispatched', async () => {
            const r = await req('/api/parcels', { method: 'POST', cookie: staffCookie, body: { registrationNo: '24CS104', studentName: 'Asha Patel', trackingId: 'TRACK-2', paymentType: 'PREPAID' } });
            const pid = r.data.parcel_id;
            await req(`/api/parcels/${pid}/store`, { method: 'POST', cookie: staffCookie, body: { compartmentId: compartment } });
            const attempt = (await req(`/api/parcels/${pid}/pickups`, { method: 'POST', cookie: studentCookie })).data.pickup_id;
            const h = (await req('/api/device/commands/next', { device: true })).data.command;
            await admin.query(`UPDATE hardware_commands SET acknowledged_at=now()-interval '31 seconds' WHERE command_id=$1`, [h.command_id]);
            assert.equal((await req(`/api/pickups/${attempt}`, { cookie: studentCookie })).data.status, 'FAILED');
            assert.equal((await req(`/api/device/commands/${h.command_id}/result`, { method: 'POST', device: true, body: { result: 'EXECUTED' } })).status, 409);
            const retry = (await req(`/api/parcels/${pid}/pickups`, { method: 'POST', cookie: studentCookie })).data.pickup_id;
            assert.notEqual(retry, attempt);
            // Removal before command dispatch: inventory truth is recorded, and pending work is retired.
            await req('/api/device/events', { method: 'POST', device: true, body: { sourceEventKey: 'unexpected-2', parcelId: pid, compartmentId: compartment } });
            assert.equal((await req('/api/device/commands/next', { device: true })).data.command, null);
            assert.equal((await req(`/api/pickups/${retry}`, { cookie: studentCookie })).data.status, 'COLLECTED');
            assert.ok((await req('/api/operator/activity', { cookie: staffCookie })).data.some(a => a.event_type === 'UNEXPECTED_REMOVAL'));
        });
        await t.test('storage races, correction, cancellation, returns and payment overrides', async () => {
            const register = async (tracking) => (await req('/api/parcels', { method: 'POST', cookie: staffCookie, body: { registrationNo: '24CS104', studentName: 'Asha Patel', trackingId: tracking, paymentType: 'PREPAID' } })).data.parcel_id;
            const a = await register('RACE-A'), b = await register('RACE-B');
            const results = await Promise.all([req(`/api/parcels/${a}/store`, { method: 'POST', cookie: staffCookie, body: { compartmentId: compartment } }), req(`/api/parcels/${b}/store`, { method: 'POST', cookie: staffCookie, body: { compartmentId: compartment } })]);
            assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
            const stored = results[0].status === 200 ? a : b, unstored = stored === a ? b : a;
            assert.equal((await req(`/api/parcels/${stored}/pickups`, { method: 'POST', cookie: staffCookie })).status, 400, 'staff must record ID evidence');
            assert.equal((await req(`/api/parcels/${stored}/resolve`, { method: 'POST', cookie: staffCookie, body: { action: 'CANCEL', reason: 'Wrong transition' } })).status, 409);
            assert.equal((await req(`/api/parcels/${stored}/resolve`, { method: 'POST', cookie: staffCookie, body: { action: 'RETURN', reason: 'Unclaimed parcel returned to courier' } })).status, 200);
            assert.equal((await req(`/api/me/parcels/${stored}`, { cookie: studentCookie })).data.workflow_status, 'RETURNED');
            assert.equal((await req(`/api/parcels/${unstored}`, { method: 'PATCH', cookie: staffCookie, body: { registrationNo: 'OTHER', reason: 'Corrected wrong student assignment' } })).status, 409, 'recipient must exist in campus inventory');
            assert.equal((await req(`/api/parcels/${unstored}/resolve`, { method: 'POST', cookie: staffCookie, body: { action: 'CANCEL', reason: 'Delivery entry was cancelled' } })).status, 200);
            const manual = await register('MANUAL');
            await req(`/api/parcels/${manual}/store`, { method: 'POST', cookie: staffCookie, body: { compartmentId: compartment } });
            assert.equal((await req(`/api/parcels/${manual}/resolve`, { method: 'POST', cookie: staffCookie, body: { action: 'MANUAL_COLLECT', reason: 'Campus ID checked; handed over after sensor failure' } })).status, 200);
        });
        await t.test('cancelled and expired attempts keep inventory stored', async () => {
            const pid = (await req('/api/parcels', { method: 'POST', cookie: staffCookie, body: { registrationNo: '24CS104', studentName: 'Asha Patel', trackingId: 'TIMEOUT', paymentType: 'PREPAID' } })).data.parcel_id;
            await req(`/api/parcels/${pid}/store`, { method: 'POST', cookie: staffCookie, body: { compartmentId: compartment } });
            const pickup = (await req(`/api/parcels/${pid}/pickups`, { method: 'POST', cookie: studentCookie })).data.pickup_id;
            assert.equal((await req(`/api/pickups/${pickup}/cancel`, { method: 'POST', cookie: studentCookie, body: { reason: 'Not at the desk yet' } })).data.status, 'CANCELLED');
            const next = (await req(`/api/parcels/${pid}/pickups`, { method: 'POST', cookie: studentCookie })).data.pickup_id;
            await admin.query(`UPDATE pickup_attempts SET expires_at=now()-interval '1 second' WHERE pickup_id=$1`, [next]);
            assert.equal((await req(`/api/pickups/${next}`, { cookie: studentCookie })).data.status, 'EXPIRED');
            assert.equal((await req(`/api/me/parcels/${pid}`, { cookie: studentCookie })).data.parcel_status, 'STORED');
            assert.equal((await req('/api/device/commands/next', { device: true })).data.command, null);
        });
        await t.test('profile preferences, notification ownership and mail retry worker', async () => {
            assert.equal((await req('/api/me', { method: 'PATCH', cookie: studentCookie, body: { fullName: 'Asha Patel', phone: '', notificationsEnabled: false } })).status, 200);
            assert.equal((await req('/api/me', { cookie: studentCookie })).data.notifications_enabled, false);
            const notices = (await req('/api/me/notifications', { cookie: studentCookie })).data;
            assert.ok(notices.every(n => !n.body.includes('token=')));
            assert.ok(notices.length);
            await req(`/api/me/notifications/${notices[0].notification_id}/read`, { method: 'POST', cookie: otherCookie });
            assert.equal((await req('/api/me/notifications', { cookie: studentCookie })).data[0].read_at, null);
            await req(`/api/me/notifications/${notices[0].notification_id}/read`, { method: 'POST', cookie: studentCookie });
            assert.ok((await req('/api/me/notifications', { cookie: studentCookie })).data[0].read_at);
            const originalFetch = global.fetch;
            const { deliverMail } = require('../dist/mail');
            process.env.MAIL_WEBHOOK_URL = 'https://mail.example.test/send';
            try {
                global.fetch = async () => ({ ok: false });
                await deliverMail();
                assert.ok((await admin.query(`SELECT 1 FROM app_notifications WHERE status='FAILED'`)).rowCount);
                await admin.query(`UPDATE app_notifications SET available_at=now() WHERE status='FAILED'`);
                global.fetch = async () => ({ ok: true });
                await deliverMail();
                assert.ok((await admin.query(`SELECT 1 FROM app_notifications WHERE status='SENT' AND attempts>0`)).rowCount);
            }
            finally {
                global.fetch = originalFetch;
                delete process.env.MAIL_WEBHOOK_URL;
            }
        });
        await t.test('staff identity correction revokes access and requires fresh email verification', async () => {
            const lookup = await req('/api/operator/accounts/find?email=other%40example.test', { cookie: staffCookie });
            assert.equal(lookup.status, 200);
            const accountId = lookup.data.account_id;
            const body = { email: 'corrected@example.test', registrationNo: 'OTHER', reason: 'Corrected email after physical campus ID check' };
            assert.equal((await req(`/api/operator/accounts/${accountId}/identity`, { method: 'PATCH', cookie: studentCookie, body })).status, 403);
            assert.equal((await req(`/api/operator/accounts/${accountId}/identity`, { method: 'PATCH', cookie: staffCookie, body })).status, 200);
            assert.equal((await req('/api/auth/session', { cookie: otherCookie })).status, 401);
            const corrected = (await req('/api/operator/accounts/find?email=corrected%40example.test', { cookie: staffCookie })).data;
            assert.equal(corrected.approved_at, null);
            assert.equal(corrected.email_verified_at, null);
            assert.equal((await req(`/api/operator/accounts/${accountId}/approve`, { method: 'POST', cookie: staffCookie, body: { reason: 'Campus ID checked' } })).status, 409);
            const inbox = (await req('/api/auth/dev-mailbox?email=corrected%40example.test')).data;
            assert.ok(inbox[0].body.includes('#verify?token='));
        });
        await t.test('password reset is single-use and revokes existing sessions', async () => {
            await req('/api/auth/forgot', { method: 'POST', body: { email: 'asha@example.test' } });
            const mail = (await req('/api/auth/dev-mailbox?email=asha%40example.test')).data;
            const secret = mail.find(m => m.subject.includes('Reset')).body.match(/token=([a-f0-9]+)/)[1];
            let r = await req('/api/auth/reset', { method: 'POST', body: { token: secret, password: 'a different strong password' } });
            assert.equal(r.status, 200);
            assert.equal((await req('/api/auth/session', { cookie: studentCookie })).status, 401);
            assert.equal((await req('/api/auth/reset', { method: 'POST', body: { token: secret, password: 'a different strong password' } })).status, 400);
        });
    }
    finally {
        if (server)
            await new Promise(resolve => server.close(resolve));
        if (pool)
            await pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
    }
});

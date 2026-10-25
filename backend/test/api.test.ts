// API integration tests against a real, throwaway PostgreSQL database.
// Requires TEST_DATABASE_URL (never point this at production: the schema file DROPs tables).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const DB = process.env.TEST_DATABASE_URL;
if (!DB || /neon\.tech|render\.com/.test(DB)) throw new Error('Set TEST_DATABASE_URL to a disposable local database (refusing hosted databases).');
process.env.DATABASE_URL = DB;
process.env.NODE_ENV = 'test';
process.env.OPERATOR_LOGIN_PASSWORD = 'integration-test-password';
process.env.SESSION_SECRET = 'integration-test-secret-'.padEnd(48, 'x');
process.env.ESP32_API_KEY = 'integration-test-device-key';

let server: Server; let base = ''; let cookie = '';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pool } = require('../src/db') as typeof import('../src/db');

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json as any, headers: res.headers };
}
const device = { 'x-device-key': 'integration-test-device-key' };

before(async () => {
  await pool.query(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
  const app = (require('../src/server') as typeof import('../src/server')).default;
  server = app.listen(0); await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { server?.close(); await pool.end(); });

test('auth: protected routes reject anonymous callers', async () => {
  for (const [m, p] of [['GET', '/api/slots'], ['GET', '/api/students/24CS104/parcels'], ['POST', '/api/parcels']] as const) {
    assert.equal((await call(m, p, m === 'POST' ? {} : undefined)).status, 401, `${m} ${p}`);
  }
  assert.equal((await call('GET', '/api/device/commands/next')).status, 401);
});

test('auth: wrong password is rejected, right one sets an HttpOnly SameSite cookie', async () => {
  assert.equal((await call('POST', '/api/auth/login', { password: 'nope' })).status, 401);
  const ok = await call('POST', '/api/auth/login', { password: 'integration-test-password' });
  assert.equal(ok.status, 200);
  const set = ok.headers.get('set-cookie') ?? '';
  assert.match(set, /HttpOnly/); assert.match(set, /SameSite=Strict/);
  cookie = set.split(';')[0];
  assert.deepEqual((await call('GET', '/api/auth/session')).body, { authenticated: true });
});

test('a forged session cookie is rejected', async () => {
  const forged = cookie.replace(/\.[^.]+$/, '.AAAA');
  const r = await fetch(base + '/api/slots', { headers: { cookie: forged } });
  assert.equal(r.status, 401);
});

test('malformed JSON returns 400 (not 500); unknown API routes return JSON 404', async () => {
  assert.equal((await call('POST', '/api/parcels', '{bad json')).status, 400);
  const nf = await call('GET', '/api/does-not-exist');
  assert.equal(nf.status, 404); assert.equal(nf.body.error, 'Not found');
});

test('slots: returns 3 slots x 2 compartments from the database', async () => {
  const r = await call('GET', '/api/slots');
  assert.equal(r.status, 200); assert.equal(r.body.length, 3);
  assert.ok(r.body.every((s: any) => s.compartments.length === 2));
});

test('register parcel: validation, creation, duplicate tracking ID', async () => {
  assert.equal((await call('POST', '/api/parcels', { registrationNo: '24CS104;DROP', studentName: 'Test Student', trackingId: 'TRK-1', paymentType: 'PREPAID' })).status, 400);
  assert.equal((await call('POST', '/api/parcels', { registrationNo: '24CS104', studentName: '', trackingId: 'TRK-1', paymentType: 'PREPAID' })).status, 400);
  const created = await call('POST', '/api/parcels', { registrationNo: '24CS104', studentName: 'Test Student', trackingId: 'TRK-1', paymentType: 'PREPAID' });
  assert.equal(created.status, 201); assert.equal(created.body.parcel_status, 'REGISTERED'); assert.equal(created.body.registration_no, '24CS104');
  const dup = await call('POST', '/api/parcels', { registrationNo: '24CS104', studentName: 'Test Student', trackingId: 'TRK-1', paymentType: 'PREPAID' });
  assert.equal(dup.status, 409);
  const count = await pool.query("SELECT COUNT(*)::int n FROM parcels WHERE tracking_id='TRK-1'");
  assert.equal(count.rows[0].n, 1);
});

test('lookup: known student, leading zeros preserved, unknown -> 404, malformed -> 400', async () => {
  await call('POST', '/api/parcels', { registrationNo: '0012345', studentName: 'Zero Lead', trackingId: 'TRK-0', paymentType: 'COD' });
  const lead = await call('GET', '/api/students/0012345/parcels');
  assert.equal(lead.status, 200); assert.equal(lead.body.registrationNo, '0012345'); assert.equal(lead.body.parcels.length, 1);
  assert.equal((await call('GET', '/api/students/12345/parcels')).status, 404, '12345 must not match 0012345');
  assert.equal((await call('GET', '/api/students/99ZZ999/parcels')).status, 404);
  assert.equal((await call('GET', `/api/students/${encodeURIComponent('24CS104;DROP')}/parcels`)).status, 400);
  assert.equal((await call('GET', `/api/students/${'A'.repeat(65)}/parcels`)).status, 400);
});

test('lookup: case-insensitive fallback is used only when unambiguous', async () => {
  const lower = await call('GET', '/api/students/24cs104/parcels');
  assert.equal(lower.status, 200); assert.equal(lower.body.registrationNo, '24CS104');
  // Registering with different case reuses the same student instead of creating a duplicate.
  await call('POST', '/api/parcels', { registrationNo: '24cs104', studentName: 'Test Student', trackingId: 'TRK-2', paymentType: 'PREPAID' });
  const n = await pool.query("SELECT COUNT(*)::int n FROM students WHERE UPPER(registration_no)='24CS104'");
  assert.equal(n.rows[0].n, 1);
  // Two pre-existing records that differ only by case -> ambiguous for a third spelling.
  await pool.query("INSERT INTO students(registration_no, student_name) VALUES ('ab12','A'),('AB12','B')");
  assert.equal((await call('GET', '/api/students/Ab12/parcels')).status, 409);
  assert.equal((await call('GET', '/api/students/ab12/parcels')).status, 200, 'exact match still wins');
});

test('the old route aliasing is gone: POST /api/students no longer creates parcels', async () => {
  const r = await call('POST', '/api/students', { registrationNo: 'X1', studentName: 'X', trackingId: 'TRK-X', paymentType: 'PREPAID' });
  assert.equal(r.status, 404);
});

test('full pickup flow: store -> light command (deduplicated) -> device poll -> removal event (idempotent)', async () => {
  const lookup = await call('GET', '/api/students/24CS104/parcels');
  const parcel = lookup.body.parcels.find((p: any) => p.tracking_id === 'TRK-1');
  const slots = (await call('GET', '/api/slots')).body;
  const comp = slots[1].compartments[0];
  assert.equal((await call('POST', `/api/parcels/${parcel.parcel_id}/retrieve`)).status, 409, 'cannot light an unstored parcel');
  assert.equal((await call('POST', `/api/parcels/not-a-uuid/store`, { compartmentId: comp.compartmentId })).status, 400);
  assert.equal((await call('POST', `/api/parcels/${parcel.parcel_id}/store`, { compartmentId: comp.compartmentId })).status, 200);
  assert.equal((await call('POST', `/api/parcels/${parcel.parcel_id}/store`, { compartmentId: comp.compartmentId })).status, 409, 'double store rejected');
  const other = (await call('GET', '/api/students/24CS104/parcels')).body.parcels.find((p: any) => p.tracking_id === 'TRK-2');
  assert.equal((await call('POST', `/api/parcels/${other.parcel_id}/store`, { compartmentId: comp.compartmentId })).status, 409, 'occupied compartment rejected');

  const first = await call('POST', `/api/parcels/${parcel.parcel_id}/retrieve`);
  const second = await call('POST', `/api/parcels/${parcel.parcel_id}/retrieve`);
  assert.equal(first.status, 202); assert.equal(first.body.existing, false);
  assert.equal(second.body.commandId, first.body.commandId); assert.equal(second.body.existing, true);

  const poll = await call('GET', '/api/device/commands/next', undefined, device);
  assert.equal(poll.body.command.command_id, first.body.commandId);
  assert.deepEqual([poll.body.command.slot_no, poll.body.command.compartment_no], [2, 1]);
  assert.equal((await call('GET', '/api/device/commands/next', undefined, device)).body.command, null);
  assert.equal((await call('POST', `/api/device/commands/${first.body.commandId}/result`, { result: 'EXECUTED' }, device)).status, 200);

  const ev = { sourceEventKey: 'unit-1-s2-c1-000001', slotNo: 2, compartmentNo: 1 };
  assert.deepEqual((await call('POST', '/api/device/events', ev, device)).body, { processed: true });
  const again = await call('POST', '/api/device/events', ev, device);
  assert.equal(again.body.duplicate, true);
  const after = (await call('GET', '/api/students/24CS104/parcels')).body.parcels.find((p: any) => p.tracking_id === 'TRK-1');
  assert.equal(after.parcel_status, 'COLLECTED');
  const c = await pool.query('SELECT occupancy_status FROM compartments WHERE compartment_id=$1', [comp.compartmentId]);
  assert.equal(c.rows[0].occupancy_status, 'EMPTY');
  const logs = await pool.query("SELECT COUNT(*)::int n FROM activity_logs WHERE parcel_id=$1 AND event_type='PARCEL_REMOVED'", [parcel.parcel_id]);
  assert.equal(logs.rows[0].n, 1, 'removal processed exactly once');
});

test('security headers are set', async () => {
  const r = await fetch(base + '/api/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('permissions-policy') ?? '', /camera=\(self\)/);
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('logout clears the session', async () => {
  const r = await call('POST', '/api/auth/logout');
  assert.match(r.headers.get('set-cookie') ?? '', /Max-Age=0/);
});

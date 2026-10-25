import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// Resets the disposable test database with the local test schema + synthetic fixtures.
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL to a disposable local PostgreSQL database.');
  if (/neon\.tech|render\.com/.test(url)) throw new Error('Refusing to reset a hosted database.');
  const require = createRequire(join(import.meta.dirname, '..', '..', '..', 'backend', 'package.json'));
  const { Client } = require('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(readFileSync(join(import.meta.dirname, '..', '..', '..', 'backend', 'test', 'schema.sql'), 'utf8'));
  await client.end();
}

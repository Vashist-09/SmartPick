import { Pool, PoolClient } from 'pg';

function neonConnectionOptions(connectionString: string | undefined) {
  if (!connectionString) return { connectionString };
  const url = new URL(connectionString);
  if (!url.hostname.endsWith('neon.tech')) return { connectionString };

  // pg-connection-string can replace Pool's ssl object based on URL SSL parameters.
  // Strip those parameters in memory, then require normal CA and hostname verification.
  const sslParameters = new Set(['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslpassword', 'uselibpqcompat']);
  for (const key of [...url.searchParams.keys()]) if (sslParameters.has(key.toLowerCase())) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: true } };
}

export const pool = new Pool({
  ...neonConnectionOptions(process.env.DATABASE_URL),
});

export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

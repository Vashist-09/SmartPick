import { Router } from 'express';
import { pool } from '../db';
const router = Router();
router.get('/', (_req, res) => res.json({ status: 'ok' }));
router.get('/db', async (_req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
    }
    catch {
        res.status(503).json({ status: 'unavailable', database: 'disconnected' });
    }
});
router.get('/ready', async (_req, res) => {
    try {
        await pool.query('SELECT workflow_status FROM parcels LIMIT 0');
        await pool.query('SELECT account_id FROM app_accounts LIMIT 0');
        await pool.query('SELECT pickup_id FROM pickup_attempts LIMIT 0');
        res.json({ status: 'ready' });
    }
    catch {
        res.status(503).json({ status: 'unavailable', error: 'Database workflow setup is incomplete.' });
    }
});
export default router;

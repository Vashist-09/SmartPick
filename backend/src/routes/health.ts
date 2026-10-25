import { Router } from 'express';
import { pool } from '../db';

const router = Router();
router.get('/', (_req, res) => res.json({ status: 'ok' }));
router.get('/db', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }
  catch { res.status(503).json({ status: 'unavailable', database: 'disconnected' }); }
});
export default router;

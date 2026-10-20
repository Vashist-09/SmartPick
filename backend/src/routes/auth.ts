import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { clearOperatorSession, hasOperatorSession, setOperatorSession } from '../middleware/auth';

const router = Router();
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function matchesPassword(candidate: string, expected: string, secret: string) {
  const candidateHash = createHmac('sha256', secret).update(candidate).digest();
  const expectedHash = createHmac('sha256', secret).update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

function getAttemptCount(ip: string) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.resetAt <= now) attempts.delete(key);
  const current = attempts.get(ip);
  if (!current || current.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return 1;
  }
  current.count += 1;
  return current.count;
}

router.get('/session', (req, res) => res.json({ authenticated: hasOperatorSession(req) }));

router.post('/login', (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const password = process.env.OPERATOR_LOGIN_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!password || !sessionSecret || sessionSecret.length < 32) return res.status(503).json({ error: 'Operator sign-in is not configured' });
  if (getAttemptCount(ip) > MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
  const candidate = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!matchesPassword(candidate, password, sessionSecret)) return res.status(401).json({ error: 'Invalid password' });
  attempts.delete(ip);
  setOperatorSession(res);
  res.json({ authenticated: true });
});

router.post('/logout', (_req, res) => {
  clearOperatorSession(res);
  res.json({ authenticated: false });
});

export default router;

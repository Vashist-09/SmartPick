import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

const COOKIE_NAME = 'smartpick_operator';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function signature(expiresAt: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  return createHmac('sha256', secret).update(expiresAt).digest('base64url');
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(req: Request, name: string) {
  const cookies = req.headers.cookie?.split(';') ?? [];
  const entry = cookies.map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : '';
}

export function hasOperatorSession(req: Request) {
  const token = cookieValue(req, COOKIE_NAME);
  const [expiresAt, nonce, suppliedSignature] = token.split('.');
  if (!expiresAt || !nonce || !suppliedSignature || !Number.isFinite(Number(expiresAt)) || Number(expiresAt) <= Date.now()) return false;
  const expected = signature(`${expiresAt}.${nonce}`);
  return Boolean(expected && safeEqual(suppliedSignature, expected));
}

export function setOperatorSession(res: Response) {
  const expiresAt = String(Date.now() + SESSION_TTL_SECONDS * 1000);
  const nonce = randomBytes(32).toString('base64url');
  const signed = signature(`${expiresAt}.${nonce}`);
  if (!signed) throw new Error('SESSION_SECRET is not configured');
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${expiresAt}.${nonce}.${signed}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

export function clearOperatorSession(res: Response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

export function requireOperator(req: Request, res: Response, next: NextFunction) {
  if (hasOperatorSession(req)) return next();
  const key = process.env.OPERATOR_API_KEY;
  if (!key || !safeEqual(req.header('x-operator-key') ?? '', key)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

export function requireDevice(req: Request, res: Response, next: NextFunction) {
  const key = process.env.ESP32_API_KEY;
  if (!key || !safeEqual(req.header('x-device-key') ?? '', key)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

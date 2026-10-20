import { NextFunction, Request, Response } from 'express';

export function requireOperator(req: Request, res: Response, next: NextFunction) {
  const key = process.env.OPERATOR_API_KEY;
  if (!key || req.header('x-operator-key') !== key) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

export function requireDevice(req: Request, res: Response, next: NextFunction) {
  const key = process.env.ESP32_API_KEY;
  if (!key || req.header('x-device-key') !== key) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

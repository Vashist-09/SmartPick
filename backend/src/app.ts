import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import healthRoutes from './routes/health';
import slotRoutes from './routes/slots';
import parcelRoutes from './routes/parcels';
import deviceRoutes from './routes/device';
import authRoutes from './routes/auth';
import meRoutes from './routes/me';
import pickupRoutes from './routes/pickups';
import operatorRoutes from './routes/operator';
import { HttpError } from './http';
export const app = express();
app.disable('x-powered-by');
const origins = () => (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5174').split(',').map(s => s.trim());
app.use(cors({ origin: (origin, cb) => cb(null, !origin || origins().includes(origin)), credentials: true }));
app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});
app.use((req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.path.startsWith('/api/device/')) {
        const origin = req.header('origin');
        if (!origin || !origins().includes(origin))
            return next(new HttpError(403, 'Request origin is not allowed.'));
    }
    next();
});
const windows = new Map<string, {
    count: number;
    until: number;
}>();
app.use((req, res, next) => {
    if (req.path.startsWith('/api/device/'))
        return next();
    const auth = req.path.startsWith('/api/auth/') && req.method === 'POST';
    const key = `${req.socket.remoteAddress}:${auth ? 'auth' : 'api'}`;
    const now = Date.now();
    if (windows.size > 10000)
        for (const [k, v] of windows)
            if (v.until < now)
                windows.delete(k);
    if (windows.size > 20000)
        return next(new HttpError(503, 'Please retry shortly.'));
    let entry = windows.get(key);
    if (!entry || entry.until < now) {
        entry = { count: 0, until: now + 60000 };
        windows.set(key, entry);
    }
    if (++entry.count > (auth ? 30 : 240)) {
        res.setHeader('Retry-After', Math.ceil((entry.until - now) / 1000));
        return next(new HttpError(429, 'Too many requests. Please retry shortly.'));
    }
    next();
});
app.use(express.json({ limit: '32kb' }));
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/slots', slotRoutes);
app.use('/api', pickupRoutes);
app.use('/api/parcels', parcelRoutes);
app.use('/api/device', deviceRoutes);
app.use('/api/operator', operatorRoutes);
app.use((_req, _res, next) => next(new HttpError(404, 'Endpoint not found.', 'NOT_FOUND')));
app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = error instanceof HttpError ? error.status : error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 : 500;
    if (status === 500)
        console.error('Request failed:', error.code || error.name);
    res.status(status).json({ error: status === 500 ? 'Internal server error.' : status === 400 && error.type ? 'Malformed JSON.' : status === 413 ? 'Request body is too large.' : error.message, code: error.code || 'REQUEST_FAILED' });
});

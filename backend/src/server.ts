import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import authRoutes from './routes/auth';
import healthRoutes from './routes/health';
import slotRoutes from './routes/slots';
import parcelRoutes from './routes/parcels';
import deviceRoutes from './routes/device';
import studentRoutes from './routes/students';

const app=express();
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  // The ID scanner needs the camera on this origin only.
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  next();
});
app.use(express.json({limit:'32kb'}));
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use('/api/auth',authRoutes);
app.use('/api/health',healthRoutes);
app.use('/api/slots',slotRoutes);
app.use('/api/parcels',parcelRoutes);
app.use('/api/students',studentRoutes);
app.use('/api/device',deviceRoutes);
app.use('/api',(_req,res)=>res.status(404).json({error:'Not found'}));
const frontendDist=resolve(__dirname,'../../frontend/dist');
if(existsSync(frontendDist)) app.use(express.static(frontendDist,{index:'index.html',maxAge:process.env.NODE_ENV==='production'?'1h':0}));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const bodyError = error as { type?: string; status?: number };
  if (bodyError?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
  if (bodyError?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
  if (error instanceof Error) {
    console.error('Request failed:', error.message);

    if (process.env.NODE_ENV !== 'production') {
      console.error(error.stack);
    }
  } else {
    console.error('Request failed with a non-Error value:', error);
  }

  res.status(500).json({ error: 'Internal server error' });
});
export default app;
if (require.main === module) {
  const port=Number(process.env.PORT)||5050;
  app.listen(port,()=>console.log(`SmartPick backend listening on ${port}`));
}

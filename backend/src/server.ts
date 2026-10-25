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

const app=express();
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.use(express.json({limit:'32kb'}));
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use('/api/auth',authRoutes);
app.use('/api/health',healthRoutes);
app.use('/api/slots',slotRoutes);
app.use('/api/parcels',parcelRoutes);
app.use('/api/students',parcelRoutes);
app.use('/api/device',deviceRoutes);
const frontendDist=resolve(__dirname,'../../frontend/dist');
if(existsSync(frontendDist)) app.use(express.static(frontendDist,{index:'index.html',maxAge:process.env.NODE_ENV==='production'?'1h':0}));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
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
const port=Number(process.env.PORT)||5050;
app.listen(port,()=>console.log(`SmartPick backend listening on ${port}`));

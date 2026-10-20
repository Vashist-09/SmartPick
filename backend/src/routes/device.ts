import { Router, Request, Response, NextFunction } from 'express';
import { pool, withTx } from '../db';
import { requireDevice } from '../middleware/auth';
import { commandResultSchema, eventSchema, uuidSchema } from '../schemas';

const router=Router();
const asyncRoute=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req,res).catch(next);};
router.use(requireDevice);

router.get('/commands/next',asyncRoute(async(_req,res)=>{
  const command=await withTx(async c=>{
    const device=await c.query(`UPDATE hardware_devices SET last_seen_at=NOW(),device_status='ONLINE' WHERE device_id=(SELECT device_id FROM hardware_devices ORDER BY created_at LIMIT 1) RETURNING device_id`);
    if(!device.rowCount)return null;
    const next=await c.query(`SELECT h.command_id,h.command_type,h.parcel_id,h.compartment_id,s.slot_no,c.compartment_no FROM hardware_commands h JOIN compartments c USING(compartment_id) JOIN slots s USING(slot_id) WHERE h.device_id=$1 AND h.command_status='PENDING' ORDER BY h.created_at FOR UPDATE OF h SKIP LOCKED LIMIT 1`,[device.rows[0].device_id]);
    if(!next.rowCount)return null;
    await c.query(`UPDATE hardware_commands SET command_status='ACKNOWLEDGED',acknowledged_at=NOW() WHERE command_id=$1`,[next.rows[0].command_id]);
    return next.rows[0];
  });
  res.json({command});
}));

router.post('/commands/:commandId/result',asyncRoute(async(req,res)=>{
  const id=uuidSchema.safeParse(req.params.commandId), body=commandResultSchema.safeParse(req.body);
  if(!id.success||!body.success)return res.status(400).json({error:'Invalid command result'});
  const result=await pool.query(`UPDATE hardware_commands SET command_status=$2,completed_at=NOW() WHERE command_id=$1 AND command_status='ACKNOWLEDGED'`,[id.data,body.data.result]);
  if(!result.rowCount)return res.status(409).json({error:'Command is missing or not acknowledged'});
  res.json({status:body.data.result});
}));

router.post('/events',asyncRoute(async(req,res)=>{
  const body=eventSchema.safeParse(req.body); if(!body.success)return res.status(400).json({error:'Invalid event',details:body.error.flatten()});
  const out=await withTx(async c=>{
    const device=await c.query(`SELECT device_id FROM hardware_devices ORDER BY created_at LIMIT 1`);
    if(!device.rowCount)return {error:503,message:'No device configured'};
    const inserted=await c.query(`INSERT INTO hardware_events(device_id,source_event_key,parcel_id,compartment_id,event_type,processing_status,occurred_at) VALUES($1,$2,$3,$4,'PARCEL_REMOVED','RECEIVED',$5) ON CONFLICT(device_id,source_event_key) DO NOTHING RETURNING event_id`,[device.rows[0].device_id,body.data.sourceEventKey,body.data.parcelId,body.data.compartmentId,body.data.occurredAt??null]);
    if(!inserted.rowCount){const prev=await c.query(`SELECT processing_status FROM hardware_events WHERE device_id=$1 AND source_event_key=$2`,[device.rows[0].device_id,body.data.sourceEventKey]);return {duplicate:true,status:prev.rows[0]?.processing_status};}
    const eventId=inserted.rows[0].event_id;
    const parcel=await c.query(`SELECT p.student_id,p.parcel_status,p.compartment_id,c.occupancy_status,s.slot_id FROM parcels p LEFT JOIN compartments c ON c.compartment_id=p.compartment_id LEFT JOIN slots s ON s.slot_id=c.slot_id WHERE p.parcel_id=$1 FOR UPDATE OF p`,[body.data.parcelId]);
    if(!parcel.rowCount||parcel.rows[0].parcel_status!=='STORED'||parcel.rows[0].compartment_id!==body.data.compartmentId||parcel.rows[0].occupancy_status!=='OCCUPIED'){
      await c.query(`UPDATE hardware_events SET processing_status='REJECTED',processed_at=NOW() WHERE event_id=$1`,[eventId]); return {rejected:true};
    }
    await c.query(`UPDATE parcels SET parcel_status='COLLECTED',collected_at=NOW() WHERE parcel_id=$1`,[body.data.parcelId]);
    await c.query(`UPDATE compartments SET occupancy_status='EMPTY' WHERE compartment_id=$1`,[body.data.compartmentId]);
    await c.query(`UPDATE hardware_events SET processing_status='PROCESSED',processed_at=NOW() WHERE event_id=$1`,[eventId]);
    await c.query(`INSERT INTO activity_logs(parcel_id,student_id,slot_id,compartment_id,device_id,event_type,details) VALUES($1,$2,$3,$4,$5,'PARCEL_REMOVED',$6)`,[body.data.parcelId,parcel.rows[0].student_id,parcel.rows[0].slot_id,body.data.compartmentId,device.rows[0].device_id,{sourceEventKey:body.data.sourceEventKey}]);
    return {processed:true};
  });
  if('error'in out)return res.status(out.error ?? 500).json({error:out.message});
  if('rejected'in out)return res.status(409).json({status:'REJECTED'});
  res.json(out);
}));
export default router;

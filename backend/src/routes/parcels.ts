import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { pool, withTx } from '../db';
import { requireOperator } from '../middleware/auth';
import { parcelSchema, storeSchema, uuidSchema } from '../schemas';

const router = Router();
const asyncRoute = (fn: (req:Request,res:Response)=>Promise<unknown>) => (req:Request,res:Response,next:NextFunction) => { void fn(req,res).catch(next); };
router.use(requireOperator);

router.post('/', asyncRoute(async (req,res) => {
  const input=parcelSchema.safeParse(req.body); if(!input.success)return res.status(400).json({error:'Invalid request',details:input.error.flatten()});
  try {
    const result=await withTx(async c=>{
      const student=await c.query(`INSERT INTO students(registration_no,student_name) VALUES($1,$2) ON CONFLICT(registration_no) DO UPDATE SET student_name=EXCLUDED.student_name RETURNING student_id`,[input.data.registrationNo,input.data.studentName]);
      return c.query(`INSERT INTO parcels(tracking_id,student_id,parcel_status,payment_type,payment_status) VALUES($1,$2,'REGISTERED',$3,$4) RETURNING parcel_id,tracking_id,parcel_status`,[input.data.trackingId,student.rows[0].student_id,input.data.paymentType,input.data.paymentStatus ?? (input.data.paymentType==='COD'?'PENDING':'PAID')]);
    });
    res.status(201).json(result.rows[0]);
  } catch(error) { if((error as {code?:string}).code==='23505')return res.status(409).json({error:'Tracking ID already exists'}); throw error; }
}));

router.post('/:parcelId/store', asyncRoute(async(req,res)=>{
  const id=uuidSchema.safeParse(req.params.parcelId), body=storeSchema.safeParse(req.body);
  if(!id.success||!body.success)return res.status(400).json({error:'Invalid parcel or compartment ID'});
  const out=await withTx(async c=>{
    const parcel=await c.query(`SELECT student_id,parcel_status FROM parcels WHERE parcel_id=$1 FOR UPDATE`,[id.data]);
    if(!parcel.rowCount)return {error:404,message:'Parcel not found'};
    if(parcel.rows[0].parcel_status!=='REGISTERED')return {error:409,message:'Parcel is not registered'};
    const comp=await c.query(`SELECT c.occupancy_status,s.slot_id,s.slot_status,s.slot_no,c.compartment_no FROM compartments c JOIN slots s USING(slot_id) WHERE c.compartment_id=$1 FOR UPDATE OF c`,[body.data.compartmentId]);
    if(!comp.rowCount)return {error:404,message:'Compartment not found'};
    if(comp.rows[0].occupancy_status!=='EMPTY'||comp.rows[0].slot_status!=='ACTIVE')return {error:409,message:'Compartment is not available'};
    await c.query(`UPDATE parcels SET compartment_id=$2,parcel_status='STORED',stored_at=NOW() WHERE parcel_id=$1`,[id.data,body.data.compartmentId]);
    await c.query(`UPDATE compartments SET occupancy_status='OCCUPIED' WHERE compartment_id=$1`,[body.data.compartmentId]);
    await c.query(`INSERT INTO activity_logs(parcel_id,student_id,slot_id,compartment_id,event_type,details) VALUES($1,$2,$3,$4,'PARCEL_STORED',$5)`,[id.data,parcel.rows[0].student_id,comp.rows[0].slot_id,body.data.compartmentId,{slotNo:comp.rows[0].slot_no,compartmentNo:comp.rows[0].compartment_no}]);
    return {status:'STORED'};
  });
  if('error'in out)return res.status(out.error ?? 500).json({error:out.message}); res.json(out);
}));

router.get('/:registrationNo/parcels',asyncRoute(async(req,res)=>{
  const {rows}=await pool.query(`SELECT p.parcel_id,p.tracking_id,p.parcel_status,p.compartment_id,s.slot_no,c.compartment_no FROM parcels p JOIN students st USING(student_id) LEFT JOIN compartments c USING(compartment_id) LEFT JOIN slots s USING(slot_id) WHERE st.registration_no=$1 ORDER BY p.created_at DESC`,[req.params.registrationNo]);
  res.json(rows);
}));

router.post('/:parcelId/retrieve',asyncRoute(async(req,res)=>{
  const id=uuidSchema.safeParse(req.params.parcelId); if(!id.success)return res.status(400).json({error:'Invalid parcel ID'});
  const out=await withTx(async c=>{
    const p=await c.query(`SELECT compartment_id,parcel_status FROM parcels WHERE parcel_id=$1 FOR UPDATE`,[id.data]);
    if(!p.rowCount)return {error:404,message:'Parcel not found'};
    if(p.rows[0].parcel_status!=='STORED')return {error:409,message:'Parcel is not stored'};
    const existing=await c.query(`SELECT command_id FROM hardware_commands WHERE parcel_id=$1 AND command_status IN ('PENDING','ACKNOWLEDGED') LIMIT 1`,[id.data]);
    if(existing.rowCount)return {commandId:existing.rows[0].command_id,status:'queued'};
    const device=await c.query(`SELECT device_id FROM hardware_devices ORDER BY created_at LIMIT 1`);
    if(!device.rowCount)return {error:503,message:'No device configured'};
    const command=await c.query(`INSERT INTO hardware_commands(device_id,parcel_id,compartment_id,command_type,command_status) VALUES($1,$2,$3,'LIGHT_COMPARTMENT','PENDING') RETURNING command_id`,[device.rows[0].device_id,id.data,p.rows[0].compartment_id]);
    return {commandId:command.rows[0].command_id,status:'queued'};
  });
  if('error'in out)return res.status(out.error ?? 500).json({error:out.message}); res.status(202).json(out);
}));
export default router;

import { FormEvent, useState } from 'react';
import { api } from '../api';
import type { Parcel } from '../types';
import { BarcodeScanner } from './BarcodeScanner';

export function StudentLookup(){
  const [registrationNo,setRegistrationNo]=useState('');
  const [rows,setRows]=useState<Parcel[]>([]);
  const [notice,setNotice]=useState('');
  const [scanning,setScanning]=useState(false);
  const [loading,setLoading]=useState(false);
  const [queueing,setQueueing]=useState<string|null>(null);
  const [searched,setSearched]=useState(false);

  async function lookup(registration:string){
    const value=registration.trim();
    if(!value)return;
    setRegistrationNo(value);setNotice('');setRows([]);setSearched(false);setLoading(true);
    try{setRows(await api<Parcel[]>(`/api/students/${encodeURIComponent(value)}/parcels`));setSearched(true);}
    catch(err){setNotice(err instanceof Error?err.message:'Lookup failed.');}
    finally{setLoading(false);}
  }
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();await lookup(registrationNo);}
  async function lightCompartment(parcel:Parcel){
    setQueueing(parcel.parcel_id);setNotice('');
    try{await api<{commandId:string;status:string}>(`/api/parcels/${encodeURIComponent(parcel.parcel_id)}/retrieve`,{method:'POST'});setNotice(`Light command queued for Slot ${parcel.slot_no}, Compartment ${parcel.compartment_no}. The ESP32 will activate it when it polls the server.`);}
    catch(err){setNotice(err instanceof Error?err.message:'Could not queue the compartment light.');}
    finally{setQueueing(null);}
  }

  return <section className="panel">
    <div className="section-heading"><div><span className="eyebrow">STUDENT PICKUP</span><h2>Find a student</h2></div><span className="step">02</span></div>
    <form className="inline-form" onSubmit={submit}><input value={registrationNo} onChange={e=>setRegistrationNo(e.target.value)} required placeholder="Student registration number"/><button type="button" className="secondary" onClick={()=>setScanning(true)}>Scan ID card</button><button className="secondary" disabled={loading}>{loading?'Searching…':'Look up'}</button></form>
    {notice&&<p className={`notice ${notice.includes('Could not')||notice.includes('failed')?'error':''}`}>{notice}</p>}
    {rows.length>0&&<div className="parcel-list">{rows.map(p=><div className="parcel-row" key={p.parcel_id}><div><strong>{p.tracking_id}</strong><small>{p.slot_no!==null&&p.compartment_no!==null?`Slot ${p.slot_no} · Compartment ${p.compartment_no}`:'Not stored yet'}</small></div><span className={`pill ${p.parcel_status.toLowerCase()}`}>{p.parcel_status}</span>{p.parcel_status==='STORED'&&<button className="text-button" disabled={queueing!==null} onClick={()=>void lightCompartment(p)}>{queueing===p.parcel_id?'Queuing…':'Light compartment ↗'}</button>}</div>)}</div>}
    {!loading&&!notice&&rows.length===0&&<p className="hint">{searched?'No parcels found for this registration number.':'Scan a student ID or enter their registration number to see parcels and storage locations.'}</p>}
    {scanning&&<BarcodeScanner onScan={value=>{setScanning(false);void lookup(value);}} onClose={()=>setScanning(false)}/>}
  </section>;
}

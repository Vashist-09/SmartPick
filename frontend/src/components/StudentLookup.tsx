import { FormEvent, useState } from 'react';
import { api } from '../api';
import type { Parcel } from '../types';
export function StudentLookup({onRetrieve}:{onRetrieve:(p:Parcel)=>void}){
  const [rows,setRows]=useState<Parcel[]>([]),[notice,setNotice]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const reg=String(new FormData(e.currentTarget).get('registrationNo'));setNotice('');try{setRows(await api<Parcel[]>(`/api/students/${encodeURIComponent(reg)}/parcels`));}catch(err){setNotice(err instanceof Error?err.message:'Lookup failed.');}}
  return <section className="panel"><div className="section-heading"><div><span className="eyebrow">STUDENT PICKUP</span><h2>Find a student</h2></div><span className="step">02</span></div><form className="inline-form" onSubmit={submit}><input name="registrationNo" required placeholder="Scan student registration number"/><button className="secondary">Look up</button></form>{notice&&<p className="notice error">{notice}</p>}{rows.length>0&&<div className="parcel-list">{rows.map(p=><div className="parcel-row" key={p.parcel_id}><div><strong>{p.tracking_id}</strong><small>{p.slot_no?`Slot ${p.slot_no} · Compartment ${p.compartment_no}`:'Not stored yet'}</small></div><span className={`pill ${p.parcel_status.toLowerCase()}`}>{p.parcel_status}</span>{p.parcel_status==='STORED'&&<button className="text-button" onClick={()=>onRetrieve(p)}>Light compartment ↗</button>}</div>)}</div>}{rows.length===0&&!notice&&<p className="hint">Search by student ID to see parcel status and pickup location.</p>}</section>;
}

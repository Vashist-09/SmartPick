import { FormEvent, useState } from 'react';
import { api } from '../api';
import type { Parcel, Slot } from '../types';

export function StorageAssignment({slots,onStored}:{slots:Slot[];onStored:()=>void}){
  const [registrationNo,setRegistrationNo]=useState('');
  const [parcels,setParcels]=useState<Parcel[]>([]);
  const [parcelId,setParcelId]=useState('');
  const [compartmentId,setCompartmentId]=useState('');
  const [loadingLookup,setLoadingLookup]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const available=slots.flatMap(slot=>slot.status==='ACTIVE'?slot.compartments.filter(c=>c.occupancyStatus==='EMPTY').map(c=>({id:c.compartmentId,label:`Slot ${slot.slotNo} · Compartment ${c.compartmentNo}`})):[]);

  async function lookup(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const form=e.currentTarget;
    const registration=String(new FormData(form).get('registrationNo')||'').trim();
    setRegistrationNo(registration);setLoadingLookup(true);setError('');setNotice('');setParcels([]);setParcelId('');
    try{
      const found=await api<Parcel[]>(`/api/students/${encodeURIComponent(registration)}/parcels`);
      setParcels(found.filter(parcel=>parcel.parcel_status==='REGISTERED'));
    }catch(err){setError(err instanceof Error?err.message:'Could not load registered parcels.');}
    finally{setLoadingLookup(false);}
  }

  async function assign(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!parcelId||!compartmentId||saving)return;
    setSaving(true);setError('');setNotice('');
    try{
      await api(`/api/parcels/${encodeURIComponent(parcelId)}/store`,{method:'POST',body:JSON.stringify({compartmentId})});
      setNotice('Parcel assigned to its compartment.');
      setParcelId('');setCompartmentId('');
      onStored();
      const refreshed=await api<Parcel[]>(`/api/students/${encodeURIComponent(registrationNo)}/parcels`);
      setParcels(refreshed.filter(parcel=>parcel.parcel_status==='REGISTERED'));
    }catch(err){setError(err instanceof Error?err.message:'Could not assign parcel.');}
    finally{setSaving(false);}
  }

  return <section className="panel"><div className="section-heading"><div><span className="eyebrow">INVENTORY</span><h2>Assign storage</h2></div><span className="step">01B</span></div>
    <form className="inline-form" onSubmit={lookup}><input name="registrationNo" required placeholder="Student registration number"/><button className="secondary" disabled={loadingLookup}>{loadingLookup?'Loading…':'Find parcels'}</button></form>
    {parcels.length>0&&<form className="form-grid storage-form" onSubmit={assign}>
      <label>Registered parcel<select required value={parcelId} onChange={e=>setParcelId(e.target.value)}><option value="">Select a parcel</option>{parcels.map(p=><option key={p.parcel_id} value={p.parcel_id}>{p.tracking_id}</option>)}</select></label>
      <label>Available compartment<select required value={compartmentId} onChange={e=>setCompartmentId(e.target.value)}><option value="">Select a location</option>{available.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <button className="primary" type="submit" disabled={saving||!available.length}>{saving?'Assigning…':'Assign parcel to compartment'} <span>↗</span></button>
    </form>}
    {!loadingLookup&&registrationNo&&parcels.length===0&&!error&&<p className="hint">No registered parcels found for this student.</p>}
    {!loadingLookup&&parcels.length>0&&!available.length&&<p className="hint">There are no available compartments right now.</p>}
    {error&&<p className="notice error">{error}</p>}{notice&&<p className="notice">{notice}</p>}
  </section>;
}

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Parcel, Slot } from './types';
import { ParcelRegistration } from './components/ParcelRegistration';
import { StudentLookup } from './components/StudentLookup';
import { CompartmentGrid } from './components/CompartmentGrid';
import { ParcelRetrieval } from './components/ParcelRetrieval';
import { StorageAssignment } from './components/StorageAssignment';
import './styles.css';

export default function App(){
  const [slots,setSlots]=useState<Slot[]>([]),[selected,setSelected]=useState<Parcel|null>(null),[health,setHealth]=useState(false),[error,setError]=useState('');
  const refresh=useCallback(async()=>{try{const data=await api<Slot[]>('/api/slots');setSlots(data);setHealth(true);setError('');}catch(e){setHealth(false);setError(e instanceof Error?e.message:'API unavailable.');}},[]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>clearInterval(timer);},[refresh]);
  return <main className="shell"><nav className="topbar"><a className="brand" href="#"><span className="brand-mark">S</span>smartpick<span className="brand-dot">.</span></a><div className="top-meta"><span className="api-state"><i className={health?'online':''}/>{health?'SYSTEM ONLINE':'CONNECTING'}</span><span className="operator">PARCEL DESK <b>↗</b></span></div></nav><header className="hero"><div><span className="eyebrow">CAMPUS PARCEL SYSTEM <span className="live-line"/></span><h1>Every parcel,<br/><em>right where it belongs.</em></h1><p>Register incoming deliveries, locate student parcels, and guide pickups from one calm workspace.</p></div><div className="hero-mark"><span>SP</span><i>✳</i></div></header>{error&&<div className="banner">{error} Check the backend URL and operator key in <code>frontend/.env</code>.</div>}<div className="content-grid"><div className="left-column"><ParcelRegistration/><StorageAssignment slots={slots} onStored={()=>void refresh()}/><StudentLookup onRetrieve={setSelected}/><ParcelRetrieval parcel={selected}/></div><div className="right-column"><CompartmentGrid slots={slots}/><div className="tip"><span>✳</span><p><b>Pickup, made simple</b><br/>Looking up a student shows their parcels. Choose a stored parcel to queue its compartment light.</p></div></div></div><footer><span>SMARTPICK · CAMPUS PARCELS</span><span>BUILT FOR THE IN-BETWEEN <b>✳</b></span></footer></main>;
}

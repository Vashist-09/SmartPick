import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Slot } from './types';
import { ParcelRegistration } from './components/ParcelRegistration';
import { StudentLookup } from './components/StudentLookup';
import { CompartmentGrid } from './components/CompartmentGrid';
import { StorageAssignment } from './components/StorageAssignment';
import { OperatorLogin } from './components/OperatorLogin';
import './styles.css';

export default function App(){
  const [slots,setSlots]=useState<Slot[]>([]),[health,setHealth]=useState(false),[error,setError]=useState(''),[authenticated,setAuthenticated]=useState<boolean|null>(null);
  const refresh=useCallback(async()=>{if(!authenticated)return;try{const data=await api<Slot[]>('/api/slots');setSlots(data);setHealth(true);setError('');}catch(e){setHealth(false);setError(e instanceof Error?e.message:'API unavailable.');}},[authenticated]);
  useEffect(()=>{void api<{authenticated:boolean}>('/api/auth/session').then(result=>setAuthenticated(result.authenticated)).catch(()=>setAuthenticated(false));},[]);
  useEffect(()=>{if(!authenticated)return;void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>clearInterval(timer);},[authenticated,refresh]);
  async function signOut(){try{await api('/api/auth/logout',{method:'POST'});}catch{}finally{setAuthenticated(false);setSlots([]);}}
  if(authenticated===null)return <main className="login-shell"><p>Connecting to SmartPick…</p></main>;
  if(!authenticated)return <OperatorLogin onLogin={()=>setAuthenticated(true)}/>;
  return <main className="shell"><nav className="topbar"><a className="brand" href="#"><span className="brand-mark">S</span>smartpick<span className="brand-dot">.</span></a><div className="top-meta"><span className="api-state"><i className={health?'online':''}/>{health?'SYSTEM ONLINE':'CONNECTING'}</span><span className="operator">PARCEL DESK</span><button className="logout" onClick={()=>void signOut()}>Sign out</button></div></nav><header className="hero"><div><span className="eyebrow">CAMPUS PARCEL SYSTEM <span className="live-line"/></span><h1>Every parcel,<br/><em>right where it belongs.</em></h1><p>Register incoming deliveries, locate student parcels, and guide pickups from one workspace.</p></div><div className="hero-mark"><span>SP</span></div></header>{error&&<div className="banner">{error}</div>}<div className="content-grid"><div className="left-column"><ParcelRegistration/><StorageAssignment slots={slots} onStored={()=>void refresh()}/><StudentLookup/></div><div className="right-column"><CompartmentGrid slots={slots}/><div className="tip"><p><b>Pickup, made simple</b><br/>Scan a student ID, confirm their compartment, then light it for pickup.</p></div></div></div><footer><span>SMARTPICK · CAMPUS PARCELS</span><span>PARCEL DESK</span></footer></main>;
}

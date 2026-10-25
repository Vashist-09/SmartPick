import { useState } from 'react';
import { api } from '../api';
import type { Parcel } from '../types';
export function ParcelRetrieval({parcel}:{parcel:Parcel|null}){
  const [message,setMessage]=useState('');
  async function retrieve(){if(!parcel)return;try{const result=await api<{commandId:string;status:string}>(`/api/parcels/${parcel.parcel_id}/retrieve`,{method:'POST'});setMessage(`Command ${result.status} · ${result.commandId.slice(0,8)}`);}catch(e){setMessage(e instanceof Error?e.message:'Could not queue retrieval.');}}
  return <section className="retrieval panel"><div><span className="eyebrow">OUTBOUND</span><h2>Parcel retrieval</h2><p>{parcel?`Selected parcel ${parcel.tracking_id}`:'Choose a stored parcel from student lookup.'}</p></div><button className="primary" disabled={!parcel} onClick={retrieve}>Queue light command <span>↗</span></button>{message&&<small className="notice">{message}</small>}</section>;
}

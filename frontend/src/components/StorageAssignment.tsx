import { FormEvent, useState } from 'react';
import { api, ApiError, errorMessage } from '../api';
import type { Parcel, Slot } from '../types';
import { describeIdentifierProblem, normalizeRegistration } from '../scanner/identifier';

export function StorageAssignment({ slots, onStored }: { slots: Slot[]; onStored: () => void }) {
  const [registrationInput, setRegistrationInput] = useState('');
  const [registrationNo, setRegistrationNo] = useState('');
  const [parcels, setParcels] = useState<Parcel[] | null>(null);
  const [parcelId, setParcelId] = useState('');
  const [compartmentId, setCompartmentId] = useState('');
  const [loadingLookup, setLoadingLookup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const available = slots.flatMap(slot => slot.status === 'ACTIVE' ? slot.compartments.filter(c => c.occupancyStatus === 'EMPTY').map(c => ({ id: c.compartmentId, label: `Slot ${slot.slotNo} · Compartment ${c.compartmentNo}` })) : []);

  async function fetchRegistered(registration: string) {
    const found = await api<{ registrationNo: string; parcels: Parcel[] }>(`/api/students/${encodeURIComponent(registration)}/parcels`);
    setRegistrationNo(found.registrationNo);
    setParcels(found.parcels.filter(p => p.parcel_status === 'REGISTERED'));
  }

  async function lookup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loadingLookup) return;
    const check = normalizeRegistration(registrationInput);
    setError(''); setNotice(''); setParcels(null); setParcelId('');
    if (!check.ok) { setError(describeIdentifierProblem(check)); return; }
    setLoadingLookup(true);
    try { await fetchRegistered(check.value); }
    catch (err) { setError(err instanceof ApiError && err.status === 404 ? `No student with registration number ${check.value} is on record.` : errorMessage(err, 'Could not load registered parcels.')); }
    finally { setLoadingLookup(false); }
  }

  async function assign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!parcelId || !compartmentId || saving) return;
    setSaving(true); setError(''); setNotice('');
    const label = available.find(c => c.id === compartmentId)?.label;
    try {
      await api(`/api/parcels/${encodeURIComponent(parcelId)}/store`, { method: 'POST', body: JSON.stringify({ compartmentId }) });
      setNotice(`Parcel stored in ${label ?? 'the selected compartment'}.`);
      setParcelId(''); setCompartmentId('');
      onStored();
      await fetchRegistered(registrationNo);
    } catch (err) {
      setError(errorMessage(err, 'Could not assign parcel.'));
      onStored(); // another operator may have taken the compartment; refresh the map either way
    } finally { setSaving(false); }
  }

  return <section className="panel" aria-labelledby="storage-title"><div className="section-heading"><div><span className="eyebrow">INVENTORY</span><h2 id="storage-title">Assign storage</h2></div><span className="step">01B</span></div>
    <form className="inline-form" onSubmit={lookup} noValidate>
      <label className="visually-hidden" htmlFor="storage-registration">Student registration number</label>
      <input id="storage-registration" value={registrationInput} onChange={e => setRegistrationInput(e.target.value)} placeholder="Student registration number" autoComplete="off" spellCheck={false} maxLength={64} />
      <button type="submit" className="btn btn-secondary" disabled={loadingLookup}>{loadingLookup ? 'Loading…' : 'Find parcels'}</button>
    </form>
    {parcels && parcels.length > 0 && <form className="form-grid storage-form" onSubmit={assign}>
      <label>Registered parcel<select required value={parcelId} onChange={e => setParcelId(e.target.value)}><option value="">Select a parcel</option>{parcels.map(p => <option key={p.parcel_id} value={p.parcel_id}>{p.tracking_id}</option>)}</select></label>
      <label>Available compartment<select required value={compartmentId} onChange={e => setCompartmentId(e.target.value)} disabled={!available.length}><option value="">{available.length ? 'Select a location' : 'No compartments free'}</option>{available.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <button className="btn btn-primary btn-block" type="submit" disabled={saving || !available.length || !parcelId || !compartmentId}>{saving ? 'Assigning…' : 'Assign parcel to compartment'} <span aria-hidden="true">↗</span></button>
    </form>}
    {!loadingLookup && parcels && parcels.length === 0 && !error && <p className="hint">{registrationNo} has no parcels waiting to be stored.</p>}
    {!loadingLookup && parcels && parcels.length > 0 && !available.length && <p className="hint">There are no available compartments right now.</p>}
    {error && <p className="notice error" role="alert">{error}</p>}{notice && <p className="notice success" role="status">{notice}</p>}
  </section>;
}

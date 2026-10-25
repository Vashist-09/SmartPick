import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '../api';
import type { Parcel } from '../types';
import { BarcodeScanner, type ScanDetection } from './BarcodeScanner';
import { formatLabel } from '../scanner/decodeCore';
import { describeIdentifierProblem, normalizeRegistration } from '../scanner/identifier';

type Notice = { tone: 'info' | 'success' | 'error'; text: string } | null;
type LookupResult = { registrationNo: string; parcels: Parcel[]; via: string } | null;

export function StudentLookup({ onChanged }: { onChanged?: () => void }) {
  const [registrationNo, setRegistrationNo] = useState('');
  const [result, setResult] = useState<LookupResult>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [queueing, setQueueing] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lookupAbort = useRef<AbortController | null>(null);

  useEffect(() => () => lookupAbort.current?.abort(), []);

  /** Single lookup path for typed, scanned and uploaded identifiers. A newer lookup cancels an older one. */
  const lookup = useCallback(async (raw: string, via: string) => {
    const check = normalizeRegistration(raw);
    if (!check.ok) { setNotice({ tone: 'error', text: describeIdentifierProblem(check) }); setResult(null); return; }
    const value = check.value;
    lookupAbort.current?.abort();
    const controller = new AbortController();
    lookupAbort.current = controller;
    setRegistrationNo(value); setNotice({ tone: 'info', text: `Looking up ${value}…` }); setResult(null); setLoading(true);
    try {
      const response = await api<{ registrationNo: string; parcels: Parcel[] }>(`/api/students/${encodeURIComponent(value)}/parcels`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResult({ registrationNo: response.registrationNo, parcels: response.parcels, via });
      setRegistrationNo(response.registrationNo);
      setNotice(null);
    } catch (err) {
      if (err instanceof ApiError && err.kind === 'aborted') return;
      if (err instanceof ApiError && err.status === 404) setNotice({ tone: 'error', text: `No student with registration number ${value} is on record. Check the number, or register a parcel for them first.` });
      else setNotice({ tone: 'error', text: errorMessage(err, 'Lookup failed.') });
    } finally {
      if (lookupAbort.current === controller) { setLoading(false); lookupAbort.current = null; }
    }
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); if (!loading) await lookup(registrationNo, 'typed'); }

  const onDetected = useCallback((d: ScanDetection) => {
    setScanning(false);
    void lookup(d.value, `${d.source === 'upload' ? 'photo' : 'scan'} · ${formatLabel(d.format)}`);
  }, [lookup]);
  const onClose = useCallback(() => setScanning(false), []);
  const onEditManually = useCallback((raw: string) => {
    setScanning(false);
    if (raw) setRegistrationNo(raw);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  async function lightCompartment(parcel: Parcel) {
    if (queueing) return;
    setQueueing(parcel.parcel_id); setNotice(null);
    try {
      const r = await api<{ commandId: string; status: string; existing?: boolean }>(`/api/parcels/${encodeURIComponent(parcel.parcel_id)}/retrieve`, { method: 'POST' });
      setNotice({ tone: 'success', text: `${r.existing ? 'A light command was already queued' : 'Light command queued'} for Slot ${parcel.slot_no}, Compartment ${parcel.compartment_no}. The locker lights it when the ESP32 next polls the server.` });
      onChanged?.();
    } catch (err) { setNotice({ tone: 'error', text: errorMessage(err, 'Could not queue the compartment light.') }); }
    finally { setQueueing(null); }
  }

  const parcels = result?.parcels ?? [];
  return <section className="panel" aria-labelledby="lookup-title">
    <div className="section-heading"><div><span className="eyebrow">STUDENT PICKUP</span><h2 id="lookup-title">Find a student</h2></div><span className="step">02</span></div>
    <form className="inline-form" onSubmit={submit} noValidate>
      <label className="visually-hidden" htmlFor="lookup-registration">Student registration number</label>
      <input id="lookup-registration" ref={inputRef} value={registrationNo} onChange={e => setRegistrationNo(e.target.value)} placeholder="Student registration number" autoComplete="off" spellCheck={false} maxLength={64} />
      <button type="button" className="btn btn-secondary" onClick={() => setScanning(true)}>Scan ID card</button>
      <button type="submit" className="btn btn-primary btn-compact" disabled={loading}>{loading ? 'Searching…' : 'Look up'}</button>
    </form>
    {notice && <p className={`notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
    {result && <p className="result-meta">Showing parcels for <strong>{result.registrationNo}</strong> <span>({result.via})</span></p>}
    {parcels.length > 0 && <ul className="parcel-list">{parcels.map(p => <li className="parcel-row" key={p.parcel_id}>
      <div><strong className="mono">{p.tracking_id}</strong><small>{p.slot_no !== null && p.compartment_no !== null ? `Slot ${p.slot_no} · Compartment ${p.compartment_no}` : p.parcel_status === 'COLLECTED' ? 'Collected' : 'Not stored yet'}</small></div>
      <span className={`pill ${p.parcel_status.toLowerCase()}`}>{p.parcel_status}</span>
      {p.parcel_status === 'STORED' && <button type="button" className="btn btn-ghost btn-compact" disabled={queueing !== null} onClick={() => void lightCompartment(p)}>{queueing === p.parcel_id ? 'Queuing…' : 'Light compartment'}</button>}
    </li>)}</ul>}
    {result && parcels.length === 0 && <p className="hint">This student has no parcels on record.</p>}
    {!result && !notice && !loading && <p className="hint">Scan a student ID or enter their registration number to see parcels and storage locations.</p>}
    {scanning && <BarcodeScanner onDetected={onDetected} onClose={onClose} onEditManually={onEditManually} />}
  </section>;
}

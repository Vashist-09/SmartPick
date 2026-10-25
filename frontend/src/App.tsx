import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, UNAUTHORIZED_EVENT } from './api';
import type { Slot } from './types';
import { ParcelRegistration } from './components/ParcelRegistration';
import { StudentLookup } from './components/StudentLookup';
import { CompartmentGrid } from './components/CompartmentGrid';
import { StorageAssignment } from './components/StorageAssignment';
import { OperatorLogin } from './components/OperatorLogin';
import './styles.css';

type Health = 'connecting' | 'online' | 'offline';

export default function App() {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [health, setHealth] = useState<Health>('connecting');
  const [error, setError] = useState('');
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [sessionNotice, setSessionNotice] = useState('');

  const refresh = useCallback(async () => {
    if (!authenticated) return;
    try { setSlots(await api<Slot[]>('/api/slots')); setHealth('online'); setError(''); }
    catch (e) { setHealth('offline'); setError(errorMessage(e, 'The SmartPick server is unavailable.')); }
  }, [authenticated]);

  useEffect(() => {
    void api<{ authenticated: boolean }>('/api/auth/session').then(r => setAuthenticated(r.authenticated)).catch(() => setAuthenticated(false));
    const onUnauthorized = () => { setAuthenticated(false); setSlots(null); setSessionNotice('Your session has expired. Sign in again to continue.'); };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [authenticated, refresh]);

  async function signOut() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* the session cookie is cleared server-side; nothing else to do */ }
    finally { setAuthenticated(false); setSlots(null); setSessionNotice(''); }
  }

  if (authenticated === null) return <main className="login-shell"><p className="hint" role="status">Connecting to SmartPick…</p></main>;
  if (!authenticated) return <OperatorLogin notice={sessionNotice} onLogin={() => { setSessionNotice(''); setHealth('connecting'); setAuthenticated(true); }} />;

  const refreshNow = () => void refresh();
  return <main className="shell">
    <nav className="topbar" aria-label="SmartPick">
      <span className="brand"><span className="brand-mark" aria-hidden="true">S</span>smartpick<span className="brand-dot">.</span></span>
      <div className="top-meta">
        <span className="api-state" role="status"><i className={health} aria-hidden="true" />{health === 'online' ? 'SYSTEM ONLINE' : health === 'offline' ? 'SERVER UNREACHABLE' : 'CONNECTING'}</span>
        <span className="operator">PARCEL DESK</span>
        <button type="button" className="btn btn-ghost btn-compact" onClick={() => void signOut()}>Sign out</button>
      </div>
    </nav>
    <header className="hero"><div><span className="eyebrow">CAMPUS PARCEL SYSTEM <span className="live-line" /></span><h1>Every parcel,<br /><em>right where it belongs.</em></h1><p>Register incoming deliveries, locate student parcels, and guide pickups from one workspace.</p></div><div className="hero-mark" aria-hidden="true"><span>SP</span></div></header>
    {error && <div className="banner" role="alert">{error} <button type="button" className="btn btn-ghost btn-compact" onClick={refreshNow}>Retry</button></div>}
    <div className="content-grid">
      <div className="left-column"><ParcelRegistration onRegistered={refreshNow} /><StorageAssignment slots={slots ?? []} onStored={refreshNow} /><StudentLookup onChanged={refreshNow} /></div>
      <div className="right-column"><CompartmentGrid slots={slots} /><div className="tip"><p><b>Pickup, made simple</b><br />Scan a student ID, confirm their compartment, then light it for pickup.</p></div></div>
    </div>
    <footer><span>SMARTPICK · CAMPUS PARCELS</span><span>PARCEL DESK</span></footer>
  </main>;
}

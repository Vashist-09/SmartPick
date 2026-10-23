import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Account, Parcel, Slot } from './types';
import { ParcelRegistration } from './components/ParcelRegistration';
import { StudentLookup } from './components/StudentLookup';
import { CompartmentGrid } from './components/CompartmentGrid';
import { ParcelRetrieval } from './components/ParcelRetrieval';
import { StorageAssignment } from './components/StorageAssignment';
import { AccountCorrection } from './components/AccountCorrection';
import { Operations } from './components/Operations';
import './styles.css';
type Device = {
    device_id: string;
    online: boolean;
    last_seen_at: string | null;
};
export default function App() {
    const [account, setAccount] = useState<Account | null>(null), [checking, setChecking] = useState(true), [slots, setSlots] = useState<Slot[]>([]), [devices, setDevices] = useState<Device[]>([]), [selected, setSelected] = useState<Parcel | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0), [handoff, setHandoff] = useState({ registration: '', revision: 0 });
    const refresh = useCallback(async () => {
        try {
            const [s, d] = await Promise.all([api<Slot[]>('/api/slots'), api<Device[]>('/api/operator/devices/status')]);
            setSlots(s);
            setDevices(d);
            setError('');
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Service unavailable.');
        }
    }, []);
    useEffect(() => {
        let alive = true;
        void api<Account>('/api/auth/session').then(a => {
            if (alive)
                setAccount(a);
        }).catch(() => {
        }).finally(() => {
            if (alive)
                setChecking(false);
        });
        const expired = () => {
            setAccount(null);
            setSelected(null);
            setSlots([]);
            setError('Your session ended. Please log in.');
        };
        window.addEventListener('session-expired', expired);
        return () => {
            alive = false;
            window.removeEventListener('session-expired', expired);
        };
    }, []);
    useEffect(() => {
        if (account?.role !== 'OPERATOR')
            return;
        void refresh();
        const timer = setInterval(() => void refresh(), 15000);
        return () => clearInterval(timer);
    }, [account, refresh]);
    useEffect(() => {
        if (!selected)
            return;
        const parcelId = selected.parcel_id;
        let stopped = false;
        const timer = setInterval(() => {
            void api<Parcel>(`/api/parcels/${parcelId}`).then(parcel => {
                if (!stopped)
                    setSelected(current => current?.parcel_id === parcelId ? parcel : current);
            }).catch(error => {
                if (!stopped)
                    setError(error.message);
            });
        }, 10000);
        return () => {
            stopped = true;
            clearInterval(timer);
        };
    }, [selected?.parcel_id]);
    const changed = () => {
        setSelected(null);
        setRevision(v => v + 1);
        void refresh();
    };
    const assign = (registration: string) => {
        setHandoff(p => ({ registration, revision: p.revision + 1 }));
        document.querySelector('#storage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    async function login(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (busy)
            return;
        setBusy(true);
        setError('');
        const f = new FormData(e.currentTarget);
        try {
            await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(f)) });
            setAccount(await api<Account>('/api/auth/session'));
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Login failed.');
        }
        finally {
            setBusy(false);
        }
    }
    async function logout() {
        try {
            await api('/api/auth/logout', { method: 'POST' });
            setAccount(null);
            setSelected(null);
            setSlots([]);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Sign out failed.');
        }
    }
    return <main className="shell"><nav className="topbar"><a className="brand" href="#">smartpick<span className="brand-dot">.</span></a><div className="top-meta"><span className="api-state">{devices.some(d => d.online) ? 'DEVICE ONLINE' : 'DEVICE OFFLINE'}</span><span>PARCEL DESK</span>{account && <button className="text-button" onClick={() => void logout()}>Sign out</button>}</div></nav>{error && <div className="banner" role="alert">{error}</div>}{checking ? <p role="status">Checking session…</p> : account?.role !== 'OPERATOR' ? <section className="panel login-panel"><h1>Parcel desk login</h1>{account ? <><p>This account has no staff access. Use your student app to view your parcels, or sign out and use a staff account.</p><button className="secondary" onClick={() => void logout()}>Sign out</button></> : <form className="form-grid" onSubmit={login}><label>Email<input required type="email" name="email" autoComplete="username"/></label><label>Password<input required type="password" name="password" autoComplete="current-password"/></label><button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</button></form>}</section> : <><header className="hero"><div><span className="eyebrow">CAMPUS PARCEL SYSTEM</span><h1>Every parcel,<br /><em>right where it belongs.</em></h1><p>Register deliveries, approve student identities and follow each collection.</p></div></header><div className="content-grid"><div className="left-column"><ParcelRegistration onRegistered={reg => {
                assign(reg);
                setRevision(v => v + 1);
            }}/><div id="storage"><StorageAssignment slots={slots} onStored={changed} registration={handoff.registration} revision={handoff.revision}/></div><StudentLookup onRetrieve={setSelected} revision={revision}/><ParcelRetrieval parcel={selected} onChanged={changed}/></div><div className="right-column"><CompartmentGrid slots={slots}/><section className="panel"><h2>Device connection</h2>{devices.length ? devices.map(d => <p key={d.device_id}>{d.online ? 'Online' : 'Offline'} · Last seen {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : 'never'}</p>) : <p>No device configured.</p>}<button className="secondary" onClick={() => void refresh()}>Refresh inventory</button></section><AccountCorrection onChanged={changed}/><Operations revision={revision} onAssign={assign} onChanged={changed}/></div></div></>}<footer>SMARTPICK · CAMPUS PARCELS</footer></main>;
}

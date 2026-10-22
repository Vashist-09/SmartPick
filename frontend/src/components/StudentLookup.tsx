import { FormEvent, useState, useRef, useEffect } from 'react';
import { api } from '../api';
import type { Parcel } from '../types';
export function StudentLookup({ onRetrieve, revision }: {
    onRetrieve: (p: Parcel | null) => void;
    revision: number;
}) {
    const [rows, setRows] = useState<Parcel[]>([]), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [searched, setSearched] = useState(false), [lookupRegistration, setLookupRegistration] = useState('');
    const seq = useRef(0);
    useEffect(() => {
        setRows([]);
        setLookupRegistration('');
        setSearched(false);
        onRetrieve(null);
        seq.current++;
        setBusy(false);
    }, [revision]);
    useEffect(() => {
        if (!lookupRegistration)
            return;
        const current = seq.current;
        let stopped = false;
        const timer = setInterval(() => {
            void api<Parcel[]>(`/api/operator/students/${encodeURIComponent(lookupRegistration)}/parcels`).then(data => {
                if (!stopped && current === seq.current) {
                    setRows(data);
                    setNotice('');
                }
            }).catch(error => {
                if (!stopped && current === seq.current)
                    setNotice(error.message);
            });
        }, 10000);
        return () => {
            stopped = true;
            clearInterval(timer);
        };
    }, [lookupRegistration]);
    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const reg = String(new FormData(e.currentTarget).get('registrationNo')).trim();
        setLookupRegistration('');
        const current = ++seq.current;
        onRetrieve(null);
        setRows([]);
        setNotice('');
        setBusy(true);
        setSearched(true);
        try {
            const data = await api<Parcel[]>(`/api/operator/students/${encodeURIComponent(reg)}/parcels`);
            if (current === seq.current) {
                setRows(data);
                setLookupRegistration(reg);
            }
        }
        catch (e) {
            if (current === seq.current)
                setNotice(e instanceof Error ? e.message : 'Lookup failed.');
        }
        finally {
            if (current === seq.current)
                setBusy(false);
        }
    }
    return <section className="panel"><h2>Find a student</h2><form className="inline-form" onSubmit={submit}><label className="grow">Registration number<input name="registrationNo" required maxLength={30} onChange={() => {
            seq.current++;
            setRows([]);
            setLookupRegistration('');
            setSearched(false);
            setBusy(false);
            onRetrieve(null);
        }}/></label><button className="secondary" disabled={busy}>{busy ? 'Looking up…' : 'Look up'}</button></form>{notice && <p className="notice error" role="alert">{notice}</p>}<div className="parcel-list">{rows.map(p => <div className="parcel-row" key={p.parcel_id}><div><strong>{p.tracking_id}</strong><small>{p.slot_no ? `${p.parcel_status === 'COLLECTED' ? 'Previous location: ' : ''}Slot ${p.slot_no} · Compartment ${p.compartment_no}` : 'Awaiting storage'}</small><small>{p.payment_type} · {p.payment_status}</small></div><span className="pill">{p.workflow_status === 'ACTIVE' ? p.parcel_status : p.workflow_status}</span>{p.workflow_status === 'ACTIVE' && p.parcel_status !== 'COLLECTED' && <button className="text-button" onClick={() => onRetrieve(p)}>Manage →</button>}</div>)}</div>{!busy && searched && !rows.length && !notice && <p>No parcels found for this student.</p>}</section>;
}

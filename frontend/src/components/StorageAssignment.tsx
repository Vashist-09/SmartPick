import { FormEvent, useState, useEffect, useRef } from 'react';
import { api } from '../api';
import type { Parcel, Slot } from '../types';
export function StorageAssignment({ slots, onStored, registration, revision }: {
    slots: Slot[];
    onStored: () => void;
    registration: string;
    revision: number;
}) {
    const [parcels, setParcels] = useState<Parcel[]>([]), [parcelId, setParcelId] = useState(''), [compartmentId, setCompartmentId] = useState(''), [reg, setReg] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [searched, setSearched] = useState(false);
    const generation = useRef(0);
    const available = slots.flatMap(s => s.status === 'ACTIVE' ? s.compartments.filter(c => c.occupancyStatus === 'EMPTY').map(c => ({ id: c.compartmentId, label: `Slot ${s.slotNo} · Compartment ${c.compartmentNo}` })) : []);
    async function lookup(value: string) {
        const current = ++generation.current;
        setBusy(true);
        setError('');
        setNotice('');
        setParcels([]);
        setParcelId('');
        setCompartmentId('');
        setSearched(true);
        try {
            const found = await api<Parcel[]>(`/api/operator/students/${encodeURIComponent(value.trim())}/parcels`);
            if (current !== generation.current)
                return;
            const eligible = found.filter(p => p.parcel_status === 'REGISTERED' && p.workflow_status === 'ACTIVE');
            setParcels(eligible);
            if (eligible.length === 1)
                setParcelId(eligible[0].parcel_id);
        }
        catch (e) {
            if (current === generation.current)
                setError(e instanceof Error ? e.message : 'Lookup failed.');
        }
        finally {
            if (current === generation.current)
                setBusy(false);
        }
    }
    useEffect(() => {
        if (registration) {
            setReg(registration);
            void lookup(registration);
        }
        return () => {
            generation.current++;
        };
    }, [registration, revision]);
    async function assign(e: FormEvent) {
        e.preventDefault();
        if (busy || !parcelId || !available.some(c => c.id === compartmentId))
            return;
        setBusy(true);
        setError('');
        try {
            await api(`/api/parcels/${parcelId}/store`, { method: 'POST', body: JSON.stringify({ compartmentId }) });
            setParcels(p => p.filter(x => x.parcel_id !== parcelId));
            setParcelId('');
            setCompartmentId('');
            setNotice('Parcel stored. Ready notification queued for an eligible student account.');
            onStored();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Assignment failed.');
            onStored();
        }
        finally {
            setBusy(false);
        }
    }
    return <section className="panel"><h2>Assign storage</h2><form className="inline-form" onSubmit={e => {
        e.preventDefault();
        void lookup(reg);
    }}><label className="grow">Student registration<input required value={reg} onChange={e => setReg(e.target.value)}/></label><button className="secondary" disabled={busy}>Find parcels</button></form>{parcels.length > 0 && <form className="form-grid" onSubmit={assign}><label>Registered parcel<select required value={parcelId} onChange={e => setParcelId(e.target.value)}><option value="">Choose parcel</option>{parcels.map(p => <option key={p.parcel_id} value={p.parcel_id}>{p.tracking_id}</option>)}</select></label><label>Compartment<select required value={available.some(c => c.id === compartmentId) ? compartmentId : ''} onChange={e => setCompartmentId(e.target.value)}><option value="">Choose location</option>{available.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label><button className="primary" disabled={busy || !parcelId || !available.some(c => c.id === compartmentId)}>{busy ? 'Assigning…' : 'Assign parcel'}</button></form>}{!busy && searched && !parcels.length && !error && <p>No parcels awaiting storage.</p>}{parcels.length > 0 && !available.length && <p>No compartments available. Keep the parcel in the inbound queue.</p>}{error && <p role="alert" className="notice error">{error}</p>}{notice && <p role="status" className="notice">{notice}</p>}</section>;
}

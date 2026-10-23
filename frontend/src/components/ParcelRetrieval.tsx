import { useState, useEffect } from 'react';
import { api } from '../api';
import type { Parcel, Pickup } from '../types';
export function ParcelRetrieval({ parcel, onChanged }: {
    parcel: Parcel | null;
    onChanged: () => void;
}) {
    const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [pickup, setPickup] = useState<Pickup | null>(null), [pickupId, setPickupId] = useState(''), [reason, setReason] = useState(''), [recipient, setRecipient] = useState(''), [collectorVerified, setCollectorVerified] = useState(false);
    useEffect(() => {
        setMessage('');
        setPickup(null);
        setPickupId('');
        setReason('');
        setRecipient('');
        setCollectorVerified(false);
    }, [parcel?.parcel_id]);
    useEffect(() => {
        if (!pickupId)
            return;
        let stopped = false, timer: ReturnType<typeof setTimeout>;
        async function poll() {
            try {
                const p = await api<Pickup>(`/api/pickups/${pickupId}`);
                if (stopped)
                    return;
                setPickup(p);
                setMessage('');
                if (p.status === 'ACTIVE')
                    timer = setTimeout(() => void poll(), 2000);
            }
            catch (e) {
                if (stopped)
                    return;
                setMessage(e instanceof Error ? e.message : 'Status unavailable.');
                timer = setTimeout(() => void poll(), 5000);
            }
        }
        void poll();
        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, [pickupId]);
    async function action(fn: () => Promise<void>) {
        if (busy)
            return;
        setBusy(true);
        setMessage('');
        try {
            await fn();
        }
        catch (e) {
            setMessage(e instanceof Error ? e.message : 'Action failed.');
        }
        finally {
            setBusy(false);
        }
    }
    const currentStatus = parcel?.parcel_status === 'COLLECTED' ? 'COLLECTED' : pickup?.parcel_status || parcel?.parcel_status;
    const available = parcel?.workflow_status === 'ACTIVE' && (!pickup || pickup.workflow_status === 'ACTIVE');
    const unpaid = parcel?.payment_type === 'COD' && parcel.payment_status !== 'PAID';
    return <section className="panel"><span className="eyebrow">OUTBOUND & EXCEPTIONS</span><h2>Manage parcel</h2>{!parcel ? <p>Choose a parcel from student lookup.</p> : <><h3>{parcel.tracking_id}</h3><p>Verify the collector’s campus ID before guiding collection. Proxy collection requires desk approval.</p>{pickup && <div role="status" className="pickup-progress"><strong>{currentStatus === 'COLLECTED' ? 'Collection confirmed' : pickup.status !== 'ACTIVE' ? `Pickup ${pickup.status.toLowerCase()}` : pickup.command_status === 'EXECUTED' ? 'Light activated · waiting for removal' : `Waiting for device · ${pickup.command_status.toLowerCase()}`}</strong><p>Slot {pickup.slot_no} · Compartment {pickup.compartment_no}</p><small>Reference {pickup.pickup_id}</small>{pickup.completed_at && <p>Completed {new Date(pickup.completed_at).toLocaleString()}</p>}</div>}
 <label className="check-label"><input type="checkbox" checked={collectorVerified} onChange={e => setCollectorVerified(e.target.checked)}/> I checked the collector’s ID and authorization</label><div className="live-actions">{available && currentStatus === 'STORED' && <button className="primary" disabled={busy || unpaid || !collectorVerified || reason.trim().length < 5 || pickup?.status === 'ACTIVE' || pickup?.status === 'COLLECTED'} onClick={() => void action(async () => {
                    const p = await api<{
                        pickup_id: string;
                    }>(`/api/parcels/${parcel.parcel_id}/pickups`, { method: 'POST', body: JSON.stringify({ collectorVerified, verificationNote: reason }) });
                    setPickupId(p.pickup_id);
                })}>Start pickup / retry</button>}{pickup?.status === 'ACTIVE' && currentStatus !== 'COLLECTED' && <button className="secondary" disabled={busy} onClick={() => void action(async () => {
                    const p = await api<Pickup>(`/api/pickups/${pickup.pickup_id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Staff cancelled pickup' }) });
                    setPickup(p);
                })}>Cancel attempt</button>}</div>
 <label>Desk record: ID check, payment reference or exception reason<input value={reason} minLength={5} maxLength={500} onChange={e => setReason(e.target.value)} placeholder="Record the reason or receipt reference"/></label>
 {unpaid && <button className="secondary" disabled={busy || reason.trim().length < 5} onClick={() => void action(async () => {
                    await api(`/api/parcels/${parcel.parcel_id}/payment`, { method: 'POST', body: JSON.stringify({ reference: reason }) });
                    onChanged();
                })}>Confirm COD payment received</button>}
 <div className="live-actions">{(!available ? [] : currentStatus === 'REGISTERED' ? ['CANCEL'] : currentStatus === 'STORED' ? ['RETURN', 'MANUAL_COLLECT'] : []).map(name => <button key={name} className="secondary" disabled={busy || reason.trim().length < 5 || name === 'MANUAL_COLLECT' && unpaid} onClick={() => void action(async () => {
                    await api(`/api/parcels/${parcel.parcel_id}/resolve`, { method: 'POST', body: JSON.stringify({ action: name, reason }) });
                    onChanged();
                })}>{name.replace(/_/g, ' ').toLowerCase()}</button>)}</div>
 {parcel.parcel_status === 'REGISTERED' && <div className="inline-form"><label>Correct recipient registration<input value={recipient} onChange={e => setRecipient(e.target.value)}/></label><button className="secondary" disabled={busy || reason.trim().length < 5 || !recipient.trim()} onClick={() => void action(async () => {
                    await api(`/api/parcels/${parcel.parcel_id}`, { method: 'PATCH', body: JSON.stringify({ registrationNo: recipient, reason }) });
                    onChanged();
                })}>Correct recipient</button></div>}</>}{message && <p role="alert" className="notice error">{message}</p>}</section>;
}

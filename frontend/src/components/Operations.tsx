import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Parcel } from '../types';
type Pending = {
    account_id: string;
    email: string;
    registration_no: string;
    full_name: string;
    email_verified_at: string | null;
};
type Audit = {
    audit_id: string;
    tracking_id: string;
    event_type: string;
    created_at: string;
    details: Record<string, unknown>;
};
type Notice = {
    notification_id: string;
    subject: string;
    status: string;
    attempts: number;
};
export function Operations({ revision, onAssign, onChanged }: {
    revision: number;
    onAssign: (reg: string) => void;
    onChanged: () => void;
}) {
    const [queue, setQueue] = useState<Parcel[]>([]), [pending, setPending] = useState<Pending[]>([]), [logs, setLogs] = useState<Audit[]>([]), [notices, setNotices] = useState<Notice[]>([]), [error, setError] = useState(''), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [page, setPage] = useState(0);
    useEffect(() => {
        let alive = true;
        void Promise.all([api<Parcel[]>(`/api/parcels?status=REGISTERED&page=${page}`), api<Pending[]>('/api/operator/accounts/pending'), api<Audit[]>('/api/operator/activity'), api<Notice[]>('/api/operator/notifications')]).then(([q, p, a, n]) => {
            if (alive) {
                setQueue(q);
                setPending(p);
                setLogs(a);
                setNotices(n);
                setError('');
            }
        }).catch(e => {
            if (alive)
                setError(e.message);
        });
        return () => {
            alive = false;
        };
    }, [revision, page]);
    async function approve(account: Pending) {
        if (busy)
            return;
        setBusy(true);
        setError('');
        try {
            await api(`/api/operator/accounts/${account.account_id}/approve`, { method: 'POST', body: JSON.stringify({ reason }) });
            setReason('');
            onChanged();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Approval failed.');
        }
        finally {
            setBusy(false);
        }
    }
    return <><section className="panel"><h2>Inbound queue</h2>{queue.map(p => <div className="parcel-row" key={p.parcel_id}><div><strong>{p.tracking_id}</strong><small>{p.registration_no}</small></div><button className="secondary" onClick={() => onAssign(p.registration_no)}>Assign storage</button></div>)}{!queue.length && <p>No parcels awaiting storage.</p>}<div className="live-actions"><button className="secondary" disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button><button className="secondary" disabled={queue.length < 50} onClick={() => setPage(p => p + 1)}>Next</button></div></section><section className="panel"><h2>Student identity approvals</h2><p>Check the physical campus ID against the name and registration before approving.</p><label>Verification record<input value={reason} onChange={e => setReason(e.target.value)} minLength={5} maxLength={500} placeholder="How identity was checked"/></label>{pending.map(a => <div className="parcel-row" key={a.account_id}><div><strong>{a.full_name} · {a.registration_no}</strong><small>{a.email} · {a.email_verified_at ? 'Email verified' : 'Email pending'}</small></div><button className="secondary" disabled={busy || !a.email_verified_at || reason.trim().length < 5} onClick={() => void approve(a)}>Approve</button></div>)}{!pending.length && <p>No pending approvals.</p>}</section><section className="panel"><h2>Recent activity & exceptions</h2>{logs.map(l => <article className="parcel-row" key={l.audit_id}><div><strong>{l.event_type.replace(/_/g, ' ')} {l.tracking_id}</strong><small>{new Date(l.created_at).toLocaleString()}</small><small>{JSON.stringify(l.details)}</small></div></article>)}{!logs.length && <p>No events yet.</p>}</section><section className="panel"><h2>Notification delivery</h2>{notices.map(n => <div className="parcel-row" key={n.notification_id}><div><strong>{n.subject}</strong><small>{n.status} · {n.attempts} attempts</small></div>{n.status === 'FAILED' && <button className="secondary" disabled={busy} onClick={() => {
        setBusy(true);
        void api(`/api/operator/notifications/${n.notification_id}/retry`, { method: 'POST' }).then(onChanged).catch(e => setError(e.message)).finally(() => setBusy(false));
    }}>Retry</button>}</div>)}</section>{error && <p role="alert" className="banner">{error}</p>}</>;
}

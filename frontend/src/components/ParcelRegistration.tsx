import { FormEvent, useState } from 'react';
import { api } from '../api';
export function ParcelRegistration({ onRegistered }: {
    onRegistered: (registration: string) => void;
}) {
    const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (busy)
            return;
        const form = e.currentTarget;
        const f = new FormData(form);
        setBusy(true);
        setNotice('');
        try {
            const registration = String(f.get('registrationNo')).trim().toUpperCase();
            const r = await api<{
                tracking_id: string;
            }>('/api/parcels', { method: 'POST', body: JSON.stringify({ registrationNo: registration, studentName: f.get('studentName'), trackingId: f.get('trackingId'), paymentType: f.get('paymentType') }) });
            setNotice(`Parcel ${r.tracking_id} registered. Continue in Assign storage below.`);
            form.reset();
            onRegistered(registration);
        }
        catch (err) {
            setNotice(err instanceof Error ? err.message : 'Could not register parcel.');
        }
        finally {
            setBusy(false);
        }
    }
    return <section className="panel"><div className="section-heading"><div><span className="eyebrow">INBOUND</span><h2>Register a parcel</h2></div></div><form onSubmit={submit} className="form-grid"><label>Student name<input required name="studentName" minLength={2} maxLength={80}/></label><label>Registration number<input required name="registrationNo" maxLength={30}/></label><label>Tracking ID<input required name="trackingId" maxLength={100}/></label><label>Payment type<select name="paymentType"><option value="PREPAID">Prepaid</option><option value="COD">Cash on delivery</option></select></label><button className="primary" disabled={busy}>{busy ? 'Registering…' : 'Register and assign storage'}</button></form>{notice && <p role="status" className="notice">{notice}</p>}</section>;
}

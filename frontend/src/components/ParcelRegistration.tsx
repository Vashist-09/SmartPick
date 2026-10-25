import { FormEvent, useState } from 'react';
import { api, errorMessage } from '../api';
import { describeIdentifierProblem, normalizeRegistration } from '../scanner/identifier';

export function ParcelRegistration({ onRegistered }: { onRegistered?: () => void }) {
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const f = new FormData(form);
    const check = normalizeRegistration(String(f.get('registrationNo') || ''));
    if (!check.ok) { setNotice({ tone: 'error', text: describeIdentifierProblem(check) }); return; }
    setNotice(null); setBusy(true);
    try {
      const r = await api<{ tracking_id: string; parcel_id: string; registration_no: string }>('/api/parcels', { method: 'POST', body: JSON.stringify({ registrationNo: check.value, studentName: f.get('studentName'), trackingId: f.get('trackingId'), paymentType: f.get('paymentType') }) });
      setNotice({ tone: 'success', text: `Parcel ${r.tracking_id} registered for ${r.registration_no}. Assign it a compartment below.` });
      form.reset();
      onRegistered?.();
    } catch (err) { setNotice({ tone: 'error', text: errorMessage(err, 'Could not register parcel.') }); }
    finally { setBusy(false); }
  }

  return <section className="panel" aria-labelledby="register-title"><div className="section-heading"><div><span className="eyebrow">INBOUND</span><h2 id="register-title">Register a parcel</h2></div><span className="step">01</span></div>
    <form onSubmit={submit} className="form-grid">
      <label>Student name<input required name="studentName" placeholder="e.g. Asha Patel" maxLength={120} autoComplete="off" /></label>
      <label>Registration number<input required name="registrationNo" placeholder="e.g. 24CS104" maxLength={64} autoComplete="off" spellCheck={false} /></label>
      <label>Tracking ID<input required name="trackingId" placeholder="Enter parcel tracking ID" maxLength={100} autoComplete="off" spellCheck={false} /></label>
      <label>Payment type<select name="paymentType"><option value="PREPAID">Prepaid</option><option value="COD">Cash on delivery</option></select></label>
      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? 'Registering…' : 'Add to parcel queue'} <span aria-hidden="true">↗</span></button>
    </form>
    {notice && <p className={`notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
  </section>;
}

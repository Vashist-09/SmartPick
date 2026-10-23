import { FormEvent, useState } from 'react';
import { api } from '../api';
type Student = {
    account_id: string;
    email: string;
    registration_no: string;
    full_name: string;
};
export function AccountCorrection({ onChanged }: {
    onChanged: () => void;
}) {
    const [student, setStudent] = useState<Student | null>(null), [email, setEmail] = useState(''), [registration, setRegistration] = useState(''), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
    async function find(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (busy)
            return;
        setBusy(true);
        setNotice('');
        setStudent(null);
        const email = String(new FormData(e.currentTarget).get('email'));
        try {
            const a = await api<Student>(`/api/operator/accounts/find?email=${encodeURIComponent(email)}`);
            setStudent(a);
            setEmail(a.email);
            setRegistration(a.registration_no);
            setReason('');
        }
        catch (e) {
            setNotice(e instanceof Error ? e.message : 'Lookup failed.');
        }
        finally {
            setBusy(false);
        }
    }
    async function save(e: FormEvent) {
        e.preventDefault();
        if (busy || !student)
            return;
        setBusy(true);
        try {
            await api(`/api/operator/accounts/${student.account_id}/identity`, { method: 'PATCH', body: JSON.stringify({ email, registrationNo: registration, reason }) });
            setStudent(null);
            setNotice('Identity updated. Sessions revoked; approval is required again. Changed emails must be verified.');
            onChanged();
        }
        catch (e) {
            setNotice(e instanceof Error ? e.message : 'Correction failed.');
        }
        finally {
            setBusy(false);
        }
    }
    return <section className="panel"><h2>Correct a student identity</h2><form className="inline-form" onSubmit={find}><label className="grow">Current email<input required name="email" type="email"/></label><button className="secondary" disabled={busy}>Find account</button></form>{student && <form className="form-grid" onSubmit={save}><p>{student.full_name}</p><label>Correct email<input required type="email" value={email} onChange={e => setEmail(e.target.value)}/></label><label>Correct registration<input required value={registration} onChange={e => setRegistration(e.target.value)} maxLength={30}/></label><label>Identity evidence / reason<input required value={reason} onChange={e => setReason(e.target.value)} minLength={5} maxLength={500}/></label><button className="primary" disabled={busy || reason.trim().length < 5}>Save and require approval again</button></form>}{notice && <p role="status" className="notice">{notice}</p>}</section>;
}

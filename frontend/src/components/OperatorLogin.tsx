import { FormEvent, useState } from 'react';
import { api, errorMessage } from '../api';

export function OperatorLogin({ onLogin, notice }: { onLogin: () => void; notice?: string }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const password = String(new FormData(event.currentTarget).get('password') || '');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
      onLogin();
    } catch (e) {
      setError(errorMessage(e, 'Sign-in failed.'));
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-shell">
    <span className="brand"><span className="brand-mark" aria-hidden="true">S</span>smartpick<span className="brand-dot">.</span></span>
    <section className="login-card" aria-labelledby="login-title">
      <span className="eyebrow">PARCEL DESK</span>
      <h1 id="login-title">Sign in to SmartPick</h1>
      <p>Operator access is required to manage campus parcels.</p>
      {notice && <p className="notice info" role="status">{notice}</p>}
      <form onSubmit={submit}>
        <label htmlFor="operator-password">Operator password</label>
        <input id="operator-password" name="password" type="password" autoComplete="current-password" required autoFocus />
        {error && <p className="login-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </section>
  </main>;
}

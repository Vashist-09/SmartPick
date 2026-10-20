import { FormEvent, useState } from 'react';
import { api } from '../api';

export function OperatorLogin({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const password = String(new FormData(event.currentTarget).get('password') || '');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
      onLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-shell">
    <a className="brand" href="/">smartpick<span className="brand-dot">.</span></a>
    <section className="login-card">
      <span className="eyebrow">PARCEL DESK</span>
      <h1>Sign in to SmartPick</h1>
      <p>Operator access is required to manage campus parcels.</p>
      <form onSubmit={submit}>
        <label htmlFor="operator-password">Operator password</label>
        <input id="operator-password" name="password" type="password" autoComplete="current-password" required />
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </section>
  </main>;
}

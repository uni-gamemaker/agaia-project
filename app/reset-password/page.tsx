'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const token = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('token');

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    if (password !== confirmation) {
      setError('Those passwords do not match.'); setBusy(false); return;
    }
    if (!token) {
      setError('This reset link is missing its token. Request a new link and try again.'); setBusy(false); return;
    }
    const result = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (result.error) setError(result.error.message ?? 'This reset link is invalid or has expired.');
    else setMessage('Your password has been changed. You can sign in now.');
  };

  return <main className="reset-screen"><section className="reset-card">
    <div className="brand-mark">a</div><p className="eyebrow">ACCOUNT RECOVERY</p>
    <h1>Choose a new password.</h1><p className="login-copy">Use at least 8 characters for your Ajaia account.</p>
    {message ? <p className="auth-notice" role="status">{message}</p> : <form className="login-actions auth-form" onSubmit={(event) => void submit(event)}>
      <input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" aria-label="New password" />
      <input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Confirm new password" aria-label="Confirm new password" />
      <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
    </form>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <p className="reset-link"><Link href="/">Return to sign in</Link></p>
  </section></main>;
}

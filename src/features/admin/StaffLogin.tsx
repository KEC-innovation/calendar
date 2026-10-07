import { useState } from 'react';
import { Brand } from '../../components/Brand';
import { Spinner } from '../../components/Spinner';
import { signIn, signInDemo } from '../../lib/auth';
import { isMockMode } from '../../lib/supabase';
import type { StaffSession } from '../../types/domain';

export function StaffLogin({ onSignedIn }: { onSignedIn: (session: StaffSession) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSignedIn(await signIn(email.trim(), password));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  async function enterDemo() {
    setBusy(true);
    setError('');
    try { onSignedIn(await signInDemo()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Demo sign-in failed.'); }
    finally { setBusy(false); }
  }

  return (
    <main className="simple-shell auth-shell">
      <header><Brand /><a href="#/">Home</a></header>
      <section className="simple-card auth-card">
        <p className="eyebrow">Staff workspace</p>
        <h1>Staff sign in</h1>
        <p>Use your invited email and password. Existing Admins and Owners do not need to register again.</p>
        {error && <div className="alert alert--error" role="alert">{error}</div>}
        <form className="account-form" onSubmit={(event) => void submit(event)}>
          <label className="field"><span>Email</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" /></label>
          <label className="field"><span>Password</span><input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
          <button className="button button--primary button--wide" disabled={busy}>{busy ? <Spinner label="Signing in" /> : 'Sign in'}</button>
        </form>
        {isMockMode() && <button className="button button--secondary button--wide" type="button" disabled={busy} onClick={() => void enterDemo()}>Enter demo owner workspace</button>}
        <p className="auth-note">An Owner invites new staff and assigns their access.</p>
        <div className="portal-actions"><a href="#/account">Account recovery</a><a href="#/account">Student sign in</a></div>
      </section>
    </main>
  );
}

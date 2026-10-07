import { useState } from 'react';
import { ChevronLeft, LockKeyhole } from 'lucide-react';
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
    <main className="login-shell">
      <div className="login-brand-panel"><Brand /><div><p className="eyebrow">Staff workspace</p><h1>Run daily Makerspace operations from one place.</h1><p>Bookings, equipment, certifications, supervised quizzes, schedules, and audit history.</p></div></div>
      <section className="login-card">
        <a className="back-button" href="#/"><ChevronLeft size={17} /> Home</a>
        <div className="login-icon"><LockKeyhole size={24} /></div>
        <h2>Staff sign in</h2>
        <p>Use the account invited through KEC Makerspace.</p>
        {error && <div className="alert alert--error" role="alert">{error}</div>}
        <form onSubmit={(event) => void submit(event)}>
          <label className="field"><span>Email</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" /></label>
          <label className="field"><span>Password</span><input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
          <button className="button button--primary button--wide" disabled={busy}>{busy ? <Spinner label="Signing in" /> : 'Sign in'}</button>
        </form>
        {isMockMode() && <button className="button button--secondary button--wide demo-login" type="button" disabled={busy} onClick={() => void enterDemo()}>Enter demo owner workspace</button>}
        <p className="login-help"><a href="#/account">Forgot password? Open account recovery</a>. Ask an owner if your staff role has been deactivated.</p>
      </section>
    </main>
  );
}

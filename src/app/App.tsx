import { Account } from '../features/portal/Account';
import { StudentPortal } from '../features/portal/StudentPortal';
import { Policies } from '../features/portal/Policies';
import { Catalog } from '../features/portal/Catalog';
import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import { useHashRoute, navigate } from '../lib/hashRouter';
import { configurationMissing } from '../lib/supabase';
import { restoreSession } from '../lib/auth';
import { ManageBooking } from '../features/booking/ManageBooking';
import { QuizAttempt } from '../features/training/QuizAttempt';
import { StaffLogin } from '../features/admin/StaffLogin';
import { AdminApp } from '../features/admin/AdminApp';
import { Brand } from '../components/Brand';
import { Spinner } from '../components/Spinner';
import type { StaffSession } from '../types/domain';

function SetupRequired() {
  return (
    <main className="simple-shell">
      <header><Brand /></header>
      <section className="simple-card setup-card">
        <div className="login-icon"><Wrench size={24} /></div>
        <p className="eyebrow">Setup required</p>
        <h1>Connect the application to Supabase</h1>
        <p>The static app is built correctly, but its public project URL and publishable key have not been supplied. Follow the deployment checklist in the repository.</p>
      </section>
    </main>
  );
}

export function App() {
  const route = useHashRoute();
  const [session, setSession] = useState<StaffSession | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let active = true;
    void restoreSession().then((value) => {
      if (active) {
        setSession(value);
        setAuthReady(true);
      }
    }).catch(() => active && setAuthReady(true));
    return () => { active = false; };
  }, []);

  if (configurationMissing()) return <SetupRequired />;
  if (route.path === '/policies') return <Policies />;
  if (route.path === '/catalog') return <Catalog />;
  if (route.path === '/password' || new URLSearchParams(window.location.search).get('account') === 'reset') return <Account forcePassword><StudentPortal /></Account>;
  if (route.path.startsWith('/training/')) {
    sessionStorage.setItem('kec-next-route',route.path);
    return <Account><StudentPortal trainingToken={decodeURIComponent(route.path.slice('/training/'.length))} /></Account>;
  }
  if (route.path.startsWith('/quiz/')) return <Account><QuizAttempt token={decodeURIComponent(route.path.slice('/quiz/'.length))} /></Account>;
  if (route.path === '/booking/manage') return <ManageBooking reference={route.query.get('ref') || ''} token={route.query.get('token') || ''} />;
  if (route.path.startsWith('/staff')) {
    if (!authReady) return <main className="center-screen"><Spinner label="Checking staff session" /></main>;
    if (!session) return <StaffLogin onSignedIn={(value) => { setSession(value); navigate('/staff/dashboard'); }} />;
    return <AdminApp session={session} section={route.path.slice('/staff/'.length) || 'dashboard'} onSignedOut={() => setSession(null)} />;
  }
  return <Account><StudentPortal /></Account>;
}

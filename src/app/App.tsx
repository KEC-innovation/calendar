import { lazy, Suspense, useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import { useHashRoute, navigate } from '../lib/hashRouter';
import { configurationMissing } from '../lib/supabase';
import { restoreSession } from '../lib/auth';
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

function RoutedApp() {
  const route = useHashRoute();
  const staffRoute = route.path.startsWith('/staff');
  const studentRoute = !staffRoute && !['/policies', '/catalog', '/booking/manage'].includes(route.path) && !route.path.startsWith('/quiz/');
  const [session, setSession] = useState<StaffSession | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!staffRoute) { setSession(null); setAuthReady(false); return; }
    let active = true;
    void restoreSession().then((value) => {
      if (active) {
        setSession(value);
        setAuthReady(true);
      }
    }).catch(() => active && setAuthReady(true));
    return () => { active = false; };
  }, [staffRoute]);

  useEffect(() => {
    // Download the student screen while account validation is in flight.
    if (studentRoute && !configurationMissing()) void loadStudentPortal().catch(() => { /* The route loader handles a failed import. */ });
  }, [studentRoute]);

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

const Account = lazy(() => import('../features/portal/Account').then(module => ({ default: module.Account })));

const loadStudentPortal = () => import('../features/portal/StudentPortal');
const StudentPortal = lazy(() => loadStudentPortal().then(module => ({ default: module.StudentPortal })));

const Policies = lazy(() => import('../features/portal/Policies').then(module => ({ default: module.Policies })));

const Catalog = lazy(() => import('../features/portal/Catalog').then(module => ({ default: module.Catalog })));

const ManageBooking = lazy(() => import('../features/booking/ManageBooking').then(module => ({ default: module.ManageBooking })));

const QuizAttempt = lazy(() => import('../features/training/QuizAttempt').then(module => ({ default: module.QuizAttempt })));

const StaffLogin = lazy(() => import('../features/admin/StaffLogin').then(module => ({ default: module.StaffLogin })));

const AdminApp = lazy(() => import('../features/admin/AdminApp').then(module => ({ default: module.AdminApp })));

export function App() {
  return <Suspense fallback={<main className="simple-shell"><Brand /><Spinner label="Loading your Makerspace" /></main>}><RoutedApp /></Suspense>;
}

import { OpsWorkspace } from '../portal/OpsWorkspace';
import { useMemo, useState } from 'react';
import {
  Award, CalendarDays, ClipboardCheck, Clock3, Cpu, LayoutDashboard, LogOut,
  Menu, ScrollText, UserCog, Users, Wrench, X,
} from 'lucide-react';
import { Brand } from '../../components/Brand';
import { StatusBadge } from '../../components/StatusBadge';
import { Toast, type ToastMessage } from '../../components/Toast';
import { signOut } from '../../lib/auth';
import { navigate } from '../../lib/hashRouter';
import type { StaffRole, StaffSession } from '../../types/domain';
import { AuditPanel, BookingsPanel, CertificationsPanel, DashboardPanel, EquipmentPanel, PeoplePanel, SchedulePanel, StaffPanel, TrainingPanel } from './AdminSections';
import { can, pretty } from './adminShared';

type AdminSection = 'operations' | 'dashboard' | 'equipment' | 'people' | 'certifications' | 'bookings' | 'training' | 'schedule' | 'staff' | 'audit';

const NAV: Array<{ section: AdminSection; label: string; icon: typeof LayoutDashboard; minimum: StaffRole }> = [
  { section: 'operations', label: 'My responsibilities', icon: ClipboardCheck, minimum: 'viewer' },
  { section: 'dashboard', label: 'Overview', icon: LayoutDashboard, minimum: 'viewer' },
  { section: 'equipment', label: 'Equipment', icon: Cpu, minimum: 'viewer' },
  { section: 'people', label: 'People', icon: Users, minimum: 'viewer' },
  { section: 'certifications', label: 'Certifications', icon: Award, minimum: 'viewer' },
  { section: 'bookings', label: 'Bookings', icon: CalendarDays, minimum: 'viewer' },
  { section: 'training', label: 'Training', icon: ClipboardCheck, minimum: 'trainer' },
  { section: 'schedule', label: 'Hours & closures', icon: Clock3, minimum: 'viewer' },
  { section: 'staff', label: 'Staff access', icon: UserCog, minimum: 'owner' },
  { section: 'audit', label: 'Audit trail', icon: ScrollText, minimum: 'viewer' },
];

export function AdminApp({ session, section, onSignedOut }: { session: StaffSession; section: string; onSignedOut: () => void }) {
  const requested = NAV.some((item) => item.section === section) ? section as AdminSection : 'dashboard';
  const active = !['owner','admin'].includes(session.role) ? 'operations' : NAV.some((item) => item.section === requested && can(session, item.minimum)) ? requested : 'dashboard';
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const nav = useMemo(() => NAV.filter((item) => can(session, item.minimum) && (['owner','admin'].includes(session.role) || item.section === 'operations')), [session]);
  async function logout() { await signOut(); onSignedOut(); navigate('/staff/login'); }
  const props = { session, notify: setToast };
  return <div className="admin-shell">
    <aside className={`admin-sidebar ${menuOpen ? 'is-open' : ''}`}>
      <div className="admin-sidebar__brand"><Brand compact /><button className="icon-button mobile-only" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={19} /></button></div>
      <nav aria-label="Staff workspace">{nav.map((item) => { const Icon = item.icon; return <a key={item.section} href={`#/staff/${item.section}`} className={active === item.section ? 'is-active' : ''} onClick={() => setMenuOpen(false)}><Icon size={18} />{item.label}</a>; })}</nav>
      <div className="admin-sidebar__footer"><a href="#/policies" className="public-site-link">Policies & tracking</a><a href="#/password" className="public-site-link">Change password</a><a href="#/" className="public-site-link"><Wrench size={16} /> Public booking</a><div className="staff-chip"><span>{session.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{session.displayName}</strong><small>{pretty(session.role)}</small></div><button type="button" onClick={() => void logout()} aria-label="Sign out"><LogOut size={17} /></button></div></div>
    </aside>
    {menuOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <main className="admin-main"><div className="admin-mobile-bar"><button className="icon-button" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><Brand compact /><StatusBadge tone="neutral">{pretty(session.role)}</StatusBadge></div><div className="admin-content">
      {active === 'operations' && <OpsWorkspace session={session} />}
      {active === 'dashboard' && <DashboardPanel {...props} />}
      {active === 'equipment' && <EquipmentPanel {...props} />}
      {active === 'people' && <PeoplePanel {...props} />}
      {active === 'certifications' && <CertificationsPanel {...props} />}
      {active === 'bookings' && <BookingsPanel {...props} />}
      {active === 'training' && <TrainingPanel {...props} />}
      {active === 'schedule' && <SchedulePanel {...props} />}
      {active === 'staff' && <StaffPanel {...props} />}
      {active === 'audit' && <AuditPanel session={session} />}
    </div></main>
    <Toast message={toast} onDismiss={() => setToast(null)} />
  </div>;
}

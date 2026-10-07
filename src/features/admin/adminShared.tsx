import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { workspaceCache } from '../../lib/workspaceCache';
import { api } from '../../lib/api';
import { Spinner } from '../../components/Spinner';
import type { JsonObject, PersonCategory, StaffRole, StaffSession } from '../../types/domain';

export type Notify = (message: { type: 'success' | 'error' | 'info'; text: string }) => void;
export interface AdminProps { session: StaffSession; notify: Notify }

export const ROLE_RANK: Record<StaffRole, number> = { viewer: 10, ambassador: 10, trainer: 20, admin: 30, owner: 40 };
export const CATEGORY_LABELS: Record<PersonCategory, string> = {
  kec_student: 'KEC student',
  kec_staff: 'KEC staff',
  other_college_student: 'Other college student',
  business_external: 'Business / external',
  member_non_kec: 'Non-KEC member',
  outreach_minor: 'Outreach minor',
};

export function can(session: StaffSession, minimum: StaffRole): boolean {
  return ROLE_RANK[session.role] >= ROLE_RANK[minimum];
}

export function pretty(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function relation<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

export function nepalDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-NP', {
    timeZone: 'Asia/Kathmandu', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value));
}

export function statusTone(value: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (['active', 'confirmed', 'checked_in', 'completed', 'verified', 'synced', 'sent', 'submitted'].includes(value)) return 'good';
  if (['pending', 'unknown', 'started', 'not_configured'].includes(value)) return 'warn';
  if (['failed', 'revoked', 'suspended', 'cancelled', 'no_show', 'out_of_service', 'inactive', 'expired'].includes(value)) return 'bad';
  return 'neutral';
}

export function localDateTimeValue(offsetHours = 1): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + offsetHours * 60 * 60_000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <header className="admin-page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action && <div className="admin-page-action">{action}</div>}</header>;
}

export function LoadingBlock({ label = 'Loading workspace' }: { label?: string }) {
  return <div className="admin-loading"><Spinner label={label} /></div>;
}

export function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="alert alert--error"><AlertTriangle size={18} /><span>{message}</span><button className="text-button" type="button" onClick={retry}><RefreshCw size={14} /> Retry</button></div>;
}

export interface AdminDataState<T> { data: T | null; loading: boolean; error: string; reload: () => void }

export function useAdminData<T>(session: StaffSession, action: string, payload: JsonObject = {}): AdminDataState<T> {
  const cacheKey = `${session.userId}:${session.accessToken}:${action}:${JSON.stringify(payload)}`;
  const lastKey=useRef(cacheKey);
  const [data, setData] = useState<T | null>(() => workspaceCache.peek<T>(cacheKey));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const payloadKey = JSON.stringify(payload);
  useEffect(() => {
    let active = true;
    const cached = workspaceCache.peek<T>(cacheKey);
    if(cached)setData(cached);else if(lastKey.current!==cacheKey)setData(null);
    lastKey.current=cacheKey;setLoading(!cached);
    setError('');
    void workspaceCache.get<T>(cacheKey, () => api.admin<T>(session, action, JSON.parse(payloadKey) as JsonObject))
      .then((value) => active && setData(value))
      .catch((cause: unknown) => active && setError(cause instanceof Error ? cause.message : 'The workspace could not be loaded.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [action, cacheKey, payloadKey, revision, session]);
  return { data, loading, error, reload: () => { workspaceCache.invalidate(); setRevision((value) => value + 1); } };
}

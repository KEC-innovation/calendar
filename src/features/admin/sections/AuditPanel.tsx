import { useState } from 'react';
import { Search } from 'lucide-react';
import type { StaffSession } from '../../../types/domain';
import { LoadError, LoadingBlock, nepalDateTime, PageHeader, pretty, useAdminData } from '../adminShared';

interface AuditRow { id: number; actor_display?: string | null; action: string; target_type: string; target_id?: string | null; created_at: string; metadata: Record<string, unknown> }
interface Data { rows: AuditRow[]; total: number }

export function AuditPanel({ session }: { session: StaffSession }) {
  const [search, setSearch] = useState(''); const [query, setQuery] = useState('');
  const resource = useAdminData<Data>(session, 'audit.list', { search: query });
  return <>
    <PageHeader eyebrow="Accountability" title="Audit trail" description="Append-only history for sensitive operational and access changes." />
    <div className="toolbar"><form className="search-box" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); }}><Search size={17} /><input aria-label="Search audit history" placeholder="Action, actor, or record type" value={search} onChange={(event) => setSearch(event.target.value)} /><button>Search</button></form></div>
    {resource.loading ? <LoadingBlock label="Loading audit history" /> : resource.error || !resource.data ? <LoadError message={resource.error || 'Audit history is unavailable.'} retry={resource.reload} /> : <section className="panel panel--flush"><div className="table-scroll"><table className="data-table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Record</th><th>Context</th></tr></thead><tbody>{resource.data.rows.map((row) => <tr key={row.id}><td>{nepalDateTime(row.created_at)}</td><td>{row.actor_display || 'System'}</td><td><strong>{pretty(row.action)}</strong></td><td>{pretty(row.target_type)}<small>{row.target_id || '—'}</small></td><td><code className="metadata-preview">{JSON.stringify(row.metadata)}</code></td></tr>)}</tbody></table></div><footer className="panel-footer">{resource.data.total} immutable events</footer></section>}
  </>;
}

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../../lib/api';
import { Modal } from '../../../components/Modal';
import { StatusBadge } from '../../../components/StatusBadge';
import { can, LoadError, LoadingBlock, nepalDateTime, PageHeader, pretty, relation, statusTone, useAdminData, type AdminProps } from '../adminShared';

interface PersonRelation { id?: string; full_name: string; email?: string; roll_number?: string | null }
interface TypeRelation { id?: string; display_name: string }
interface CertificationRow { id: string; status: string; issued_at: string; source_kind: string; people?: PersonRelation | PersonRelation[]; certification_types?: TypeRelation | TypeRelation[] }
interface Data { rows: CertificationRow[]; total: number; people: PersonRelation[]; certificationTypes: TypeRelation[] }

export function CertificationsPanel({ session, notify }: AdminProps) {
  const [status, setStatus] = useState('');
  const resource = useAdminData<Data>(session, 'certifications.list', { status });
  const [grantOpen, setGrantOpen] = useState(false);
  const [personId, setPersonId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [reason, setReason] = useState('Staff-verified prior training');
  const [change, setChange] = useState<{ row: CertificationRow; status: string; reason: string } | null>(null);
  async function grant(event: React.FormEvent) {
    event.preventDefault();
    try { await api.admin(session, 'certifications.grant', { personId, certificationTypeId: typeId, reason }); notify({ type: 'success', text: 'Certification granted.' }); setGrantOpen(false); resource.reload(); }
    catch (cause) { notify({ type: 'error', text: cause instanceof Error ? cause.message : 'Certification could not be granted.' }); }
  }
  async function update(event: React.FormEvent) {
    event.preventDefault(); if (!change) return;
    try { await api.admin(session, 'certifications.status', { certificationId: change.row.id, status: change.status, reason: change.reason }); notify({ type: 'success', text: 'Certification status updated.' }); setChange(null); resource.reload(); }
    catch (cause) { notify({ type: 'error', text: cause instanceof Error ? cause.message : 'Status could not be updated.' }); }
  }
  return <>
    <PageHeader eyebrow="Equipment permissions" title="Certifications" description="Permanent while active; suspension and revocation retain full history." action={can(session, 'admin') ? <button className="button button--primary" onClick={() => setGrantOpen(true)}><Plus size={16} /> Grant certification</button> : undefined} />
    <div className="toolbar"><label className="field compact-field"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="revoked">Revoked</option></select></label></div>
    {resource.loading ? <LoadingBlock label="Loading certifications" /> : resource.error || !resource.data ? <LoadError message={resource.error || 'Certifications are unavailable.'} retry={resource.reload} /> : <section className="panel panel--flush"><div className="table-scroll"><table className="data-table"><thead><tr><th>Person</th><th>Certification</th><th>Issued</th><th>Source</th><th>Status</th><th></th></tr></thead><tbody>{resource.data.rows.map((row) => <tr key={row.id}><td><strong>{relation(row.people)?.full_name}</strong><small>{relation(row.people)?.email}</small></td><td>{relation(row.certification_types)?.display_name}</td><td>{nepalDateTime(row.issued_at)}</td><td>{pretty(row.source_kind)}</td><td><StatusBadge tone={statusTone(row.status)}>{pretty(row.status)}</StatusBadge></td><td>{can(session, 'admin') && <button className="table-action" onClick={() => setChange({ row, status: row.status === 'active' ? 'suspended' : 'active', reason: '' })}>Change</button>}</td></tr>)}</tbody></table></div><footer className="panel-footer">{resource.data.total} certification records</footer></section>}
    <Modal title="Grant certification" open={grantOpen} onClose={() => setGrantOpen(false)}>{resource.data && <form onSubmit={(event) => void grant(event)}><div className="form-grid"><label className="field field--full"><span>Person</span><select required value={personId} onChange={(event) => setPersonId(event.target.value)}><option value="">Choose a person</option>{resource.data.people.map((person) => <option key={person.id} value={person.id}>{person.full_name} · {person.email}</option>)}</select></label><label className="field field--full"><span>Certification</span><select required value={typeId} onChange={(event) => setTypeId(event.target.value)}><option value="">Choose a certification</option>{resource.data.certificationTypes.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label><label className="field field--full"><span>Reason / evidence</span><textarea required value={reason} onChange={(event) => setReason(event.target.value)} /></label></div><div className="button-row"><button className="button button--secondary" type="button" onClick={() => setGrantOpen(false)}>Cancel</button><button className="button button--primary">Grant</button></div></form>}</Modal>
    <Modal title="Change certification status" open={Boolean(change)} onClose={() => setChange(null)}>{change && <form onSubmit={(event) => void update(event)}><div className="form-grid"><label className="field field--full"><span>Status</span><select value={change.status} onChange={(event) => setChange({ ...change, status: event.target.value })}><option value="active">Active</option><option value="suspended">Suspended</option><option value="revoked">Revoked</option></select></label><label className="field field--full"><span>Audited reason</span><textarea required value={change.reason} onChange={(event) => setChange({ ...change, reason: event.target.value })} /></label></div><div className="button-row"><button className="button button--secondary" type="button" onClick={() => setChange(null)}>Cancel</button><button className="button button--primary">Update status</button></div></form>}</Modal>
  </>;
}

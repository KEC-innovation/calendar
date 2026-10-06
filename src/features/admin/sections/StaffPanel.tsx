import { Responsibilities } from '../../portal/Responsibilities';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../../lib/api';
import { Modal } from '../../../components/Modal';
import { StatusBadge } from '../../../components/StatusBadge';
import type { StaffRole } from '../../../types/domain';
import { LoadError, LoadingBlock, nepalDateTime, PageHeader, pretty, useAdminData, type AdminProps } from '../adminShared';

interface StaffRow { user_id: string; display_name: string; role: StaffRole; active: boolean; created_at: string; capabilities?: string[] | null }
interface Data { rows: StaffRow[] }

export function StaffPanel({ session, notify }: AdminProps) {
  const resource = useAdminData<Data>(session, 'staff.list');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ email: '', displayName: '', role: 'viewer' as StaffRole });
  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    try { await api.admin(session, 'staff.invite', invite); notify({ type: 'success', text: 'Staff invitation sent.' }); setInviteOpen(false); resource.reload(); }
    catch (cause) { notify({ type: 'error', text: cause instanceof Error ? cause.message : 'Invitation failed.' }); }
  }
  async function update(row: StaffRow, role: StaffRole, active: boolean) {
    try { await api.admin(session, 'staff.update', { userId: row.user_id, role, active }); notify({ type: 'success', text: `${row.display_name} was updated.` }); resource.reload(); }
    catch (cause) { notify({ type: 'error', text: cause instanceof Error ? cause.message : 'Staff access could not be updated.' }); }
  }
  return <>
    <PageHeader eyebrow="Owner controls" title="Staff access" description="Supabase Auth accounts with least-privilege workspace roles." action={<button className="button button--primary" onClick={() => setInviteOpen(true)}><Plus size={16} /> Invite staff</button>} />
    {resource.loading ? <LoadingBlock label="Loading staff" /> : resource.error || !resource.data ? <LoadError message={resource.error || 'Staff accounts are unavailable.'} retry={resource.reload} /> : <section className="panel panel--flush"><div className="table-scroll"><table className="data-table"><thead><tr><th>Staff member</th><th>Role</th><th>Status</th><th>Created</th><th>Controls</th></tr></thead><tbody>{resource.data.rows.map((row) => <tr key={row.user_id}><td><strong>{row.display_name}</strong>{row.user_id === session.userId && <small>Current account</small>}</td><td><select aria-label={`Role for ${row.display_name}`} value={row.role} onChange={(event) => void update(row, event.target.value as StaffRole, row.active)}>{['viewer', 'trainer', 'admin', 'owner'].map((role) => <option value={role} key={role}>{pretty(role)}</option>)}</select></td><td><StatusBadge tone={row.active ? 'good' : 'bad'}>{row.active ? 'Active' : 'Inactive'}</StatusBadge></td><td>{nepalDateTime(row.created_at)}</td><td><button className="table-action" onClick={() => void update(row, row.role, !row.active)}>{row.active ? 'Deactivate' : 'Activate'}</button></td></tr>)}</tbody></table></div></section>}
    <Responsibilities staff={resource.data?.rows||[]} />
    <Modal title="Invite staff member" open={inviteOpen} onClose={() => setInviteOpen(false)}><form onSubmit={(event) => void sendInvite(event)}><div className="form-grid"><label className="field field--full"><span>Name</span><input required value={invite.displayName} onChange={(event) => setInvite({ ...invite, displayName: event.target.value })} /></label><label className="field field--full"><span>Email</span><input required type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} /></label><label className="field field--full"><span>Role</span><select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value as StaffRole })}><option value="viewer">Focused staff · assign tasks after inviting</option><option value="trainer">Trainer · start quizzes</option><option value="admin">Admin · operations</option><option value="owner">Owner · staff and all controls</option></select></label></div><div className="button-row"><button type="button" className="button button--secondary" onClick={() => setInviteOpen(false)}>Cancel</button><button className="button button--primary">Send invitation</button></div></form></Modal>
  </>;
}

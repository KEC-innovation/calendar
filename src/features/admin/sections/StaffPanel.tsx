import { SortableTable } from '../../../components/SortableTable';
import { Responsibilities, type TrainingType } from '../../portal/Responsibilities';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../../lib/api';
import { Modal } from '../../../components/Modal';
import { StatusBadge } from '../../../components/StatusBadge';
import type { StaffRole } from '../../../types/domain';
import { LoadError, LoadingBlock, nepalDateTime, PageHeader, useAdminData, type AdminProps } from '../adminShared';

interface StaffRow { user_id: string; display_name: string; role: StaffRole; active: boolean; created_at: string; updated_at?: string; capabilities?: string[] | null; training_certification_type_ids?: string[] | null }
interface Data { rows: StaffRow[]; certificationTypes: TrainingType[] }
const roleLabels: Record<StaffRole, string> = { viewer: 'Staff', ambassador: 'MS Ambassador', trainer: 'Trainer', admin: 'Admin', owner: 'Owner' };
export function StaffPanel({ session, notify }: AdminProps) {
  const resource = useAdminData<Data>(session, 'staff.list');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [invite, setInvite] = useState({ email: '', displayName: '', role: 'viewer' as StaffRole });
  const [edit, setEdit] = useState<{ row: StaffRow; role: StaffRole; active: boolean; reason: string } | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const finalOwner = Boolean(edit?.row.role === 'owner' && edit.row.active && resource.data?.rows.filter(row => row.role === 'owner' && row.active).length === 1);
  async function sendInvite(event: React.FormEvent) {
    event.preventDefault(); if (inviteBusy) return; setInviteBusy(true);
    try { await api.admin(session, 'staff.invite', invite); notify({ type: 'success', text: 'Staff invitation sent. Assign equipment training authority before a new assigned trainer opens a QR.' }); setInviteOpen(false); setInvite({ email: '', displayName: '', role: 'viewer' }); resource.reload(); }
    catch (cause) { notify({ type: 'error', text: cause instanceof Error ? cause.message : 'Invitation failed.' }); }
    finally { setInviteBusy(false); }
  }
  async function update(event: React.FormEvent) {
    event.preventDefault(); if (!edit || updateBusy) return; setUpdateBusy(true);
    try { await api.admin(session, 'staff.update', { userId: edit.row.user_id, role: edit.role, active: edit.active, reason: edit.reason }); notify({ type: 'success', text: `${edit.row.display_name} was updated. Server checks apply immediately; sign in again to refresh navigation.` }); setEdit(null); resource.reload(); }
    catch (cause) { notify({ type: 'error', text: cause instanceof Error ? cause.message : 'Staff access could not be updated.' }); }
    finally { setUpdateBusy(false); }
  }
  return <>
    <PageHeader eyebrow="Owner controls" title="Staff access" description="Admin has full operational access. Owner also manages staff accounts and responsibilities." action={<button className="button button--primary" onClick={() => setInviteOpen(true)}><Plus size={16} /> Invite staff</button>} />
    {resource.loading && !resource.data ? <LoadingBlock label="Loading staff" /> : resource.error || !resource.data ? <LoadError message={resource.error || 'Staff accounts are unavailable.'} retry={resource.reload} /> : <>
      <section className="panel panel--flush"><p className="table-sort-note">Click a heading to sort the loaded rows.</p><div className="table-scroll"><SortableTable className="data-table"><thead><tr><th>Staff member</th><th>Role</th><th>Status</th><th>Responsibilities</th><th>Training authority</th><th>Controls</th></tr></thead><tbody>{resource.data.rows.map(row => <tr key={row.user_id}>
        <td><strong>{row.display_name}</strong>{row.user_id === session.userId && <small>Current account</small>}<small>Added {nepalDateTime(row.created_at)}</small></td>
        <td>{roleLabels[row.role]}</td><td><StatusBadge tone={row.active ? 'good' : 'bad'}>{row.active ? 'Active' : 'Inactive'}</StatusBadge></td>
        <td>{['owner', 'admin'].includes(row.role) ? 'All operations' : (row.capabilities ?? (row.role === 'trainer' ? ['training'] : [])).join(', ') || 'None'}</td>
        <td>{['owner', 'admin'].includes(row.role) ? 'All types' : !(row.capabilities ?? (row.role === 'trainer' ? ['training'] : [])).includes('training') ? 'None' : row.training_certification_type_ids == null ? 'All types · review existing authority' : row.training_certification_type_ids.length ? row.training_certification_type_ids.map(id => resource.data?.certificationTypes.find(type => type.id === id)?.display_name || 'Inactive certification').join(', ') : 'Awaiting assignment'}</td>
        <td><button className="table-action" onClick={() => setEdit({ row, role: row.role, active: row.active, reason: '' })}>Edit access for {row.display_name}</button></td>
      </tr>)}</tbody></SortableTable></div></section>
      <Responsibilities staff={resource.data.rows} types={resource.data.certificationTypes} onSaved={() => { notify({ type: 'success', text: 'Responsibilities and equipment training authority saved.' }); resource.reload(); }} />
    </>}
    <Modal title="Review staff access" open={Boolean(edit)} onClose={() => { if (!updateBusy) setEdit(null); }}>{edit && <form onSubmit={event => void update(event)}>
      <p>{edit.row.display_name}</p>
      <label className="field">Role<select aria-label="Role" disabled={updateBusy} value={edit.role} onChange={event => setEdit({ ...edit, role: event.target.value as StaffRole })}>{(['viewer', 'trainer', 'admin', 'owner'] as StaffRole[]).map(role => <option key={role} value={role} disabled={finalOwner && role !== 'owner'}>{roleLabels[role]}</option>)}</select></label>
      <label className="checkbox-field"><input type="checkbox" checked={edit.active} disabled={updateBusy || finalOwner} onChange={event => setEdit({ ...edit, active: event.target.checked })} />Active staff access</label>
      {finalOwner && <p>The final active Owner must remain active with Owner access.</p>}
      {['owner', 'admin'].includes(edit.role) && <p>This role grants all operational controls.{edit.role === 'owner' ? ' Owner also manages staff access.' : ''}</p>}
      {['owner', 'admin'].includes(edit.row.role) && ['viewer', 'trainer', 'ambassador'].includes(edit.role) && <p>After demotion, assign the intended responsibilities and equipment training authority separately.</p>}
      <label className="field">Access review note<textarea required minLength={10} maxLength={1000} disabled={updateBusy} value={edit.reason} onChange={event => setEdit({ ...edit, reason: event.target.value })} /></label>
      <div className="button-row"><button type="button" className="button button--secondary" disabled={updateBusy} onClick={() => setEdit(null)}>Cancel</button><button className="button button--primary" disabled={updateBusy}>{updateBusy ? 'Saving…' : 'Save staff access'}</button></div>
    </form>}</Modal>
    <Modal title="Invite staff member" open={inviteOpen} onClose={() => { if (!inviteBusy) setInviteOpen(false); }}><form onSubmit={event => void sendInvite(event)}><div className="form-grid">
      <label className="field field--full"><span>Name</span><input required disabled={inviteBusy} value={invite.displayName} onChange={event => setInvite({ ...invite, displayName: event.target.value })} /></label>
      <label className="field field--full"><span>Email</span><input required type="email" disabled={inviteBusy} value={invite.email} onChange={event => setInvite({ ...invite, email: event.target.value })} /></label>
      <label className="field field--full"><span>Role</span><select disabled={inviteBusy} value={invite.role} onChange={event => setInvite({ ...invite, role: event.target.value as StaffRole })}><option value="viewer">Staff · assign tasks after inviting</option><option value="trainer">Trainer · assign equipment authority after inviting</option><option value="admin">Admin · all operations</option><option value="owner">Owner · staff and all controls</option></select></label>
    </div><div className="button-row"><button type="button" className="button button--secondary" disabled={inviteBusy} onClick={() => setInviteOpen(false)}>Cancel</button><button className="button button--primary" disabled={inviteBusy}>{inviteBusy ? 'Sending…' : 'Send invitation'}</button></div></form></Modal>
  </>;
}

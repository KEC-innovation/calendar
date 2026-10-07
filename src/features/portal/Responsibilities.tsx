import { useState } from 'react';
import { portal, message } from './client';

export interface ResponsibilityStaff {
  user_id: string;
  display_name: string;
  role: string;
  active?: boolean;
  capabilities?: string[] | null;
  training_certification_type_ids?: string[] | null;
  updated_at?: string;
}
export interface TrainingType { id: string; display_name: string }
const tasks = [
  ['training', 'Run QR quizzes and record equipment training'],
  ['access', 'Verify one-time safety, waiver and age records; invite accounts'],
  ['subscriptions', 'Record external subscriptions and payment receipts'],
  ['catalog', 'Maintain published materials and electronics'],
] as const;
function AssignmentEditor({ staff, types, onSaved }: { staff: ResponsibilityStaff; types: TrainingType[]; onSaved: () => void }) {
  const [capabilities, setCapabilities] = useState(staff.capabilities ?? (staff.role === 'trainer' ? ['training'] : []));
  const [allTypes, setAllTypes] = useState(staff.training_certification_type_ids == null);
  const [trainingTypes, setTrainingTypes] = useState(staff.training_certification_type_ids ?? []);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const training = capabilities.includes('training');
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice(''); setError('');
    try {
      await portal('staff.capabilities', {
        userId: staff.user_id, capabilities,
        trainingCertificationTypeIds: training ? allTypes ? null : trainingTypes : [], reason,
      });
      setNotice('Responsibilities saved. Server permission checks apply on the next request.');
      setReason(''); onSaved();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <form className="portal-form staff-responsibility-form" onSubmit={event => void save(event)}>
    <fieldset disabled={busy}><legend>Assigned responsibilities</legend>
      {tasks.map(([value, label]) => <label className="checkbox-field" key={value}><input type="checkbox" checked={capabilities.includes(value)} onChange={event => setCapabilities(current => event.target.checked ? [...current, value] : current.filter(task => task !== value))} />{label}</label>)}
    </fieldset>
    {training && <fieldset disabled={busy}><legend>Equipment training authority</legend>
      <p>Confirm that this person is authorized to teach and assess these equipment certifications. An ambassador or intern appointment alone does not grant training authority.</p>
      <label className="checkbox-field"><input type="checkbox" checked={allTypes} onChange={event => setAllTypes(event.target.checked)} />Authorize all equipment certification types, including types added later</label>
      {!allTypes && types.map(type => <label className="checkbox-field" key={type.id}><input type="checkbox" checked={trainingTypes.includes(type.id)} onChange={event => setTrainingTypes(current => event.target.checked ? [...current, type.id] : current.filter(id => id !== type.id))} />{type.display_name}</label>)}
      {!allTypes && !trainingTypes.length && <p>Choose at least one certification type to enable equipment training.</p>}
    </fieldset>}
    <label className="field">Eligibility / responsibility review note<textarea required minLength={10} maxLength={1000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="Record the duties and, for trainers, verified training eligibility." /></label>
    <button className="button button--primary" disabled={busy || (training && !allTypes && !trainingTypes.length)}>{busy ? 'Saving…' : 'Save responsibilities'}</button>
    {notice && <p role="status">{notice}</p>}{error && <p className="alert alert--error" role="alert">{error}</p>}
  </form>;
}
export function Responsibilities({ staff, types, onSaved }: { staff: ResponsibilityStaff[]; types: TrainingType[]; onSaved: () => void }) {
  const [userId, setUserId] = useState('');
  const selected = staff.find(row => row.user_id === userId && ['viewer', 'trainer', 'ambassador'].includes(row.role));
  return <section className="panel"><h2>Assign staff responsibilities</h2>
    <p>Owner manages staff access. Admin keeps all operational controls. Staff and trainers receive only their assigned tasks; training can be limited to specific equipment certification types.</p>
    <label className="field">Staff member<select aria-label="Staff member" value={userId} onChange={event => setUserId(event.target.value)}><option value="">Choose a staff member</option>{staff.filter(row => ['viewer', 'trainer', 'ambassador'].includes(row.role)).map(row => <option key={row.user_id} value={row.user_id}>{row.display_name}{row.active === false ? ' (inactive)' : ''} · current tasks: {(row.capabilities ?? (row.role === 'trainer' ? ['training'] : [])).join(', ') || 'none'}</option>)}</select></label>
    {selected && <AssignmentEditor key={`${selected.user_id}-${selected.updated_at ?? ''}`} staff={selected} types={types} onSaved={onSaved} />}
  </section>;
}

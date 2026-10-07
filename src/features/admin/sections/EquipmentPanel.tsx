import { SortableTable } from '../../../components/SortableTable';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../../lib/api';
import { Modal } from '../../../components/Modal';
import { Spinner } from '../../../components/Spinner';
import { StatusBadge } from '../../../components/StatusBadge';
import { can, LoadError, LoadingBlock, PageHeader, pretty, relation, statusTone, useAdminData, type AdminProps } from '../adminShared';

interface CertificationRelation { display_name: string }
interface EquipmentRow {
  id: string; slug: string; display_name: string; category_id: string;
  status: 'active' | 'out_of_service' | 'inactive'; booking_enabled: boolean; external_allowed: boolean;
  max_booking_minutes: number; google_calendar_id?: string | null; notes?: string | null;
  equipment_categories?: { id: string; display_name: string } | Array<{ id: string; display_name: string }>;
  equipment_certification_requirements?: Array<{ certification_type_id: string; certification_types?: CertificationRelation | CertificationRelation[] }>;
}
interface EquipmentData {
  rows: EquipmentRow[];
  categories: Array<{ id: string; display_name: string; active: boolean }>;
  certificationTypes: Array<{ id: string; display_name: string; active: boolean }>;
}
interface Draft {
  id: string; slug: string; displayName: string; categoryId: string; status: EquipmentRow['status'];
  bookingEnabled: boolean; externalAllowed: boolean; maxMinutes: number; calendarId: string;
  notes: string; certificationTypeIds: string[];
}

export function EquipmentPanel({ session, notify }: AdminProps) {
  const resource = useAdminData<EquipmentData>(session, 'equipment.list');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  function open(row?: EquipmentRow) {
    if (!resource.data) return;
    setDraft(row ? {
      id: row.id, slug: row.slug, displayName: row.display_name, categoryId: row.category_id,
      status: row.status, bookingEnabled: row.booking_enabled, externalAllowed: row.external_allowed,
      maxMinutes: row.max_booking_minutes, calendarId: row.google_calendar_id || '', notes: row.notes || '',
      certificationTypeIds: (row.equipment_certification_requirements || []).map((item) => item.certification_type_id),
    } : { id: '', slug: '', displayName: '', categoryId: resource.data.categories[0]?.id || '', status: 'active', bookingEnabled: true, externalAllowed: false, maxMinutes: 360, calendarId: '', notes: '', certificationTypeIds: [] });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!draft) return; setSaving(true);
    try {const archiveReason=draft.status==='inactive'?window.prompt('Reason for archiving this equipment (at least 10 characters)'):'';if(draft.status==='inactive'&&!archiveReason)return;await api.admin(session, 'equipment.save', { equipment: draft, archiveReason:archiveReason||'' }); notify({ type: 'success', text: `${draft.displayName} was saved.` }); setDraft(null); resource.reload(); }
    catch (cause) { notify({ type: 'error', text: cause instanceof Error ? cause.message : 'Equipment could not be saved.' }); }
    finally { setSaving(false); }
  }
  return <>
    <PageHeader eyebrow="Resources" title="Equipment" description="Availability, booking eligibility, certification requirements, and calendar mapping." action={can(session, 'admin') ? <button className="button button--primary" onClick={() => open()}><Plus size={16} /> Add equipment</button> : undefined} />
    {resource.loading && !resource.data ? <LoadingBlock label="Loading equipment" /> : resource.error || !resource.data ? <LoadError message={resource.error || 'Equipment is unavailable.'} retry={resource.reload} /> : <section className="panel panel--flush"><p className="table-sort-note">Click a heading to sort the loaded rows.</p><div className="table-scroll"><SortableTable className="data-table"><thead><tr><th>Equipment</th><th>Category</th><th>Access</th><th>Status</th><th>Maximum</th><th></th></tr></thead><tbody>{resource.data.rows.map((row) => <tr key={row.id}><td><strong>{row.display_name}</strong><small>{row.slug}</small></td><td>{relation(row.equipment_categories)?.display_name}</td><td>{row.equipment_certification_requirements?.length ? row.equipment_certification_requirements.map((item) => relation(item.certification_types)?.display_name).filter(Boolean).join(', ') : 'General'}</td><td><StatusBadge tone={statusTone(row.status)}>{pretty(row.status)}</StatusBadge>{!row.booking_enabled && <small>Booking off</small>}</td><td>{row.max_booking_minutes / 60} hours</td><td>{can(session, 'admin') && <button className="table-action" type="button" onClick={() => open(row)}>Edit</button>}</td></tr>)}</tbody></SortableTable></div></section>}
    <Modal title={draft?.id ? 'Edit equipment' : 'Add equipment'} open={Boolean(draft)} onClose={() => setDraft(null)}>{draft && resource.data && <form onSubmit={(event) => void save(event)}><div className="form-grid"><label className="field"><span>Name</span><input required value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label><label className="field"><span>Slug</span><input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} /></label><label className="field"><span>Category</span><select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}>{resource.data.categories.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label><label className="field"><span>Status</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Draft['status'] })}><option value="active">Active</option><option value="out_of_service">Out of service</option><option disabled={session.role!=='owner'} value="inactive">Inactive</option></select></label><label className="field"><span>Maximum minutes</span><input type="number" min="15" max="360" step="15" value={draft.maxMinutes} onChange={(event) => setDraft({ ...draft, maxMinutes: Number(event.target.value) })} /></label><label className="field"><span>Google Calendar ID</span><input value={draft.calendarId} onChange={(event) => setDraft({ ...draft, calendarId: event.target.value })} /></label><div className="field field--full"><span>Certification requirements</span><div className="check-grid">{resource.data.certificationTypes.filter((item) => item.active).map((item) => <label key={item.id}><input type="checkbox" checked={draft.certificationTypeIds.includes(item.id)} onChange={(event) => setDraft({ ...draft, certificationTypeIds: event.target.checked ? [...draft.certificationTypeIds, item.id] : draft.certificationTypeIds.filter((id) => id !== item.id) })} /> {item.display_name}</label>)}</div></div><label className="check-line"><input type="checkbox" checked={draft.bookingEnabled} onChange={(event) => setDraft({ ...draft, bookingEnabled: event.target.checked })} /> Public booking enabled</label><label className="check-line"><input type="checkbox" checked={draft.externalAllowed} onChange={(event) => setDraft({ ...draft, externalAllowed: event.target.checked })} /> External users allowed</label><label className="field field--full"><span>Notes</span><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label></div><div className="button-row"><button className="button button--secondary" type="button" onClick={() => setDraft(null)}>Cancel</button><button className="button button--primary" disabled={saving}>{saving ? <Spinner label="Saving" /> : 'Save equipment'}</button></div></form>}</Modal>
  </>;
}

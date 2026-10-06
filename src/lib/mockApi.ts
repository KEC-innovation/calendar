import { evaluateEquipmentAccess } from '../../supabase/functions/_shared/equipmentAccess';
import type {
  AvailabilityResult, BookingConfirmation, BookingRequest, IdentityInput, IdentityVerification,
  JsonObject, PublicBootstrap, QuizResult, QuizSession, StaffRole, StaffSession,
} from '../types/domain';

const nowIso = (hours = 0) => new Date(Date.now() + hours * 60 * 60_000).toISOString();
let sequence = 0;
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++sequence}`;

const bootstrap: PublicBootstrap = {
  timezone: 'Asia/Kathmandu',
  weeklyHours: [
    { isoDay: 1, dayName: 'Monday', openTime: '09:00:00', closeTime: '19:00:00', bookable: true },
    { isoDay: 2, dayName: 'Tuesday', openTime: '09:00:00', closeTime: '19:00:00', bookable: true },
    { isoDay: 3, dayName: 'Wednesday', openTime: '09:00:00', closeTime: '19:00:00', bookable: true },
    { isoDay: 4, dayName: 'Thursday', openTime: '09:00:00', closeTime: '18:00:00', bookable: true },
    { isoDay: 5, dayName: 'Friday', openTime: '09:00:00', closeTime: '17:00:00', bookable: true },
    { isoDay: 6, dayName: 'Saturday', openTime: '09:00:00', closeTime: '17:00:00', bookable: true },
    { isoDay: 7, dayName: 'Sunday', openTime: '09:00:00', closeTime: '17:00:00', bookable: true },
  ],
  categories: [
    { value: 'kec_student', label: 'KEC student' }, { value: 'kec_staff', label: 'KEC staff' },
    { value: 'other_college_student', label: 'Other college student' }, { value: 'business_external', label: 'Business / external' },
    { value: 'member_non_kec', label: 'Non-KEC member' },
  ],
  policy: { maxBookingMinutes: 360, cancellationCutoffMinutes: 120, lateArrivalMinutes: 15, quizMinutes: 8, quizPassMark: 16, quizMaxScore: 20 },
};

const categories = [
  { id: 'cat-print', slug: 'additive', display_name: '3D printing', active: true },
  { id: 'cat-laser', slug: 'laser', display_name: 'Laser cutting', active: true },
  { id: 'cat-scan', slug: 'scanning', display_name: '3D scanning', active: true },
  { id: 'cat-electronics', slug: 'electronics', display_name: 'Electronics', active: true },
  { id: 'cat-design', slug: 'design', display_name: 'Design workstation', active: true },
];
const certificationTypes = [
  { id: 'cert-3d', slug: '3d-printing', display_name: '3D Printing', active: true },
  { id: 'cert-laser', slug: 'laser-cutting', display_name: 'Laser Cutting', active: true },
  { id: 'cert-scan', slug: '3d-scanning', display_name: '3D Scanning', active: true },
  { id: 'cert-electronics', slug: 'electronics-safety', display_name: 'Electronics Safety', active: true },
];

interface MockEquipment {
  id: string; slug: string; display_name: string; category_id: string; status: string; booking_enabled: boolean;
  external_allowed: boolean; max_booking_minutes: number; google_calendar_id: string | null; notes: string | null;
  equipment_categories: { id: string; display_name: string };
  equipment_certification_requirements: Array<{ certification_type_id: string; certification_types: { display_name: string } }>;
}

const equipment: MockEquipment[] = [
  ['eq-ender-1', 'ender-3-v3-ke-1', 'Anycubic Kobra 3 (Nagini)', 'cat-print', 'cert-3d'],
  ['eq-ender-2', 'ender-3-v3-ke-2', 'Anycubic Neo (Niro)', 'cat-print', 'cert-3d'],
  ['eq-bambu-1', 'bambu-lab-a1-1', 'Bambu A1 (1)', 'cat-print', 'cert-3d'],
  ['eq-bambu-2', 'bambu-lab-a1-2', 'Bambu A1 (2)', 'cat-print', 'cert-3d'],
  ['eq-laser', 'laser-cutter', 'Laser Cutter', 'cat-laser', 'cert-laser'],
  ['eq-scanner', '3d-scanner', '3D Scanner', 'cat-scan', 'cert-scan'],
  ['eq-electronics-1', 'electronics-station-1', 'Electronics Station #1', 'cat-electronics', 'cert-electronics'],
  ['eq-electronics-2', 'electronics-station-2', 'Electronics Station #2', 'cat-electronics', 'cert-electronics'],
  ['eq-design-1', 'design-workstation-1', 'Design Workstation #1', 'cat-design', ''],
  ['eq-design-2', 'design-workstation-2', 'Design Workstation #2', 'cat-design', ''],
  ['eq-design-3', 'design-workstation-3', 'Design Workstation #3', 'cat-design', ''],
].map(([equipmentId, slug, name, categoryId, certId]) => {
  const category = categories.find((item) => item.id === categoryId) || categories[0]!;
  const cert = certificationTypes.find((item) => item.id === certId);
  return {
    id: equipmentId!, slug: slug!, display_name: name!, category_id: categoryId!, status: 'active', booking_enabled: true,
    external_allowed: categoryId === 'cat-design', max_booking_minutes: 360, google_calendar_id: null, notes: null,
    equipment_categories: { id: category.id, display_name: category.display_name },
    equipment_certification_requirements: cert ? [{ certification_type_id: cert.id, certification_types: { display_name: cert.display_name } }] : [],
  };
});

interface MockPerson {
  id: string; email: string; full_name: string; roll_number: string | null; phone: string | null; category: string;
  organization: string | null; active: boolean; booking_privilege_active: boolean; safety_training_status: string;
  waiver_status: string; minor_status: string; migration_review_required: boolean; created_at: string;
}
const people: MockPerson[] = [
  { id: 'person-1', email: 'student@kec.edu.np', full_name: 'Aarav Shrestha', roll_number: 'KEC-001', phone: '+977 9800000000', category: 'kec_student', organization: 'Kathmandu Engineering College', active: true, booking_privilege_active: true, safety_training_status: 'verified', waiver_status: 'verified', minor_status: 'adult', migration_review_required: false, created_at: nowIso(-200) },
  { id: 'person-2', email: 'review@kec.edu.np', full_name: 'Maya Thapa', roll_number: 'KEC-002', phone: null, category: 'kec_student', organization: 'Kathmandu Engineering College', active: true, booking_privilege_active: true, safety_training_status: 'verified', waiver_status: 'unknown', minor_status: 'unknown', migration_review_required: true, created_at: nowIso(-100) },
];

interface MockBooking {
  id: string; booking_reference: string; status: string; starts_at: string; ends_at: string; contact_name: string;
  contact_email: string; contact_phone: string; purpose: string | null; after_hours_override: boolean; late_cancellation: boolean;
  calendar_sync_status: string; last_calendar_sync_error: string | null; equipment: { id: string; display_name: string };
}
const bookings: MockBooking[] = [{ id: 'booking-1', booking_reference: 'KEC-DEMO-001', status: 'confirmed', starts_at: nowIso(2), ends_at: nowIso(3), contact_name: 'Aarav Shrestha', contact_email: 'student@kec.edu.np', contact_phone: '+977 9800000000', purpose: 'Prototype enclosure', after_hours_override: false, late_cancellation: false, calendar_sync_status: 'not_configured', last_calendar_sync_error: null, equipment: { id: 'eq-bambu-1', display_name: 'Bambu A1 (1)' } }];
const manageTokens = new Map<string, string>([['KEC-DEMO-001', 'demo-manage-token']]);

const quizzes = [
  { id: 'quiz-3d', slug: '3d-printing-safety', display_name: '3D Printing Safety', duration_minutes: 8, question_count: 20, pass_mark: 16, active: true, version: 1, notes: 'Synthetic E2E quiz bank' },
  { id: 'quiz-laser', slug: 'laser-cutter-safety', display_name: 'Laser Cutter Safety', duration_minutes: 8, question_count: 20, pass_mark: 16, active: true, version: 1, notes: 'Synthetic E2E quiz bank' },
];
const makeQuestions = () => Array.from({ length: 20 }, (_, index) => ({ id: `q-${index + 1}`, prompt: `Safety scenario ${index + 1}: choose the approved action.`, options: Array.from({ length: 4 }, (__, option) => ({ id: `q-${index + 1}-o-${option + 1}`, label: `Procedure ${String.fromCharCode(65 + option)}` })) }));
const quizSessions = new Map<string, QuizSession>();
const attempts: Array<Record<string, unknown>> = [{ id: 'attempt-1', attempt_reference: 'QUIZ-DEMO-001', status: 'submitted', started_at: nowIso(-24), submitted_at: nowIso(-23.9), score: 18, max_score: 20, passed: true, trainer_name_snapshot: 'Demo Owner', people: { full_name: 'Aarav Shrestha', email: 'student@kec.edu.np' }, quizzes: { display_name: '3D Printing Safety' } }];
const certifications: Array<Record<string, unknown>> = [{ id: 'person-1-cert-3d', status: 'active', issued_at: nowIso(-23), source_kind: 'quiz', reason: null, people: { id: 'person-1', full_name: 'Aarav Shrestha', email: 'student@kec.edu.np', roll_number: 'KEC-001' }, certification_types: { id: 'cert-3d', display_name: '3D Printing' } }];
certifications.push({ id: 'person-2-cert-3d', status: 'active', issued_at: null, source_kind: 'legacy_permission', people: { id: 'person-2' }, certification_types: { id: 'cert-3d', display_name: '3D Printing' } });
const closures: Array<Record<string, unknown>> = [];
const staffRows = [
  { user_id: 'staff-owner', display_name: 'Demo Owner', role: 'owner' as StaffRole, active: true, created_at: nowIso(-1000), updated_at: nowIso(-10) },
  { user_id: 'staff-trainer', display_name: 'Demo Trainer', role: 'trainer' as StaffRole, active: true, created_at: nowIso(-500), updated_at: nowIso(-5) },
];
const auditRows: Array<Record<string, unknown>> = [{ id: 1, actor_user_id: 'staff-owner', actor_display: 'Demo Owner', action: 'system_initialized', target_type: 'system', target_id: null, created_at: nowIso(-1000), metadata: { source: 'synthetic_e2e' } }];

export async function mockSignIn(email: string, password: string): Promise<StaffSession> {
  await Promise.resolve();
  if (!email || password !== 'demo1234') throw new Error('Use a demo staff email and password demo1234.');
  const local = email.split('@')[0]?.toLowerCase() || 'viewer';
  const role: StaffRole = local.includes('owner') ? 'owner' : local.includes('admin') ? 'admin' : local.includes('trainer') ? 'trainer' : 'viewer';
  const session = { accessToken: `mock-${role}`, userId: `staff-${role}`, email, displayName: `Demo ${role[0]?.toUpperCase()}${role.slice(1)}`, role };
  sessionStorage.setItem('kec-mock-session', JSON.stringify(session));
  return session;
}

export async function mockDemoSignIn(): Promise<StaffSession> {
  return mockSignIn('owner@demo.invalid', 'demo1234');
}

function publicAction(body: JsonObject): unknown {
  const action = String(body.action || '');
  if (action === 'bootstrap') return bootstrap;
  if (action === 'verify-identity') {
    const identity = body.identity as unknown as IdentityInput;
    const person = people.find((row) => row.email.toLowerCase() === identity.email.trim().toLowerCase() && row.category === identity.category && (identity.category !== 'kec_student' || row.roll_number?.toUpperCase() === identity.rollNumber?.trim().toUpperCase())) || null;
    const certRows = certifications.filter((cert) => (cert.people as { id: string }).id === person?.id && cert.status === 'active');
    const certIds = certRows.map((cert) => (cert.certification_types as { id: string }).id);
    const resources = equipment.flatMap((item) => {
      const access = evaluateEquipmentAccess({ person, requiredCertifications: item.equipment_certification_requirements.map((req) => req.certification_type_id), activeCertifications: certIds, status: item.status, bookingEnabled: item.booking_enabled, external: !['kec_student', 'kec_staff'].includes(identity.category), externalAllowed: item.external_allowed });
      return access.visible ? [{ id: item.id, slug: item.slug, displayName: item.display_name, categoryName: item.equipment_categories.display_name, status: item.status as 'active', bookingEnabled: item.booking_enabled, externalAllowed: item.external_allowed, maxMinutes: item.max_booking_minutes, ...access }] : [];
    });
    return { identityStatus: person ? (person.active ? 'verified' : 'inactive') : 'needs_staff_review', resources, recognizedTraining: certRows.map((cert) => (cert.certification_types as { display_name: string }).display_name), message: person ? 'Your existing training is recognized. Any other record checks are listed separately.' : 'No exact record matched. Ask staff to check your email and roll number.', verificationId: id('verify'), expiresAt: nowIso(0.25) } satisfies IdentityVerification;
  }
  if (action === 'availability') {
    const equipmentId = String(body.equipmentId || ''); const date = String(body.date || '');
    return { equipmentId, date, timezone: 'Asia/Kathmandu', busy: bookings.filter((row) => row.equipment.id === equipmentId && row.status === 'confirmed').map((row) => ({ startsAt: row.starts_at, endsAt: row.ends_at })) } satisfies AvailabilityResult;
  }
  if (action === 'create-booking') {
    const request = body.booking as unknown as BookingRequest;
    const start = new Date(request.startsAt); const end = new Date(request.endsAt);
    if (start <= new Date() || end <= start) throw new Error('Choose a future time with the end after the start.');
    if (end.getTime() - start.getTime() > 6 * 60 * 60_000) throw new Error('Bookings may not exceed 6 hours.');
    const clash = bookings.some((row) => row.equipment.id === request.equipmentId && row.status === 'confirmed' && start < new Date(row.ends_at) && end > new Date(row.starts_at));
    if (clash) throw new Error('That equipment is already booked during this time.');
    const machine = equipment.find((item) => item.id === request.equipmentId);
    if (!machine) throw new Error('Equipment not found.');
    const reference = `KEC-DEMO-${String(bookings.length + 1).padStart(3, '0')}`; const token = id('manage');
    bookings.push({ id: id('booking'), booking_reference: reference, status: 'confirmed', starts_at: request.startsAt, ends_at: request.endsAt, contact_name: request.fullName, contact_email: request.email, contact_phone: request.phone, purpose: request.purpose || null, after_hours_override: false, late_cancellation: false, calendar_sync_status: 'not_configured', last_calendar_sync_error: null, equipment: { id: machine.id, display_name: machine.display_name } });
    manageTokens.set(reference, token);
    return { bookingReference: reference, manageToken: token, startsAt: request.startsAt, endsAt: request.endsAt, equipmentName: machine.display_name, calendarSyncStatus: 'not_configured', notificationStatus: 'not_configured' } satisfies BookingConfirmation;
  }
  if (action === 'cancel-booking') {
    const reference = String(body.bookingReference || ''); const token = String(body.manageToken || '');
    const booking = bookings.find((item) => item.booking_reference === reference);
    if (!booking || manageTokens.get(reference) !== token) throw new Error('Booking reference or management token is invalid.');
    const lateCancellation = new Date(booking.starts_at).getTime() < Date.now() + 2 * 60 * 60_000;
    booking.status = 'cancelled'; booking.late_cancellation = lateCancellation;
    return { lateCancellation };
  }
  throw new Error('Unknown mock public operation.');
}

function quizAction(body: JsonObject): unknown {
  const action = String(body.action || '');
  if (action === 'start') {
    const participant = body.participant as Record<string, unknown>;
    if (!participant.confirmAdult || !participant.confirmSafetyTraining || !participant.confirmWaiver) throw new Error('Safety training, waiver, and adult status must be confirmed.');
    const quiz = quizzes.find((item) => item.id === body.quizId && item.active);
    if (!quiz) throw new Error('Quiz is not active.');
    const token = id('quiz');
    const session: QuizSession = { attemptToken: token, attemptReference: `QUIZ-DEMO-${Date.now()}`, quizName: quiz.display_name, participantName: String(participant.fullName), participantEmail: String(participant.email), trainerName: 'Demo Trainer', passMark: 16, maxScore: 20, expiresAt: new Date(Date.now() + 8 * 60_000).toISOString(), questions: makeQuestions() };
    quizSessions.set(token, session); return session;
  }
  const token = String(body.attemptToken || '');
  if (action === 'resume') {
    const session = quizSessions.get(token);
    if (!session) throw new Error('Quiz session is missing or invalid.');
    return session;
  }
  if (action === 'submit') {
    const session = quizSessions.get(token);
    if (!session) throw new Error('Quiz session is missing or has already ended.');
    const answers = Array.isArray(body.answers) ? body.answers : [];
    const score = Math.min(18, answers.length);
    quizSessions.delete(token);
    return { attemptReference: session.attemptReference, score, maxScore: 20, passMark: 16, passed: score >= 16, certificationNames: score >= 16 ? [session.quizName.replace(' Safety', '')] : [] } satisfies QuizResult;
  }
  throw new Error('Unknown mock quiz operation.');
}

function page<T>(rows: T[]): { rows: T[]; page: number; pageSize: number; total: number } { return { rows, page: 1, pageSize: 25, total: rows.length }; }

function adminAction(body: JsonObject): unknown {
  const action = String(body.action || '');
  if (action === 'dashboard') return { today: bookings, todayCount: bookings.length, upcoming: bookings.filter((row) => row.status === 'confirmed'), equipment: { active: equipment.filter((row) => row.status === 'active' && row.booking_enabled).length, outOfService: equipment.filter((row) => row.status === 'out_of_service').length, inactive: equipment.filter((row) => row.status === 'inactive' || !row.booking_enabled).length }, recentCertifications: certifications, failedAttempts: [], calendarFailures: [] };
  if (action === 'equipment.list') return { rows: equipment, categories, certificationTypes };
  if (action === 'equipment.save') {
    const value = body.equipment as Record<string, unknown>; const existing = equipment.find((row) => row.id === value.id);
    const category = categories.find((row) => row.id === value.categoryId) || categories[0]!;
    const certIds = Array.isArray(value.certificationTypeIds) ? value.certificationTypeIds.map(String) : [];
    const row: MockEquipment = { id: existing?.id || id('equipment'), slug: String(value.slug), display_name: String(value.displayName), category_id: String(value.categoryId), status: String(value.status), booking_enabled: value.bookingEnabled !== false, external_allowed: value.externalAllowed === true, max_booking_minutes: Number(value.maxMinutes), google_calendar_id: String(value.calendarId || '') || null, notes: String(value.notes || '') || null, equipment_categories: { id: category.id, display_name: category.display_name }, equipment_certification_requirements: certIds.map((certId) => ({ certification_type_id: certId, certification_types: { display_name: certificationTypes.find((cert) => cert.id === certId)?.display_name || 'Certification' } })) };
    if (existing) Object.assign(existing, row); else equipment.push(row); return { id: row.id };
  }
  if (action === 'people.list') {
    const search = String(body.search || '').toLowerCase(); const review = body.reviewOnly === true;
    const filtered = people.filter((row) => (!search || `${row.full_name} ${row.email} ${row.roll_number || ''}`.toLowerCase().includes(search)) && (!review || row.migration_review_required));
    const pageNumber = Math.max(1, Number(body.page) || 1);
    return { rows: filtered.slice((pageNumber - 1) * 25, pageNumber * 25).map((row) => ({ ...row, certifications: certifications.filter((cert) => (cert.people as { id: string }).id === row.id), quiz_attempts: attempts.filter((attempt) => (attempt.people as { email: string }).email === row.email) })), page: pageNumber, pageSize: 25, total: filtered.length };
  }
  if (action === 'people.save') {
    const value = body.person as Record<string, unknown>; const existing = people.find((row) => row.id === value.id);
    const row: MockPerson = { id: existing?.id || id('person'), email: String(value.email), full_name: String(value.fullName), roll_number: String(value.rollNumber || '') || null, phone: String(value.phone || '') || null, category: String(value.category), organization: String(value.organization || '') || null, active: value.active !== false, booking_privilege_active: value.bookingPrivilegeActive !== false, safety_training_status: String(value.safetyTrainingStatus), waiver_status: String(value.waiverStatus), minor_status: String(value.minorStatus), migration_review_required: value.migrationReviewRequired === true, created_at: existing?.created_at || nowIso() };
    if (existing) Object.assign(existing, row); else people.push(row); return { id: row.id };
  }
  if (action === 'people.bulk-compliance') { const ids = Array.isArray(body.personIds) ? body.personIds.map(String) : []; let changed = 0; people.forEach((row) => { if (ids.includes(row.id)) { row.safety_training_status = 'verified'; row.waiver_status = 'verified'; row.minor_status = 'adult'; row.migration_review_required = false; changed += 1; } }); return { changed }; }
  if (action === 'certifications.list') { const status = String(body.status || ''); return { ...page(certifications.filter((row) => !status || row.status === status)), people, certificationTypes }; }
  if (action === 'certifications.grant') { const person = people.find((row) => row.id === body.personId); const cert = certificationTypes.find((row) => row.id === body.certificationTypeId); certifications.unshift({ id: id('certification'), status: 'active', issued_at: nowIso(), source_kind: 'manual', reason: body.reason, people: person && { id: person.id, full_name: person.full_name, email: person.email, roll_number: person.roll_number }, certification_types: cert && { id: cert.id, display_name: cert.display_name } }); return { id: certifications[0]?.id }; }
  if (action === 'certifications.status') { const row = certifications.find((item) => item.id === body.certificationId); if (row) row.status = body.status; return { ok: true }; }
  if (action === 'bookings.list') { const search = String(body.search || '').toLowerCase(); const status = String(body.status || ''); const rows = bookings.filter((row) => (!search || `${row.booking_reference} ${row.contact_name} ${row.contact_email}`.toLowerCase().includes(search)) && (!status || row.status === status)); return { ...page(rows), people, equipment }; }
  if (action === 'bookings.create') { const person = people.find((row) => row.id === body.personId); const machine = equipment.find((row) => row.id === body.equipmentId); if (!person || !machine) throw new Error('Choose a person and equipment.'); const row: MockBooking = { id: id('booking'), booking_reference: `KEC-STAFF-${bookings.length + 1}`, status: 'confirmed', starts_at: String(body.startsAt), ends_at: String(body.endsAt), contact_name: person.full_name, contact_email: person.email, contact_phone: person.phone || '', purpose: String(body.purpose || '') || null, after_hours_override: body.afterHoursOverride === true, late_cancellation: false, calendar_sync_status: 'not_configured', last_calendar_sync_error: null, equipment: { id: machine.id, display_name: machine.display_name } }; bookings.unshift(row); return { bookingReference: row.booking_reference }; }
  if (action === 'bookings.status') { const row = bookings.find((item) => item.id === body.bookingId); if (row) row.status = String(body.status); return { ok: true }; }
  if (action === 'quizzes.list') return { quizzes, attempts, certificationTypes };
  if (action === 'quizzes.get') { const quiz = quizzes.find((row) => row.id === body.quizId); return { quiz, questions: makeQuestions().map((question) => ({ id: question.id, prompt: question.prompt, legacy_question_id: null, quiz_question_options: question.options.map((option, index) => ({ ...option, position: index + 1, is_correct: index === 0 })) })) }; }
  if (action === 'quizzes.replace') { const quiz = quizzes.find((row) => row.id === body.quizId); const value = body.quiz as Record<string, unknown>; const questions = Array.isArray(value.questions) ? value.questions : []; if (quiz) Object.assign(quiz, { display_name: value.displayName, duration_minutes: Number(value.durationMinutes), pass_mark: Number(value.passMark), question_count: questions.length, active: value.active === true, version: quiz.version + 1, notes: value.notes }); return { ok: true }; }
  if (action === 'schedule.get') return { hours: bootstrap.weeklyHours.map((row) => ({ iso_day: row.isoDay, day_name: row.dayName, open_time: row.openTime, close_time: row.closeTime, bookable: row.bookable })), closures };
  if (action === 'schedule.hours-save') return { ok: true };
  if (action === 'schedule.closure-save') { const value = body.closure as Record<string, unknown>; closures.push({ id: id('closure'), closure_date: value.date, starts_at: value.startsAt || null, ends_at: value.endsAt || null, reason: value.reason, active: true }); return { id: closures.at(-1)?.id }; }
  if (action === 'schedule.closure-delete') { const row = closures.find((item) => item.id === body.closureId); if (row) row.active = false; return { ok: true }; }
  if (action === 'staff.list') return { rows: staffRows };
  if (action === 'staff.invite') { staffRows.push({ user_id: id('staff'), display_name: String(body.displayName), role: body.role as StaffRole, active: true, created_at: nowIso(), updated_at: nowIso() }); return { userId: staffRows.at(-1)?.user_id }; }
  if (action === 'staff.update') { const row = staffRows.find((item) => item.user_id === body.userId); if (row) { row.role = body.role as StaffRole; row.active = body.active !== false; } return { ok: true }; }
  if (action === 'calendar.retry') return { ok: true };
  if (action === 'audit.list') return page(auditRows);
  throw new Error(`Unknown mock admin operation: ${action}`);
}

export async function invokeMock<T>(functionName: 'public-api' | 'quiz-api' | 'admin-api', body: JsonObject, _accessToken?: string): Promise<T> {
  void _accessToken;
  await new Promise((resolve) => window.setTimeout(resolve, 25));
  const result = functionName === 'public-api' ? publicAction(body) : functionName === 'quiz-api' ? quizAction(body) : adminAction(body);
  return result as T;
}

import { requireAccount, appUrl } from '../_shared/accounts.ts';
import { adminClient, requireStaff, userClient } from '../_shared/supabase.ts';
import { handle, HttpError, json, readJson, requireUuid, requiredText, text } from '../_shared/http.ts';
import { safeEmail } from '../_shared/security.ts';
import { writeAudit } from '../_shared/audit.ts';

type Role = 'viewer' | 'trainer' | 'admin' | 'owner';
const ROLE_RANK: Record<Role, number> = { viewer: 10, trainer: 20, admin: 30, owner: 40 };

function assertRole(actual: Role, minimum: Role): void {
  if (ROLE_RANK[actual] < ROLE_RANK[minimum]) throw new HttpError(403, `${minimum[0]?.toUpperCase()}${minimum.slice(1)} role required.`, 'ROLE_REQUIRED');
}

function pageValues(body: Record<string, unknown>): { page: number; pageSize: number; from: number; to: number } {
  const page = Math.max(1, Math.floor(Number(body.page) || 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(Number(body.pageSize) || 25)));
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

function searchTerm(value: unknown): string {
  return text(value, 120).replace(/[(),"'\\%*_]/g, ' ').replace(/\s+/g, ' ').trim();
}

function localDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

Deno.serve((request) => handle(request, async () => {
  const body = await readJson(request, 300_000);
  const action = text(body.action, 80);
  await requireAccount(request);
  const staff = await requireStaff(request, 'viewer');
  if (!['owner','admin'].includes(staff.role)) throw new HttpError(403,'Use your assigned responsibilities workspace.','SCOPED_WORKSPACE');
  const admin = adminClient();

  if (action === 'dashboard') {
    const today = localDate();
    const dayStart = `${today}T00:00:00+05:45`;
    const dayEnd = `${today}T23:59:59.999+05:45`;
    const [todayBookings, upcoming, equipment, recentCerts, failedAttempts, syncFailures] = await Promise.all([
      admin.from('bookings').select('id,booking_reference,status,starts_at,ends_at,contact_name,equipment(display_name)', { count: 'exact' }).gte('starts_at', dayStart).lte('starts_at', dayEnd).order('starts_at').limit(12),
      admin.from('bookings').select('id,booking_reference,status,starts_at,ends_at,contact_name,equipment(display_name)').gte('starts_at', new Date().toISOString()).in('status', ['confirmed', 'checked_in']).order('starts_at').limit(8),
      admin.from('equipment').select('status,booking_enabled'),
      admin.from('certifications').select('id,status,issued_at,created_at,people(full_name),certification_types(display_name)').order('created_at', { ascending: false }).limit(8),
      admin.from('quiz_attempts').select('id,attempt_reference,score,max_score,submitted_at,people(full_name),quizzes(display_name)').eq('passed', false).order('submitted_at', { ascending: false }).limit(8),
      admin.from('bookings').select('id,booking_reference,last_calendar_sync_error,calendar_retry_count,equipment(display_name)').eq('calendar_sync_status', 'failed').order('updated_at', { ascending: false }).limit(8),
    ]);
    const firstError = [todayBookings, upcoming, equipment, recentCerts, failedAttempts, syncFailures].find((result) => result.error)?.error;
    if (firstError) throw firstError;
    const equipmentRows = equipment.data || [];
    return json(request, {
      today: todayBookings.data || [],
      todayCount: todayBookings.count || 0,
      upcoming: upcoming.data || [],
      equipment: {
        active: equipmentRows.filter((row) => row.status === 'active' && row.booking_enabled).length,
        outOfService: equipmentRows.filter((row) => row.status === 'out_of_service').length,
        inactive: equipmentRows.filter((row) => row.status === 'inactive' || !row.booking_enabled).length,
      },
      recentCertifications: recentCerts.data || [],
      failedAttempts: failedAttempts.data || [],
      calendarFailures: syncFailures.data || [],
    });
  }

  if (action === 'equipment.list') {
    const [{ data: rows, error }, { data: categories, error: categoryError }, { data: certificationTypes, error: certError }] = await Promise.all([
      admin.from('equipment').select('*,equipment_categories(id,display_name),equipment_certification_requirements(certification_type_id,certification_types(display_name))').order('display_name'),
      admin.from('equipment_categories').select('id,slug,display_name,active').order('display_name'),
      admin.from('certification_types').select('id,slug,display_name,active').order('display_name'),
    ]);
    if (error) throw error;
    if (categoryError) throw categoryError;
    if (certError) throw certError;
    return json(request, { rows: rows || [], categories: categories || [], certificationTypes: certificationTypes || [] });
  }

  if (action === 'equipment.save') {
    assertRole(staff.role, 'admin');
    if (!body.equipment || typeof body.equipment !== 'object' || Array.isArray(body.equipment)) throw new HttpError(400, 'Equipment details are required.', 'VALIDATION_ERROR');
    const { data, error } = await admin.rpc('admin_save_equipment', { p_actor: staff.userId, p_payload: body.equipment });
    if (error) throw new HttpError(400, error.message, 'EQUIPMENT_SAVE_FAILED');
    return json(request, { id: data });
  }

  if (action === 'people.list') {
    const page = pageValues(body);
    let query = admin.from('people').select('id,email,full_name,roll_number,phone,category,organization,active,booking_privilege_active,safety_training_status,waiver_status,minor_status,migration_review_required,priority_rank,created_at,certifications(id,status,source_kind,certification_types(display_name)),quiz_attempts(id,passed,score,max_score,source_metadata,quizzes(display_name))', { count: 'exact' });
    const search = searchTerm(body.search);
    if (search) query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,roll_number.ilike.%${search}%,organization.ilike.%${search}%`);
    const category = text(body.category, 40);
    if (category) query = query.eq('category', category);
    const reviewOnly = body.reviewOnly === true;
    if (reviewOnly) query = query.eq('migration_review_required', true);
    const { data, error, count } = await query.order('full_name').range(page.from, page.to);
    if (error) throw error;
    return json(request, { rows: data || [], page: page.page, pageSize: page.pageSize, total: count || 0 });
  }

  if (action === 'people.save') {
    assertRole(staff.role, 'admin');
    const personValue = body.person;
    if (!personValue || typeof personValue !== 'object' || Array.isArray(personValue)) throw new HttpError(400, 'Person details are required.', 'VALIDATION_ERROR');
    const person = personValue as Record<string, unknown>;
    const id = text(person.id, 50);
    const payload = {
      email: safeEmail(person.email),
      full_name: requiredText(person.fullName, 'Full name', 120),
      roll_number: text(person.rollNumber, 80) || null,
      phone: text(person.phone, 40) || null,
      category: requiredText(person.category, 'Category', 40),
      organization: text(person.organization, 160) || null,
      active: person.active !== false,
      booking_privilege_active: person.bookingPrivilegeActive !== false,
      safety_training_status: text(person.safetyTrainingStatus, 30) || 'unknown',
      waiver_status: text(person.waiverStatus, 30) || 'unknown',
      minor_status: text(person.minorStatus, 20) || 'unknown',
      migration_review_required: person.migrationReviewRequired === true,
      priority_rank: Math.min(100, Math.max(1, Number(person.priorityRank) || 30)),
    };
    const result = id
      ? await admin.from('people').update(payload).eq('id', requireUuid(id, 'Person')).select('id').single()
      : await admin.from('people').insert(payload).select('id').single();
    if (result.error) throw new HttpError(400, result.error.message, 'PERSON_SAVE_FAILED');
    await writeAudit(admin, staff, 'person_saved', 'people', result.data.id, { created: !id });
    return json(request, { id: result.data.id });
  }

  if (action === 'people.bulk-compliance') {
    assertRole(staff.role, 'admin');
    if (!Array.isArray(body.personIds)) throw new HttpError(400, 'Choose people to verify.', 'VALIDATION_ERROR');
    const ids = body.personIds.map((id) => requireUuid(id, 'Person'));
    const { data, error } = await admin.rpc('admin_bulk_verify_compliance', { p_actor: staff.userId, p_person_ids: ids });
    if (error) throw new HttpError(400, error.message, 'BULK_VERIFY_FAILED');
    return json(request, { changed: data });
  }

  if (action === 'certifications.list') {
    const page = pageValues(body);
    let query = admin.from('certifications').select('id,status,issued_at,source_kind,suspended_at,revoked_at,reason,created_at,people(id,full_name,email,roll_number),certification_types(id,display_name)', { count: 'exact' });
    const status = text(body.status, 20);
    if (status) query = query.eq('status', status);
    const personId = text(body.personId, 50);
    if (personId) query = query.eq('person_id', requireUuid(personId, 'Person'));
    const { data, error, count } = await query.order('created_at', { ascending: false }).range(page.from, page.to);
    if (error) throw error;
    const [{ data: people, error: peopleError }, { data: types, error: typeError }] = await Promise.all([
      admin.from('people').select('id,full_name,email,roll_number').eq('active', true).order('full_name').limit(500),
      admin.from('certification_types').select('id,display_name').eq('active', true).order('display_name'),
    ]);
    if (peopleError) throw peopleError;
    if (typeError) throw typeError;
    return json(request, { rows: data || [], page: page.page, pageSize: page.pageSize, total: count || 0, people: people || [], certificationTypes: types || [] });
  }

  if (action === 'certifications.grant') {
    assertRole(staff.role, 'admin');
    const user = userClient(request);
    const { data, error } = await user.rpc('grant_certification', {
      p_person_id: requireUuid(body.personId, 'Person'),
      p_certification_type_id: requireUuid(body.certificationTypeId, 'Certification type'),
      p_reason: text(body.reason, 500) || null,
    });
    if (error) throw new HttpError(400, error.message, 'CERTIFICATION_GRANT_FAILED');
    return json(request, { id: data });
  }

  if (action === 'certifications.status') {
    assertRole(staff.role, 'admin');
    const status = text(body.status, 20);
    if (!['active', 'suspended', 'revoked'].includes(status)) throw new HttpError(400, 'Certification status is invalid.', 'VALIDATION_ERROR');
    const user = userClient(request);
    const { error } = await user.rpc('set_certification_status', {
      p_certification_id: requireUuid(body.certificationId, 'Certification'),
      p_status: status,
      p_reason: requiredText(body.reason, 'Reason', 500),
    });
    if (error) throw new HttpError(400, error.message, 'CERTIFICATION_STATUS_FAILED');
    return json(request, { ok: true });
  }

  if (action === 'bookings.list') {
    const page = pageValues(body);
    let query = admin.from('bookings').select('id,booking_reference,status,starts_at,ends_at,contact_name,contact_email,contact_phone,purpose,after_hours_override,late_cancellation,calendar_sync_status,last_calendar_sync_error,created_at,equipment(id,display_name),people(id,full_name)', { count: 'exact' });
    const status = text(body.status, 20);
    if (status) query = query.eq('status', status);
    const search = searchTerm(body.search);
    if (search) query = query.or(`booking_reference.ilike.%${search}%,contact_name.ilike.%${search}%,contact_email.ilike.%${search}%`);
    const { data, error, count } = await query.order('starts_at', { ascending: false }).range(page.from, page.to);
    if (error) throw error;
    const [{ data: people, error: peopleError }, { data: equipment, error: equipmentError }] = await Promise.all([
      admin.from('people').select('id,full_name,email').eq('active', true).order('full_name').limit(500),
      admin.from('equipment').select('id,display_name,status,booking_enabled').eq('booking_enabled', true).order('display_name'),
    ]);
    if (peopleError) throw peopleError;
    if (equipmentError) throw equipmentError;
    return json(request, { rows: data || [], page: page.page, pageSize: page.pageSize, total: count || 0, people: people || [], equipment: equipment || [] });
  }

  if (action === 'bookings.create') {
    assertRole(staff.role, 'admin');
    const user = userClient(request);
    const { data, error } = await user.rpc('create_staff_booking', {
      p_person_id: requireUuid(body.personId, 'Person'),
      p_equipment_id: requireUuid(body.equipmentId, 'Equipment'),
      p_starts_at: requiredText(body.startsAt, 'Start time', 50),
      p_ends_at: requiredText(body.endsAt, 'End time', 50),
      p_purpose: text(body.purpose, 500) || null,
      p_after_hours_override: body.afterHoursOverride === true,
      p_override_reason: text(body.overrideReason, 500) || null,
    });
    if (error) {
      if (error.code === '23P01') throw new HttpError(409, 'That equipment is already booked during this time.', 'BOOKING_CONFLICT');
      throw new HttpError(400, error.message, 'BOOKING_CREATE_FAILED');
    }
    return json(request, data, 201);
  }

  if (action === 'bookings.status') {
    assertRole(staff.role, 'admin');
    const status = text(body.status, 20);
    if (!['confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'].includes(status)) throw new HttpError(400, 'Booking status is invalid.', 'VALIDATION_ERROR');
    const user = userClient(request);
    const { error } = await user.rpc('set_booking_status', {
      p_booking_id: requireUuid(body.bookingId, 'Booking'),
      p_status: status,
      p_reason: text(body.reason, 500) || null,
    });
    if (error) throw new HttpError(400, error.message, 'BOOKING_STATUS_FAILED');
    return json(request, { ok: true });
  }

  if (action === 'quizzes.list') {
    const [{ data: quizzes, error }, { data: attempts, error: attemptsError }, { data: certificationTypes, error: typesError }] = await Promise.all([
      admin.from('quizzes').select('id,slug,display_name,duration_minutes,question_count,pass_mark,active,version,notes,updated_at,quiz_certification_mappings(certification_type_id,certification_types(display_name))').order('display_name'),
      admin.from('quiz_attempts').select('id,attempt_reference,status,started_at,submitted_at,score,max_score,passed,trainer_name_snapshot,people(full_name,email),quizzes(display_name)').order('started_at', { ascending: false }).limit(50),
      admin.from('certification_types').select('id,display_name').eq('active', true).order('display_name'),
    ]);
    if (error) throw error;
    if (attemptsError) throw attemptsError;
    if (typesError) throw typesError;
    return json(request, { quizzes: quizzes || [], attempts: attempts || [], certificationTypes: certificationTypes || [] });
  }

  if (action === 'quizzes.get') {
    assertRole(staff.role, 'admin');
    const quizId = requireUuid(body.quizId, 'Quiz');
    const [{ data: quiz, error }, { data: questions, error: questionError }] = await Promise.all([
      admin.from('quizzes').select('*').eq('id', quizId).single(),
      admin.from('quiz_questions').select('id,prompt,position,legacy_question_id,quiz_question_options(id,label,position,is_correct)').eq('quiz_id', quizId).eq('active', true).order('position').order('position', { referencedTable: 'quiz_question_options' }),
    ]);
    if (error) throw error;
    if (questionError) throw questionError;
    return json(request, { quiz, questions: questions || [] });
  }

  if (action === 'quizzes.create') {
    assertRole(staff.role, 'admin');
    const slug = requiredText(body.slug, 'Quiz slug', 80);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new HttpError(400, 'Quiz slug is invalid.', 'VALIDATION_ERROR');
    const { data, error } = await admin.from('quizzes').insert({
      slug,
      display_name: requiredText(body.displayName, 'Quiz name', 160),
      duration_minutes: Math.min(60, Math.max(1, Number(body.durationMinutes) || 8)),
      question_count: 1,
      pass_mark: 1,
      active: false,
      notes: text(body.notes, 500) || null,
    }).select('id').single();
    if (error) throw new HttpError(400, error.message, 'QUIZ_CREATE_FAILED');
    await writeAudit(admin, staff, 'quiz_created', 'quizzes', data.id, {});
    return json(request, { id: data.id }, 201);
  }

  if (action === 'quizzes.replace') {
    assertRole(staff.role, 'admin');
    const quizId = requireUuid(body.quizId, 'Quiz');
    const quizValue = body.quiz;
    if (!quizValue || typeof quizValue !== 'object' || Array.isArray(quizValue)) throw new HttpError(400, 'Quiz details are required.', 'VALIDATION_ERROR');
    const { error } = await admin.rpc('admin_replace_quiz', { p_actor: staff.userId, p_quiz_id: quizId, p_payload: quizValue });
    if (error) throw new HttpError(400, error.message, 'QUIZ_SAVE_FAILED');
    return json(request, { ok: true });
  }

  if (action === 'schedule.get') {
    const [{ data: hours, error }, { data: closures, error: closureError }] = await Promise.all([
      admin.from('weekly_hours').select('*').order('iso_day'),
      admin.from('closures').select('*').gte('closure_date', localDate()).eq('active', true).order('closure_date').limit(100),
    ]);
    if (error) throw error;
    if (closureError) throw closureError;
    return json(request, { hours: hours || [], closures: closures || [] });
  }

  if (action === 'schedule.hours-save') {
    assertRole(staff.role, 'admin');
    if (!Array.isArray(body.hours) || body.hours.length !== 7) throw new HttpError(400, 'All seven weekly schedules are required.', 'VALIDATION_ERROR');
    const rows = body.hours.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'A schedule row is invalid.', 'VALIDATION_ERROR');
      const row = value as Record<string, unknown>;
      return {
        iso_day: Math.floor(Number(row.isoDay)),
        day_name: requiredText(row.dayName, 'Day name', 20),
        open_time: requiredText(row.openTime, 'Opening time', 8),
        close_time: requiredText(row.closeTime, 'Closing time', 8),
        bookable: row.bookable === true,
        updated_by: staff.userId,
      };
    });
    const { error } = await admin.from('weekly_hours').upsert(rows, { onConflict: 'iso_day' });
    if (error) throw new HttpError(400, error.message, 'SCHEDULE_SAVE_FAILED');
    await writeAudit(admin, staff, 'weekly_hours_saved', 'weekly_hours', null, { rows: 7 });
    return json(request, { ok: true });
  }

  if (action === 'schedule.closure-save') {
    assertRole(staff.role, 'admin');
    const closureValue = body.closure;
    if (!closureValue || typeof closureValue !== 'object' || Array.isArray(closureValue)) throw new HttpError(400, 'Closure details are required.', 'VALIDATION_ERROR');
    const closure = closureValue as Record<string, unknown>;
    const id = text(closure.id, 50);
    const payload = {
      closure_date: requiredText(closure.date, 'Closure date', 10),
      starts_at: text(closure.startsAt, 8) || null,
      ends_at: text(closure.endsAt, 8) || null,
      reason: requiredText(closure.reason, 'Reason', 240),
      active: closure.active !== false,
      created_by: staff.userId,
    };
    const result = id
      ? await admin.from('closures').update(payload).eq('id', requireUuid(id, 'Closure')).select('id').single()
      : await admin.from('closures').insert(payload).select('id').single();
    if (result.error) throw new HttpError(400, result.error.message, 'CLOSURE_SAVE_FAILED');
    await writeAudit(admin, staff, 'closure_saved', 'closures', result.data.id, { date: payload.closure_date });
    return json(request, { id: result.data.id });
  }

  if (action === 'schedule.closure-delete') {
    assertRole(staff.role, 'admin');
    const id = requireUuid(body.closureId, 'Closure');
    const { error } = await admin.from('closures').update({ active: false }).eq('id', id);
    if (error) throw error;
    await writeAudit(admin, staff, 'closure_deactivated', 'closures', id, {});
    return json(request, { ok: true });
  }

  if (action === 'staff.list') {
    assertRole(staff.role, 'owner');
    const { data, error } = await admin.from('staff_roles').select('user_id,display_name,role,active,capabilities,created_at,updated_at').order('display_name');
    if (error) throw error;
    return json(request, { rows: data || [] });
  }

  if (action === 'staff.invite') {
    assertRole(staff.role, 'owner');
    const email = safeEmail(body.email);
    const displayName = requiredText(body.displayName, 'Display name', 120);
    const role = text(body.role, 20) as Role;
    if (!Object.hasOwn(ROLE_RANK, role)) throw new HttpError(400, 'Staff role is invalid.', 'VALIDATION_ERROR');
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { display_name: displayName }, redirectTo: `${appUrl()}?account=reset` });
    if (error || !data.user) throw new HttpError(400, error?.message || 'Staff invitation failed.', 'STAFF_INVITE_FAILED');
    const { error: roleError } = await admin.from('staff_roles').upsert({ user_id: data.user.id, display_name: displayName, role, active: true, created_by: staff.userId });
    if (roleError) throw roleError;
    await writeAudit(admin, staff, 'staff_invited', 'staff_roles', data.user.id, { role });
    return json(request, { userId: data.user.id }, 201);
  }

  if (action === 'staff.update') {
    assertRole(staff.role, 'owner');
    const userId = requireUuid(body.userId, 'Staff account');
    const role = text(body.role, 20) as Role;
    if (!Object.hasOwn(ROLE_RANK, role)) throw new HttpError(400, 'Staff role is invalid.', 'VALIDATION_ERROR');
    const active = body.active !== false;
    const { data: target, error: targetError } = await admin.from('staff_roles').select('role,active').eq('user_id', userId).single();
    if (targetError) throw targetError;
    if (target.role === 'owner' && target.active && (!active || role !== 'owner')) {
      const { count, error: countError } = await admin.from('staff_roles').select('user_id', { count: 'exact', head: true }).eq('role', 'owner').eq('active', true);
      if (countError) throw countError;
      if ((count || 0) <= 1) throw new HttpError(409, 'The final active owner cannot be demoted or deactivated.', 'LAST_OWNER');
    }
    const { error } = await admin.from('staff_roles').update({ role, active, capabilities: null, deactivated_at: active ? null : new Date().toISOString(), deactivated_by: active ? null : staff.userId }).eq('user_id', userId);
    if (error) throw error;
    await writeAudit(admin, staff, 'staff_role_changed', 'staff_roles', userId, { role, active });
    return json(request, { ok: true });
  }

  if (action === 'staff.password-reset') {
    assertRole(staff.role, 'owner');
    const email = safeEmail(body.email);
    const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl()}?account=reset` });
    if (error) throw new HttpError(400, error.message, 'PASSWORD_RESET_FAILED');
    await writeAudit(admin, staff, 'staff_password_reset_requested', 'staff_roles', null, { email_domain: email.split('@')[1] || '' });
    return json(request, { ok: true });
  }

  if (action === 'calendar.retry') {
    assertRole(staff.role, 'admin');
    const bookingId = requireUuid(body.bookingId, 'Booking');
    const { error } = await admin.from('calendar_sync_jobs').upsert({ booking_id: bookingId, operation: 'upsert', status: 'pending', next_attempt_at: new Date().toISOString(), last_error: null }, { onConflict: 'booking_id,operation' });
    if (error) throw error;
    await admin.from('bookings').update({ calendar_sync_status: 'pending', last_calendar_sync_error: null }).eq('id', bookingId);
    await writeAudit(admin, staff, 'calendar_sync_retried', 'bookings', bookingId, {});
    return json(request, { ok: true });
  }

  if (action === 'audit.list') {
    const page = pageValues(body);
    let query = admin.from('audit_log').select('id,actor_user_id,actor_display,action,target_type,target_id,created_at,metadata', { count: 'exact' });
    const search = searchTerm(body.search);
    if (search) query = query.or(`action.ilike.%${search}%,target_type.ilike.%${search}%,actor_display.ilike.%${search}%`);
    const { data, error, count } = await query.order('created_at', { ascending: false }).range(page.from, page.to);
    if (error) throw error;
    return json(request, { rows: data || [], page: page.page, pageSize: page.pageSize, total: count || 0 });
  }

  throw new HttpError(404, 'Unknown admin operation.', 'ACTION_NOT_FOUND');
}));

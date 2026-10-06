-- Integrity helpers, audited mutations, and atomic booking/quiz operations.

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger people_touch_updated_at before update on public.people
for each row execute function private.touch_updated_at();
create trigger staff_roles_touch_updated_at before update on public.staff_roles
for each row execute function private.touch_updated_at();
create trigger equipment_categories_touch_updated_at before update on public.equipment_categories
for each row execute function private.touch_updated_at();
create trigger certification_types_touch_updated_at before update on public.certification_types
for each row execute function private.touch_updated_at();
create trigger equipment_touch_updated_at before update on public.equipment
for each row execute function private.touch_updated_at();
create trigger closures_touch_updated_at before update on public.closures
for each row execute function private.touch_updated_at();
create trigger weekly_hours_touch_updated_at before update on public.weekly_hours
for each row execute function private.touch_updated_at();
create trigger membership_types_touch_updated_at before update on public.membership_types
for each row execute function private.touch_updated_at();
create trigger pricing_rules_touch_updated_at before update on public.pricing_rules
for each row execute function private.touch_updated_at();
create trigger quizzes_touch_updated_at before update on public.quizzes
for each row execute function private.touch_updated_at();
create trigger quiz_questions_touch_updated_at before update on public.quiz_questions
for each row execute function private.touch_updated_at();
create trigger quiz_options_touch_updated_at before update on public.quiz_question_options
for each row execute function private.touch_updated_at();
create trigger certifications_touch_updated_at before update on public.certifications
for each row execute function private.touch_updated_at();
create trigger bookings_touch_updated_at before update on public.bookings
for each row execute function private.touch_updated_at();
create trigger calendar_jobs_touch_updated_at before update on public.calendar_sync_jobs
for each row execute function private.touch_updated_at();
create trigger notification_jobs_touch_updated_at before update on public.notification_jobs
for each row execute function private.touch_updated_at();

create or replace function private.staff_role_rank(p_role public.staff_role)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'owner' then 40
    when 'admin' then 30
    when 'trainer' then 20
    when 'viewer' then 10
  end::smallint;
$$;

create or replace function private.current_staff_role(p_user_id uuid default auth.uid())
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select sr.role
  from public.staff_roles sr
  where sr.user_id = p_user_id and sr.active
  limit 1;
$$;

create or replace function private.has_staff_rank(p_minimum public.staff_role, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.staff_role_rank(private.current_staff_role(p_user_id)) >= private.staff_role_rank(p_minimum),
    false
  );
$$;

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target text;
begin
  target := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'user_id', to_jsonb(new)->>'iso_day',
                     to_jsonb(old)->>'id', to_jsonb(old)->>'user_id', to_jsonb(old)->>'iso_day');
  insert into public.audit_log(actor_user_id, action, target_type, target_id, metadata)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    target,
    jsonb_build_object('source', 'database_trigger')
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger people_audit after insert or update or delete on public.people
for each row execute function private.audit_row_change();
create trigger equipment_audit after insert or update or delete on public.equipment
for each row execute function private.audit_row_change();
create trigger certifications_audit after insert or update or delete on public.certifications
for each row execute function private.audit_row_change();
create trigger bookings_audit after insert or update or delete on public.bookings
for each row execute function private.audit_row_change();
create trigger closures_audit after insert or update or delete on public.closures
for each row execute function private.audit_row_change();
create trigger weekly_hours_audit after insert or update or delete on public.weekly_hours
for each row execute function private.audit_row_change();
create trigger quizzes_audit after insert or update or delete on public.quizzes
for each row execute function private.audit_row_change();
create trigger quiz_questions_audit after insert or update or delete on public.quiz_questions
for each row execute function private.audit_row_change();
create trigger quiz_options_audit after insert or update or delete on public.quiz_question_options
for each row execute function private.audit_row_change();

create or replace function private.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit entries are append-only.' using errcode = '42501';
end;
$$;

create trigger audit_log_immutable before update or delete on public.audit_log
for each row execute function private.reject_audit_mutation();

create or replace function private.validate_single_correct_option()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  question_id_to_check uuid;
  correct_count integer;
  option_count integer;
begin
  if tg_table_name = 'quiz_questions' then
    question_id_to_check := coalesce(new.id, old.id);
  else
    question_id_to_check := coalesce(new.question_id, old.question_id);
  end if;

  if not exists (select 1 from public.quiz_questions q where q.id = question_id_to_check and q.active) then
    return coalesce(new, old);
  end if;

  select count(*), count(*) filter (where o.is_correct)
  into option_count, correct_count
  from public.quiz_question_options o
  where o.question_id = question_id_to_check;

  if option_count < 2 or correct_count <> 1 then
    raise exception 'Each active question must have at least two options and exactly one correct answer.'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create constraint trigger quiz_option_answer_count
after insert or update or delete on public.quiz_question_options
deferrable initially deferred
for each row execute function private.validate_single_correct_option();
create constraint trigger quiz_question_answer_count
after insert or update on public.quiz_questions
deferrable initially deferred
for each row execute function private.validate_single_correct_option();

create or replace function private.make_booking_reference()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'KEC-' || to_char(now() at time zone 'Asia/Kathmandu', 'YYYYMMDD') || '-' ||
         upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
$$;

create or replace function private.make_attempt_reference()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'QUIZ-' || to_char(now() at time zone 'Asia/Kathmandu', 'YYYYMMDD-HH24MISS') || '-' ||
         upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
$$;

create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_bucket private.rate_limit_buckets%rowtype;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate-limit configuration.';
  end if;

  insert into private.rate_limit_buckets(bucket_key, window_started_at, request_count)
  values (p_bucket_key, now(), 0)
  on conflict (bucket_key) do nothing;

  select * into current_bucket
  from private.rate_limit_buckets
  where bucket_key = p_bucket_key
  for update;

  if current_bucket.window_started_at + make_interval(secs => p_window_seconds) <= now() then
    update private.rate_limit_buckets
    set window_started_at = now(), request_count = 1, updated_at = now()
    where bucket_key = p_bucket_key;
    return true;
  end if;

  if current_bucket.request_count >= p_limit then return false; end if;

  update private.rate_limit_buckets
  set request_count = request_count + 1, updated_at = now()
  where bucket_key = p_bucket_key;
  return true;
end;
$$;

create or replace function public.get_public_availability(p_equipment_id uuid, p_local_date date)
returns table(starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.starts_at, b.ends_at
  from public.bookings b
  where b.equipment_id = p_equipment_id
    and b.status in ('confirmed', 'checked_in')
    and (b.starts_at at time zone 'Asia/Kathmandu')::date = p_local_date
  order by b.starts_at;
$$;

create or replace function public.create_verified_booking(
  p_verification_id uuid,
  p_identity_fingerprint text,
  p_equipment_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_contact_roll_number text,
  p_contact_organization text,
  p_purpose text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  verification public.identity_verifications%rowtype;
  person public.people%rowtype;
  machine public.equipment%rowtype;
  schedule public.weekly_hours%rowtype;
  booking_id uuid;
  reference text;
  manage_token text;
  local_start timestamp;
  local_end timestamp;
  closed_reason text;
  calendar_state public.sync_status;
begin
  select * into verification
  from public.identity_verifications v
  where v.id = p_verification_id
  for update;

  if verification.id is null or verification.expires_at <= now() or verification.consumed_at is not null
     or verification.result <> 'verified' or verification.identity_fingerprint <> p_identity_fingerprint then
    raise exception 'Identity verification has expired. Check your access again.' using errcode = '28000';
  end if;

  select * into person from public.people p where p.id = verification.person_id for share;
  if person.id is null or not person.active then raise exception 'This Makerspace access record is inactive.' using errcode = '28000'; end if;
  if not person.booking_privilege_active then raise exception 'Advance-booking access is currently suspended.' using errcode = '42501'; end if;
  if person.safety_training_status <> 'verified' or person.waiver_status <> 'verified' then
    raise exception 'Staff must verify your safety training and liability waiver before booking.' using errcode = '42501';
  end if;
  if person.minor_status <> 'adult' then
    raise exception 'Independent booking requires an adult-status check by staff. Minors may attend supervised events only.' using errcode = '42501';
  end if;

  select * into machine from public.equipment e where e.id = p_equipment_id for share;
  if machine.id is null or machine.status <> 'active' or not machine.booking_enabled then
    raise exception 'Selected equipment is not available for booking.' using errcode = '22023';
  end if;
  if person.category not in ('kec_student', 'kec_staff') and not machine.external_allowed then
    raise exception 'Selected equipment is not available for this user category.' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.equipment_certification_requirements requirement
    where requirement.equipment_id = machine.id
      and not exists (
        select 1 from public.certifications certification
        where certification.person_id = person.id
          and certification.certification_type_id = requirement.certification_type_id
          and certification.status = 'active'
      )
  ) then
    raise exception 'An active equipment certification is required.' using errcode = '42501';
  end if;

  if p_starts_at <= now() then raise exception 'Choose a future booking time.' using errcode = '22007'; end if;
  if p_starts_at >= p_ends_at then raise exception 'End time must be later than start time.' using errcode = '22007'; end if;
  if p_ends_at > p_starts_at + make_interval(mins => machine.max_booking_minutes) then
    raise exception 'This booking is longer than the equipment maximum.' using errcode = '22023';
  end if;

  local_start := p_starts_at at time zone 'Asia/Kathmandu';
  local_end := p_ends_at at time zone 'Asia/Kathmandu';
  if local_start::date <> local_end::date then raise exception 'A booking must start and end on the same local date.' using errcode = '22023'; end if;

  select * into schedule from public.weekly_hours h where h.iso_day = extract(isodow from local_start)::smallint;
  if schedule.iso_day is null or not schedule.bookable
     or local_start::time < schedule.open_time or local_end::time > schedule.close_time then
    raise exception 'The requested time is outside Makerspace opening hours.' using errcode = '22023';
  end if;

  select c.reason into closed_reason
  from public.closures c
  where c.active and c.closure_date = local_start::date
    and (c.starts_at is null or (local_start::time < c.ends_at and local_end::time > c.starts_at))
  limit 1;
  if closed_reason is not null then raise exception 'The Makerspace is closed: %', closed_reason using errcode = '22023'; end if;

  reference := private.make_booking_reference();
  manage_token := encode(extensions.gen_random_bytes(24), 'hex');
  calendar_state := case when machine.google_calendar_id is null then 'not_configured'::public.sync_status else 'pending'::public.sync_status end;

  insert into public.bookings(
    booking_reference, person_id, equipment_id, starts_at, ends_at,
    contact_name, contact_email, contact_phone, contact_roll_number,
    contact_organization, purpose, manage_token_hash, calendar_sync_status
  ) values (
    reference, person.id, machine.id, p_starts_at, p_ends_at,
    btrim(p_contact_name), lower(btrim(p_contact_email)), btrim(p_contact_phone), nullif(btrim(p_contact_roll_number), ''),
    nullif(btrim(p_contact_organization), ''), nullif(btrim(p_purpose), ''),
    encode(extensions.digest(manage_token, 'sha256'), 'hex'), calendar_state
  ) returning id into booking_id;

  update public.identity_verifications set consumed_at = now() where id = verification.id;

  if machine.google_calendar_id is not null then
    insert into public.calendar_sync_jobs(booking_id, operation) values (booking_id, 'upsert')
    on conflict (booking_id, operation) do update set status = 'pending', next_attempt_at = now(), last_error = null;
  end if;
  insert into public.notification_jobs(booking_id, notification_type) values (booking_id, 'booking_confirmed')
  on conflict (booking_id, notification_type) do nothing;

  insert into public.audit_log(actor_display, action, target_type, target_id, metadata)
  values ('public_booking', 'booking_created', 'bookings', booking_id::text, jsonb_build_object('booking_reference', reference));

  return jsonb_build_object(
    'bookingReference', reference,
    'manageToken', manage_token,
    'startsAt', p_starts_at,
    'endsAt', p_ends_at,
    'equipmentName', machine.display_name,
    'calendarSyncStatus', calendar_state,
    'notificationStatus', 'pending'
  );
end;
$$;

create or replace function public.cancel_public_booking(p_booking_reference text, p_manage_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  is_late boolean;
  has_calendar boolean;
begin
  select * into booking
  from public.bookings b
  where b.booking_reference = p_booking_reference
    and b.manage_token_hash = encode(extensions.digest(p_manage_token, 'sha256'), 'hex')
  for update;

  if booking.id is null then raise exception 'Booking reference or management token is invalid.' using errcode = '28000'; end if;
  if booking.status = 'cancelled' then return jsonb_build_object('lateCancellation', booking.late_cancellation); end if;
  if booking.status not in ('confirmed', 'checked_in') then raise exception 'This booking can no longer be cancelled.' using errcode = '22023'; end if;

  is_late := booking.starts_at < now() + interval '2 hours';
  update public.bookings
  set status = 'cancelled', cancelled_at = now(), late_cancellation = is_late,
      calendar_sync_status = case when calendar_event_id is null then calendar_sync_status else 'pending' end,
      notification_status = 'pending'
  where id = booking.id;

  select e.google_calendar_id is not null into has_calendar
  from public.equipment e where e.id = booking.equipment_id;
  if has_calendar then
    insert into public.calendar_sync_jobs(booking_id, operation) values (booking.id, 'cancel')
    on conflict (booking_id, operation) do update set status = 'pending', next_attempt_at = now(), last_error = null;
  end if;
  insert into public.notification_jobs(booking_id, notification_type) values (booking.id, 'booking_cancelled')
  on conflict (booking_id, notification_type) do update set status = 'pending', next_attempt_at = now(), last_error = null;

  insert into public.audit_log(actor_display, action, target_type, target_id, metadata)
  values ('public_booking', 'booking_cancelled', 'bookings', booking.id::text, jsonb_build_object('late_cancellation', is_late));
  return jsonb_build_object('lateCancellation', is_late);
end;
$$;

create or replace function public.grant_certification(
  p_person_id uuid,
  p_certification_type_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not private.has_staff_rank('admin') then raise exception 'Admin role required.' using errcode = '42501'; end if;
  insert into public.certifications(person_id, certification_type_id, status, issued_at, issued_by, source_kind, reason)
  values (p_person_id, p_certification_type_id, 'active', now(), auth.uid(), 'manual', nullif(btrim(p_reason), ''))
  returning id into new_id;
  insert into public.audit_log(actor_user_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'certification_granted', 'certifications', new_id::text, jsonb_build_object('person_id', p_person_id, 'certification_type_id', p_certification_type_id));
  return new_id;
end;
$$;

create or replace function public.set_certification_status(
  p_certification_id uuid,
  p_status public.certification_status,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_staff_rank('admin') then raise exception 'Admin role required.' using errcode = '42501'; end if;
  if p_status = 'active' then
    update public.certifications set status = 'active', suspended_at = null, suspended_by = null,
      revoked_at = null, revoked_by = null, reason = nullif(btrim(p_reason), '') where id = p_certification_id;
  elsif p_status = 'suspended' then
    update public.certifications set status = 'suspended', suspended_at = now(), suspended_by = auth.uid(),
      revoked_at = null, revoked_by = null, reason = nullif(btrim(p_reason), '') where id = p_certification_id;
  else
    update public.certifications set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
      reason = nullif(btrim(p_reason), '') where id = p_certification_id;
  end if;
  if not found then raise exception 'Certification not found.' using errcode = 'P0002'; end if;
  insert into public.audit_log(actor_user_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'certification_status_changed', 'certifications', p_certification_id::text, jsonb_build_object('status', p_status, 'reason', p_reason));
end;
$$;

create or replace function public.submit_quiz_attempt(p_token_hash text, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt public.quiz_attempts%rowtype;
  submitted_count integer;
  matched_count integer;
  calculated_score integer;
  certification_names text[];
begin
  if jsonb_typeof(p_answers) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ANSWERS', 'message', 'Answers must be an array.');
  end if;

  select * into attempt from public.quiz_attempts a where a.token_hash = p_token_hash for update;
  if attempt.id is null then return jsonb_build_object('ok', false, 'code', 'INVALID_TOKEN', 'message', 'Quiz session is missing or invalid.'); end if;
  if attempt.status = 'submitted' then return jsonb_build_object('ok', false, 'code', 'ALREADY_SUBMITTED', 'message', 'This quiz was already submitted.'); end if;
  if attempt.status <> 'started' then return jsonb_build_object('ok', false, 'code', 'NOT_ACTIVE', 'message', 'This quiz is no longer active.'); end if;
  if now() > attempt.expires_at then
    update public.quiz_attempts set status = 'expired' where id = attempt.id;
    insert into public.audit_log(actor_display, action, target_type, target_id, metadata)
    values ('quiz_participant', 'quiz_expired', 'quiz_attempts', attempt.id::text, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'code', 'EXPIRED', 'message', 'The 8-minute quiz window has expired.');
  end if;

  with submitted as (
    select distinct
      (item->>'questionId')::uuid as question_id,
      (item->>'optionId')::uuid as option_id
    from jsonb_array_elements(p_answers) item
  )
  select count(*) into submitted_count from submitted;

  if submitted_count <> attempt.max_score or submitted_count <> cardinality(attempt.question_order) then
    return jsonb_build_object('ok', false, 'code', 'INCOMPLETE', 'message', 'Every question must be answered exactly once.');
  end if;

  with submitted as (
    select distinct
      (item->>'questionId')::uuid as question_id,
      (item->>'optionId')::uuid as option_id
    from jsonb_array_elements(p_answers) item
  ), validated as (
    select submitted.question_id, submitted.option_id, option.is_correct
    from submitted
    join public.quiz_question_options option
      on option.id = submitted.option_id and option.question_id = submitted.question_id
    where submitted.question_id = any(attempt.question_order)
  )
  select count(*), count(*) filter (where is_correct)
  into matched_count, calculated_score
  from validated;

  if matched_count <> submitted_count then
    return jsonb_build_object('ok', false, 'code', 'INVALID_OPTION', 'message', 'One or more answers are not valid for this attempt.');
  end if;

  insert into public.quiz_attempt_answers(attempt_id, question_id, selected_option_id, was_correct)
  select attempt.id, submitted.question_id, submitted.option_id, option.is_correct
  from (
    select distinct (item->>'questionId')::uuid as question_id, (item->>'optionId')::uuid as option_id
    from jsonb_array_elements(p_answers) item
  ) submitted
  join public.quiz_question_options option on option.id = submitted.option_id and option.question_id = submitted.question_id;

  update public.quiz_attempts
  set status = 'submitted', submitted_at = now(), score = calculated_score,
      passed = calculated_score >= attempt.pass_mark, token_hash = p_token_hash
  where id = attempt.id;

  if calculated_score >= attempt.pass_mark then
    insert into public.certifications(
      person_id, certification_type_id, status, issued_at, issued_by,
      source_quiz_attempt_id, source_kind
    )
    select attempt.participant_id, mapping.certification_type_id, 'active', now(),
      attempt.trainer_user_id, attempt.id, 'quiz'
    from public.quiz_certification_mappings mapping
    where mapping.quiz_id = attempt.quiz_id
    on conflict (person_id, certification_type_id) where status = 'active' do nothing;
  end if;

  select coalesce(array_agg(cert_type.display_name order by cert_type.display_name), '{}'::text[])
  into certification_names
  from public.quiz_certification_mappings mapping
  join public.certification_types cert_type on cert_type.id = mapping.certification_type_id
  where mapping.quiz_id = attempt.quiz_id and calculated_score >= attempt.pass_mark;

  insert into public.audit_log(actor_user_id, actor_display, action, target_type, target_id, metadata)
  values (
    attempt.trainer_user_id, attempt.trainer_name_snapshot, 'quiz_submitted', 'quiz_attempts', attempt.id::text,
    jsonb_build_object('score', calculated_score, 'max_score', attempt.max_score, 'passed', calculated_score >= attempt.pass_mark)
  );

  return jsonb_build_object(
    'ok', true,
    'attemptReference', attempt.attempt_reference,
    'score', calculated_score,
    'maxScore', attempt.max_score,
    'passMark', attempt.pass_mark,
    'passed', calculated_score >= attempt.pass_mark,
    'certificationNames', to_jsonb(certification_names)
  );
end;
$$;

create or replace function public.create_staff_booking(
  p_person_id uuid,
  p_equipment_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_purpose text,
  p_after_hours_override boolean default false,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  person public.people%rowtype;
  machine public.equipment%rowtype;
  local_start timestamp;
  local_end timestamp;
  schedule public.weekly_hours%rowtype;
  reference text;
  new_id uuid;
  outside_hours boolean;
begin
  if not private.has_staff_rank('admin') then raise exception 'Admin role required.' using errcode = '42501'; end if;
  select * into person from public.people where id = p_person_id;
  select * into machine from public.equipment where id = p_equipment_id;
  if person.id is null or machine.id is null then raise exception 'Person or equipment not found.' using errcode = 'P0002'; end if;
  if not person.active or not person.booking_privilege_active then raise exception 'Person cannot hold an advance booking.' using errcode = '42501'; end if;
  if machine.status <> 'active' or not machine.booking_enabled then raise exception 'Equipment is not bookable.' using errcode = '22023'; end if;
  if p_starts_at >= p_ends_at or p_ends_at > p_starts_at + interval '6 hours' then raise exception 'Invalid booking duration.' using errcode = '22023'; end if;
  if exists (
    select 1 from public.equipment_certification_requirements r
    where r.equipment_id = machine.id and not exists (
      select 1 from public.certifications c where c.person_id = person.id and c.certification_type_id = r.certification_type_id and c.status = 'active'
    )
  ) then raise exception 'Person lacks the required active certification.' using errcode = '42501'; end if;

  local_start := p_starts_at at time zone 'Asia/Kathmandu';
  local_end := p_ends_at at time zone 'Asia/Kathmandu';
  if local_start::date <> local_end::date then raise exception 'Booking must stay within one local date.' using errcode = '22023'; end if;
  select * into schedule from public.weekly_hours where iso_day = extract(isodow from local_start)::smallint;
  outside_hours := schedule.iso_day is null or not schedule.bookable or local_start::time < schedule.open_time or local_end::time > schedule.close_time
    or exists (
      select 1 from public.closures c where c.active and c.closure_date = local_start::date
        and (c.starts_at is null or (local_start::time < c.ends_at and local_end::time > c.starts_at))
    );
  if outside_hours and not p_after_hours_override then raise exception 'Outside opening hours or during a closure; an audited override is required.' using errcode = '22023'; end if;
  if outside_hours and (p_override_reason is null or char_length(btrim(p_override_reason)) < 3) then raise exception 'Override reason is required.' using errcode = '22023'; end if;

  reference := private.make_booking_reference();
  insert into public.bookings(
    booking_reference, person_id, equipment_id, starts_at, ends_at,
    contact_name, contact_email, contact_phone, contact_roll_number, contact_organization,
    purpose, requested_by, after_hours_override, override_reason, override_by,
    calendar_sync_status, manage_token_hash
  ) values (
    reference, person.id, machine.id, p_starts_at, p_ends_at,
    person.full_name, person.email, coalesce(person.phone, 'Not recorded'), person.roll_number, person.organization,
    nullif(btrim(p_purpose), ''), auth.uid(), outside_hours, case when outside_hours then btrim(p_override_reason) end,
    case when outside_hours then auth.uid() end,
    case when machine.google_calendar_id is null then 'not_configured' else 'pending' end,
    encode(extensions.digest(encode(extensions.gen_random_bytes(24), 'hex'), 'sha256'), 'hex')
  ) returning id into new_id;
  if machine.google_calendar_id is not null then insert into public.calendar_sync_jobs(booking_id, operation) values (new_id, 'upsert'); end if;
  insert into public.notification_jobs(booking_id, notification_type) values (new_id, 'booking_confirmed');
  return jsonb_build_object('bookingReference', reference, 'bookingId', new_id);
end;
$$;

create or replace function public.set_booking_status(
  p_booking_id uuid,
  p_status public.booking_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  calendar_configured boolean;
begin
  if not private.has_staff_rank('admin') then raise exception 'Admin role required.' using errcode = '42501'; end if;
  select * into booking from public.bookings where id = p_booking_id for update;
  if booking.id is null then raise exception 'Booking not found.' using errcode = 'P0002'; end if;
  if p_status = 'cancelled' then
    update public.bookings set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), cancelled_by = auth.uid(),
      late_cancellation = starts_at < now() + interval '2 hours', admin_notes = nullif(btrim(p_reason), '') where id = p_booking_id;
    select e.google_calendar_id is not null into calendar_configured from public.equipment e where e.id = booking.equipment_id;
    if calendar_configured then
      insert into public.calendar_sync_jobs(booking_id, operation) values (booking.id, 'cancel')
      on conflict (booking_id, operation) do update set status = 'pending', next_attempt_at = now(), last_error = null;
    end if;
  elsif p_status = 'checked_in' then
    update public.bookings set status = p_status, checked_in_at = now(), cancelled_at = null where id = p_booking_id;
  elsif p_status = 'completed' then
    update public.bookings set status = p_status, completed_at = now(), cancelled_at = null where id = p_booking_id;
  elsif p_status = 'no_show' then
    if now() < booking.starts_at + interval '15 minutes' then raise exception 'No-show can be recorded only 15 minutes after the slot starts.' using errcode = '22023'; end if;
    update public.bookings set status = p_status, no_show_at = now(), cancelled_at = null where id = p_booking_id;
  else
    update public.bookings set status = p_status, cancelled_at = null where id = p_booking_id;
  end if;
  insert into public.audit_log(actor_user_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'booking_status_changed', 'bookings', p_booking_id::text, jsonb_build_object('status', p_status, 'reason', p_reason));
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public;
revoke all on function public.get_public_availability(uuid, date) from public;
revoke all on function public.create_verified_booking(uuid, text, uuid, timestamptz, timestamptz, text, text, text, text, text, text) from public;
revoke all on function public.cancel_public_booking(text, text) from public;
revoke all on function public.submit_quiz_attempt(text, jsonb) from public;

grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
grant execute on function public.get_public_availability(uuid, date) to service_role;
grant execute on function public.create_verified_booking(uuid, text, uuid, timestamptz, timestamptz, text, text, text, text, text, text) to service_role;
grant execute on function public.cancel_public_booking(text, text) to service_role;
grant execute on function public.submit_quiz_attempt(text, jsonb) to service_role;
grant execute on function public.grant_certification(uuid, uuid, text) to authenticated;
grant execute on function public.set_certification_status(uuid, public.certification_status, text) to authenticated;
grant execute on function public.create_staff_booking(uuid, uuid, timestamptz, timestamptz, text, boolean, text) to authenticated;
grant execute on function public.set_booking_status(uuid, public.booking_status, text) to authenticated;
grant execute on function private.current_staff_role(uuid) to authenticated;
grant execute on function private.has_staff_rank(public.staff_role, uuid) to authenticated;

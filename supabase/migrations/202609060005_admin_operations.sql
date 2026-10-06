-- Transactional operations used by the authenticated admin Edge Function.

create or replace function public.admin_save_equipment(p_actor uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  equipment_id uuid;
  requirement jsonb;
  status_value public.equipment_status;
begin
  if not private.has_staff_rank('admin', p_actor) then raise exception 'Admin role required.' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'Equipment payload must be an object.' using errcode = '22023'; end if;
  if coalesce(p_payload->>'displayName', '') = '' or coalesce(p_payload->>'slug', '') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Equipment name or slug is invalid.' using errcode = '22023';
  end if;
  status_value := coalesce(p_payload->>'status', 'active')::public.equipment_status;
  equipment_id := nullif(p_payload->>'id', '')::uuid;

  if equipment_id is null then
    insert into public.equipment(
      slug, display_name, category_id, status, booking_enabled, external_allowed,
      max_booking_minutes, google_calendar_id, notes
    ) values (
      p_payload->>'slug', btrim(p_payload->>'displayName'), (p_payload->>'categoryId')::uuid,
      status_value, coalesce((p_payload->>'bookingEnabled')::boolean, true),
      coalesce((p_payload->>'externalAllowed')::boolean, false),
      coalesce((p_payload->>'maxMinutes')::smallint, 360),
      nullif(btrim(p_payload->>'calendarId'), ''), nullif(btrim(p_payload->>'notes'), '')
    ) returning id into equipment_id;
  else
    update public.equipment set
      slug = p_payload->>'slug', display_name = btrim(p_payload->>'displayName'),
      category_id = (p_payload->>'categoryId')::uuid, status = status_value,
      booking_enabled = coalesce((p_payload->>'bookingEnabled')::boolean, true),
      external_allowed = coalesce((p_payload->>'externalAllowed')::boolean, false),
      max_booking_minutes = coalesce((p_payload->>'maxMinutes')::smallint, 360),
      google_calendar_id = nullif(btrim(p_payload->>'calendarId'), ''),
      notes = nullif(btrim(p_payload->>'notes'), '')
    where id = equipment_id;
    if not found then raise exception 'Equipment not found.' using errcode = 'P0002'; end if;
  end if;

  delete from public.equipment_certification_requirements where equipment_certification_requirements.equipment_id = equipment_id;
  if jsonb_typeof(p_payload->'certificationTypeIds') = 'array' then
    for requirement in select value from jsonb_array_elements(p_payload->'certificationTypeIds') loop
      insert into public.equipment_certification_requirements(equipment_id, certification_type_id)
      values (equipment_id, trim(both '"' from requirement::text)::uuid);
    end loop;
  end if;

  insert into public.audit_log(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor, 'equipment_saved', 'equipment', equipment_id::text,
    jsonb_build_object('status', status_value, 'booking_enabled', p_payload->'bookingEnabled'));
  return equipment_id;
end;
$$;

create or replace function public.admin_replace_quiz(p_actor uuid, p_quiz_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  question jsonb;
  option_value jsonb;
  question_number integer := 0;
  option_number integer;
  question_id uuid;
  expected_count integer;
  pass_mark_value integer;
  active_value boolean;
begin
  if not private.has_staff_rank('admin', p_actor) then raise exception 'Admin role required.' using errcode = '42501'; end if;
  if jsonb_typeof(p_payload->'questions') <> 'array' then raise exception 'Questions must be an array.' using errcode = '22023'; end if;
  expected_count := jsonb_array_length(p_payload->'questions');
  if expected_count < 1 or expected_count > 100 then raise exception 'Quiz must contain 1-100 questions.' using errcode = '22023'; end if;
  pass_mark_value := coalesce((p_payload->>'passMark')::integer, 16);
  if pass_mark_value < 1 or pass_mark_value > expected_count then raise exception 'Pass mark is invalid.' using errcode = '22023'; end if;
  active_value := coalesce((p_payload->>'active')::boolean, false);

  update public.quiz_attempts
  set status = 'expired'
  where quiz_id = p_quiz_id and status = 'started' and expires_at <= now();
  if exists (
    select 1 from public.quiz_attempts
    where quiz_id = p_quiz_id and status = 'started' and expires_at > now()
  ) then
    raise exception 'Wait for active quiz attempts to finish before replacing this quiz.' using errcode = '55006';
  end if;

  update public.quizzes set
    display_name = btrim(p_payload->>'displayName'),
    duration_minutes = coalesce((p_payload->>'durationMinutes')::smallint, 8),
    question_count = expected_count,
    pass_mark = pass_mark_value,
    active = false,
    version = version + 1,
    notes = nullif(btrim(p_payload->>'notes'), '')
  where id = p_quiz_id;
  if not found then raise exception 'Quiz not found.' using errcode = 'P0002'; end if;

  -- Keep previous questions and options as immutable attempt history. Only the
  -- newly inserted bank is active and served to new attempts.
  update public.quiz_questions set active = false where quiz_id = p_quiz_id and active;
  for question in select value from jsonb_array_elements(p_payload->'questions') loop
    question_number := question_number + 1;
    if char_length(btrim(question->>'prompt')) < 5 then raise exception 'Question % has no valid prompt.', question_number using errcode = '22023'; end if;
    if jsonb_typeof(question->'options') <> 'array' or jsonb_array_length(question->'options') < 2 then
      raise exception 'Question % needs at least two options.', question_number using errcode = '22023';
    end if;
    if (select count(*) from jsonb_array_elements(question->'options') o where coalesce((o->>'isCorrect')::boolean, false)) <> 1 then
      raise exception 'Question % must have exactly one correct option.', question_number using errcode = '22023';
    end if;

    insert into public.quiz_questions(id, quiz_id, prompt, position, active, legacy_question_id)
    values (gen_random_uuid(), p_quiz_id, btrim(question->>'prompt'), question_number, true, nullif(question->>'legacyQuestionId', ''))
    returning id into question_id;
    option_number := 0;
    for option_value in select value from jsonb_array_elements(question->'options') loop
      option_number := option_number + 1;
      insert into public.quiz_question_options(question_id, label, position, is_correct)
      values (question_id, btrim(option_value->>'label'), option_number, coalesce((option_value->>'isCorrect')::boolean, false));
    end loop;
  end loop;

  update public.quizzes set active = active_value where id = p_quiz_id;
  insert into public.audit_log(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor, 'quiz_replaced', 'quizzes', p_quiz_id::text,
    jsonb_build_object('question_count', expected_count, 'pass_mark', pass_mark_value, 'active', active_value));
end;
$$;

create or replace function public.admin_bulk_verify_compliance(p_actor uuid, p_person_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if not private.has_staff_rank('admin', p_actor) then raise exception 'Admin role required.' using errcode = '42501'; end if;
  if cardinality(p_person_ids) < 1 or cardinality(p_person_ids) > 500 then raise exception 'Choose 1-500 people.' using errcode = '22023'; end if;
  update public.people set
    safety_training_status = 'verified', waiver_status = 'verified',
    minor_status = 'adult', migration_review_required = false
  where id = any(p_person_ids);
  get diagnostics changed = row_count;
  insert into public.audit_log(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor, 'bulk_compliance_verified', 'people', null,
    jsonb_build_object('person_ids', to_jsonb(p_person_ids), 'changed', changed));
  return changed;
end;
$$;

revoke all on function public.admin_save_equipment(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_replace_quiz(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_bulk_verify_compliance(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.admin_save_equipment(uuid, jsonb) to service_role;
grant execute on function public.admin_replace_quiz(uuid, uuid, jsonb) to service_role;
grant execute on function public.admin_bulk_verify_compliance(uuid, uuid[]) to service_role;

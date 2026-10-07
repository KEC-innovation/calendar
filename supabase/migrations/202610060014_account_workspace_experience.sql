-- Additive account onboarding, role naming and security. Existing records are untouched.
alter table public.staff_roles drop constraint scoped_capabilities;
alter table public.staff_roles add constraint scoped_capabilities check
 (capabilities is null or (role in ('viewer','trainer','ambassador') and capabilities <@ array['training','access','subscriptions','catalog']::text[]));
alter table public.staff_roles drop constraint scoped_training_types;
alter table public.staff_roles add constraint scoped_training_types check
 (role in ('viewer','trainer','ambassador') or training_certification_type_ids is null);
create or replace function private.staff_role_rank(p_role public.staff_role) returns smallint
language sql immutable set search_path='' as $$
 select case p_role when 'owner' then 40 when 'admin' then 30 when 'trainer' then 20 when 'viewer' then 10 when 'ambassador' then 10 end::smallint;
$$;
-- All direct staff RPCs require an authenticated AAL2 session.
-- Trusted Edge RPCs use their already-verified actor ID, rather than an end-user JWT.
create or replace function private.current_staff_role(p_user_id uuid default auth.uid()) returns public.staff_role
language sql stable security definer set search_path='' as $$
 select sr.role from public.staff_roles sr where sr.user_id=p_user_id and sr.active and
 (p_user_id is distinct from auth.uid() or coalesce(auth.jwt()->>'aal','aal1')='aal2') limit 1;
$$;
create function public.complete_account_profile(p_user uuid,p_name text,p_category text,p_roll text,p_phone text,p_organization text)
returns uuid language plpgsql security definer set search_path='' as $$
declare mail text;pid uuid;
begin
 select lower(btrim(email)) into mail from auth.users where id=p_user and email_confirmed_at is not null;
 if mail is null then raise exception 'Confirm your email before completing registration.';end if;
 -- Serializes registration for an email, including retries and competing requests.
 perform pg_advisory_xact_lock(hashtextextended(mail,731));
 select id into pid from public.people where email_normalized=mail;
 if pid is not null then return public.link_person_account(p_user);end if;
 if p_category not in ('kec_student','kec_staff','other_college_student','business_external','member_non_kec','outreach_minor') or p_category is null then raise exception 'Choose a valid category.';end if;
 if length(btrim(p_name)) not between 2 and 120 or p_name is null or length(btrim(p_phone)) not between 1 and 40 or p_phone is null then raise exception 'Enter your name and phone.';end if;
 if p_category='kec_student' and coalesce(length(btrim(p_roll)),0)=0 then raise exception 'Enter your KEC roll number.';end if;
 if p_category in ('other_college_student','business_external') and coalesce(length(btrim(p_organization)),0)=0 then raise exception 'Enter your college or organization.';end if;
 if coalesce(length(p_roll),0)>80 or coalesce(length(p_organization),0)>160 then raise exception 'Profile details are too long.';end if;
 insert into public.people(email,full_name,category,roll_number,phone,organization,migration_review_required,
  safety_training_status,waiver_status,minor_status)
 values(mail,btrim(p_name),p_category::public.person_category,nullif(btrim(p_roll),''),btrim(p_phone),nullif(btrim(p_organization),''),true,'unknown','unknown','unknown') returning id into pid;
 perform public.link_person_account(p_user);
 insert into public.audit_log(actor_user_id,action,target_type,target_id,metadata)
 values(p_user,'self_registration_completed','people',pid::text,jsonb_build_object('prerequisites','staff_verification_required'));
 return pid;
end $$;
revoke all on function public.complete_account_profile(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.complete_account_profile(uuid,text,text,text,text,text) to service_role;
-- Owners archive business records; history cannot be erased through the app.
create function private.preserve_business_records() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Records must be archived by an Owner; permanent deletion is disabled to preserve audit history.' using errcode='42501';end $$;
revoke all on function private.preserve_business_records() from public,anon,authenticated;
do $$ declare t text;begin
 foreach t in array array['people','equipment','certifications','bookings','quiz_attempts','quiz_attempt_answers','manual_training_records','client_subscriptions','subscription_payments','staff_roles','training_sessions','material_catalog','closures','quizzes'] loop
 execute format('create trigger preserve_record before delete on public.%I for each row execute function private.preserve_business_records()',t);
 end loop;
end $$;
-- Direct authenticated admin RPCs cannot turn an existing record inactive.
-- The trusted service API enforces Owner identity and an archival reason separately.
create function private.owner_archival_only() returns trigger language plpgsql security definer set search_path='' as $$
declare removed boolean;
begin
 removed:=case when tg_table_name='equipment' then to_jsonb(old)->>'status'<>'inactive' and to_jsonb(new)->>'status'='inactive'
 else (to_jsonb(old)->>'active')::boolean and not (to_jsonb(new)->>'active')::boolean end;
 if removed and auth.uid() is not null and not private.has_staff_rank('owner') then
 raise exception 'Only an Owner can archive records.' using errcode='42501';end if;
 return new;
end $$;
revoke all on function private.owner_archival_only() from public,anon,authenticated;
do $$ declare t text;begin
 foreach t in array array['people','equipment','closures','material_catalog'] loop
 execute format('create trigger owner_archival before update on public.%I for each row execute function private.owner_archival_only()',t);
 end loop;
end $$;
create or replace function public.update_staff_access(
 p_actor uuid,p_user uuid,p_mode text,p_role public.staff_role default null,p_active boolean default null,
 p_capabilities text[] default null,p_training_type_ids uuid[] default null,p_reason text default null
) returns void language plpgsql security definer set search_path='' as $$
declare target public.staff_roles%rowtype; effective_caps text[];
begin
 lock table public.staff_roles in share row exclusive mode;
 if not private.has_staff_rank('owner',p_actor) then raise exception 'Owner permission required.' using errcode='42501'; end if;
 if p_mode not in ('role','responsibilities') or p_mode is null then raise exception 'Invalid staff update mode.'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 10 and 1000 then raise exception 'Include an access review note of 10–1000 characters.'; end if;
 select * into target from public.staff_roles where user_id=p_user for update;
 if target.user_id is null then raise exception 'Staff account not found.'; end if;
 if p_mode='role' then
  if p_role is null or p_active is null then raise exception 'Choose a role and active state.'; end if;
  if target.role='owner' and target.active and (p_role<>'owner' or not p_active) and
     (select count(*) from public.staff_roles where role='owner' and active)<=1 then
   raise exception 'The final active owner cannot be demoted or deactivated.' using errcode='42501';
  end if;
  -- A label/status change must not accidentally add or clear focused permissions.
  effective_caps:=coalesce(target.capabilities,case when target.role='trainer' then array['training'] else '{}'::text[] end);
  update public.staff_roles set role=p_role,active=p_active,
   capabilities=case when p_role in ('owner','admin') then null when target.role in ('owner','admin') then '{}'::text[] else effective_caps end,
   training_certification_type_ids=case when p_role in ('owner','admin') then null when target.role in ('owner','admin') then '{}'::uuid[] else target.training_certification_type_ids end,
   deactivated_at=case when p_active then null else now() end,
   deactivated_by=case when p_active then null else p_actor end where user_id=p_user;
 else
  if target.role not in ('viewer','trainer','ambassador') then raise exception 'Owner and Admin retain all operational controls; assign tasks to Staff, Trainers or MS Ambassadors.'; end if;
  if p_capabilities is null or not (p_capabilities <@ array['training','access','subscriptions','catalog']::text[]) or
     array_position(p_capabilities,null) is not null then raise exception 'Unknown capability.'; end if;
  if p_training_type_ids is not null and (array_position(p_training_type_ids,null) is not null or exists(
   select 1 from unnest(p_training_type_ids) as scope(type_id) where not exists(select 1 from public.certification_types t where t.id=scope.type_id and t.active))) then
   raise exception 'Choose active equipment certification types.';
  end if;
  if 'training'=any(p_capabilities) and p_training_type_ids is not null and cardinality(p_training_type_ids)=0 then
   raise exception 'Choose at least one training certification, or explicitly authorize all types.';
  end if;
  update public.staff_roles set capabilities=array(select distinct c from unnest(p_capabilities) c order by c),
   training_certification_type_ids=case when 'training'=any(p_capabilities) then p_training_type_ids else '{}'::uuid[] end
  where user_id=p_user;
 end if;
 insert into public.audit_log(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,case when p_mode='role' then 'staff_role_changed' else 'staff_responsibilities_updated' end,
  'staff_roles',p_user::text,jsonb_build_object('reason',btrim(p_reason),'previous_role',target.role,'previous_active',target.active,
    'previous_capabilities',target.capabilities,'previous_training_type_ids',target.training_certification_type_ids,
    'new_access',(select jsonb_build_object('role',role,'active',active,'capabilities',capabilities,'training_type_ids',training_certification_type_ids)
      from public.staff_roles where user_id=p_user)));
end $$;
revoke all on function public.update_staff_access(uuid,uuid,text,public.staff_role,boolean,text[],uuid[],text) from public,anon,authenticated;
grant execute on function public.update_staff_access(uuid,uuid,text,public.staff_role,boolean,text[],uuid[],text) to service_role;


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
  if p_payload->>'status'='inactive' and not private.has_staff_rank('owner',p_actor) then raise exception 'Only an Owner can archive equipment.' using errcode='42501';end if;
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
  if coalesce((p_payload->>'active')::boolean,false)=false and exists(select 1 from public.quizzes where id=p_quiz_id and active) and not private.has_staff_rank('owner',p_actor) then raise exception 'Only an Owner can archive quizzes.' using errcode='42501';end if;
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


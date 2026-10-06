-- Additive policy controls. Existing staff, certifications, bookings and calendar mappings are retained.
alter table public.staff_roles add column training_certification_type_ids uuid[];
comment on column public.staff_roles.training_certification_type_ids is
 'NULL preserves existing general training authority; an empty array grants no equipment training; IDs limit focused staff to those certification types. Admin and Owner retain all operational authority.';
alter table public.staff_roles add constraint scoped_training_types check
 (role in ('viewer','trainer') or training_certification_type_ids is null);

create function private.staff_can_train(p_user uuid,p_type uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select active and (role in ('owner','admin') or
  (private.staff_can(p_user,'training') and (training_certification_type_ids is null or p_type=any(training_certification_type_ids))))
 from public.staff_roles where user_id=p_user),false);
$$;
revoke all on function private.staff_can_train(uuid,uuid) from public,anon,authenticated;

-- Enforce QR authority at the database boundary as well as in the API.
create function private.validate_training_authority() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not private.staff_can_train(new.trainer_user_id,new.certification_type_id) then
  raise exception 'Training permission required for this equipment certification.' using errcode='42501';
 end if;
 if not exists(select 1 from public.certification_types where id=new.certification_type_id and active) or
    not exists(select 1 from public.quizzes q join public.quiz_certification_mappings m on m.quiz_id=q.id
      where q.id=new.quiz_id and q.active and q.version=new.quiz_version and m.certification_type_id=new.certification_type_id) then
  raise exception 'Choose an active quiz mapped to this certification.';
 end if;
 return new;
end $$;
revoke all on function private.validate_training_authority() from public,anon,authenticated;
create trigger training_session_authority before insert or update of trainer_user_id,certification_type_id,quiz_id,quiz_version
 on public.training_sessions for each row execute function private.validate_training_authority();

-- Serialize owner changes so concurrent requests cannot remove the final active owner.
-- This RPC is callable only by trusted Edge Functions, which supply the authenticated actor ID.
create function public.update_staff_access(
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
  if target.role not in ('viewer','trainer') then raise exception 'Owner and Admin retain all operational controls; assign tasks to focused staff or trainers.'; end if;
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

create or replace function public.start_training_session_attempt(p_user uuid,p_session_hash text,p_attempt_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.training_sessions%rowtype; q public.quizzes%rowtype; p public.people%rowtype;
 pid uuid; aid uuid; qo uuid[]; oo jsonb; used integer;
begin
 pid:=public.link_person_account(p_user);
 select * into s from public.training_sessions where token_hash=p_session_hash for update;
 if s.id is null or s.revoked_at is not null or s.expires_at<=now() then raise exception 'This training QR has expired or was closed by the trainer.'; end if;
 if not private.staff_can_train(s.trainer_user_id,s.certification_type_id) then raise exception 'The trainer no longer has training permission.'; end if;
 select * into p from public.people where id=pid for share;
 if not p.active or p.category='outreach_minor' or p.minor_status<>'adult' or p.safety_training_status<>'verified' or p.waiver_status<>'verified' then
 raise exception 'Ask an access officer to verify your one-time safety, waiver and adult records before this assessment.'; end if;
 select * into q from public.quizzes where id=s.quiz_id and active for share;
 if q.id is null or q.version<>s.quiz_version then raise exception 'Quiz changed. Ask your trainer for a new QR.'; end if;
 if not exists(select 1 from public.quiz_certification_mappings where quiz_id=q.id and certification_type_id=s.certification_type_id) then raise exception 'Certification mapping changed.'; end if;
 if exists(select 1 from public.certifications where person_id=pid and certification_type_id=s.certification_type_id) then
 raise exception 'This equipment already has a certification record. Existing passes remain valid; suspensions need an access officer review.'; end if;
 if exists(select 1 from public.quiz_attempts where training_session_id=s.id and participant_id=pid) then raise exception 'You already joined this session. Resume your saved attempt or ask the trainer for a new session.'; end if;
 select count(*) into used from public.quiz_attempts where training_session_id=s.id;
 if used>=s.capacity then raise exception 'This training session is full.'; end if;
 select array_agg(id order by r) into qo from (select id,random() r from public.quiz_questions where quiz_id=q.id and active) x;
 if cardinality(qo)<>q.question_count or exists(select 1 from public.quiz_questions a left join public.quiz_question_options b on b.question_id=a.id where a.id=any(qo) group by a.id having count(b.id)<2 or count(*) filter(where b.is_correct)<>1) then raise exception 'The answer bank needs staff attention.'; end if;
 select jsonb_object_agg(question_id,ids) into oo from (select question_id,jsonb_agg(id order by random()) ids from public.quiz_question_options where question_id=any(qo) group by question_id) x;
 insert into public.quiz_attempts(attempt_reference,token_hash,quiz_id,quiz_version,participant_id,trainer_user_id,trainer_name_snapshot,expires_at,max_score,pass_mark,question_order,option_order,training_session_id,account_user_id,authorized_certification_type_id)
 values(private.make_attempt_reference(),p_attempt_hash,q.id,q.version,pid,s.trainer_user_id,s.trainer_name,now()+make_interval(mins=>q.duration_minutes),q.question_count,q.pass_mark,qo,oo,s.id,p_user,s.certification_type_id) returning id into aid;
 return aid;
end $$;

create or replace function public.record_manual_training(p_actor uuid,p_person uuid,p_type uuid,p_date date,p_trainer text,p_evidence text,p_outcome text)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if not private.staff_can_train(p_actor,p_type) then raise exception 'Training permission required for this equipment certification.' using errcode='42501'; end if;
 if p_date>current_date or p_date is null or length(btrim(p_trainer))<2 then raise exception 'Enter a valid training date and trainer.'; end if;
 perform 1 from public.people where id=p_person and active for update;
 if not found then raise exception 'Active person not found.'; end if;
 if not exists(select 1 from public.certification_types where id=p_type and active) then raise exception 'Active certification type required.'; end if;
 insert into public.manual_training_records(person_id,certification_type_id,trained_on,trainer_name,evidence,outcome,recorded_by)
 values(p_person,p_type,p_date,p_trainer,p_evidence,p_outcome,p_actor) returning id into rid;
 if p_outcome='passed' then
 if exists(select 1 from public.certifications where person_id=p_person and certification_type_id=p_type and status<>'active') then raise exception 'Suspended or revoked certification needs an access officer review.'; end if;
 insert into public.certifications(person_id,certification_type_id,status,issued_at,issued_by,source_kind,reason)
 values(p_person,p_type,'active',p_date::timestamptz,p_actor,'manual',p_evidence)
 on conflict(person_id,certification_type_id) where status='active' do nothing;
 end if;
 insert into public.audit_log(actor_user_id,action,target_type,target_id,metadata) values(p_actor,'manual_training_recorded','manual_training_records',rid::text,jsonb_build_object('outcome',p_outcome,'evidence',p_evidence));
 return rid;
end $$;


-- Preserve scored attempts, but do not issue a new certificate after the trainer loses authority.
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
  if (select version from public.quizzes where id=attempt.quiz_id) <> attempt.quiz_version then return jsonb_build_object('ok',false,'code','VERSION_CHANGED','message','Quiz changed; ask the trainer for a new attempt.'); end if;
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

  perform 1 from public.people where id=attempt.participant_id for update;
  if calculated_score >= attempt.pass_mark then
    insert into public.certifications(
      person_id, certification_type_id, status, issued_at, issued_by,
      source_quiz_attempt_id, source_kind
    )
    select attempt.participant_id, mapping.certification_type_id, 'active', now(),
      attempt.trainer_user_id, attempt.id, 'quiz'
    from public.quiz_certification_mappings mapping
    where mapping.quiz_id = attempt.quiz_id
      and (attempt.authorized_certification_type_id is null or mapping.certification_type_id=attempt.authorized_certification_type_id)
      and (attempt.training_session_id is null or private.staff_can_train(attempt.trainer_user_id,mapping.certification_type_id))
      and not exists(select 1 from public.certifications c where c.person_id=attempt.participant_id and c.certification_type_id=mapping.certification_type_id and c.status in ('suspended','revoked'))
    on conflict (person_id, certification_type_id) where status = 'active' do nothing;
  end if;

  select coalesce(array_agg(cert_type.display_name order by cert_type.display_name), '{}'::text[])
  into certification_names
  from public.quiz_certification_mappings mapping
  join public.certification_types cert_type on cert_type.id = mapping.certification_type_id
  where mapping.quiz_id = attempt.quiz_id and calculated_score >= attempt.pass_mark
    and (attempt.authorized_certification_type_id is null or mapping.certification_type_id=attempt.authorized_certification_type_id)
    and exists(select 1 from public.certifications c where c.person_id=attempt.participant_id and c.certification_type_id=mapping.certification_type_id and c.status='active');

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

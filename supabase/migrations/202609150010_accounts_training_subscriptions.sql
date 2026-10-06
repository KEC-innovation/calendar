-- Additive upgrade: no imported people, passes or compliance decisions are reset.
alter table public.staff_roles add column capabilities text[];
alter table public.staff_roles add constraint scoped_capabilities check (
 capabilities is null or (role in ('viewer','trainer') and capabilities <@ array['training','access','subscriptions','catalog']::text[]));
create function private.staff_can(p_user uuid, p_cap text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select active and (role in ('owner','admin') or
 p_cap=any(coalesce(capabilities, case when role='trainer' then array['training'] else '{}'::text[] end)))
 from public.staff_roles where user_id=p_user),false);
$$;
revoke all on function private.staff_can(uuid,text) from public,anon,authenticated;

create table public.person_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 person_id uuid not null unique references public.people(id) on delete restrict,
 created_at timestamptz not null default now());
create table public.account_security (
 user_id uuid primary key references auth.users(id) on delete cascade,
 password_change_required boolean not null default false,
 temporary_expires_at timestamptz,
 updated_at timestamptz not null default now());
create table public.training_sessions (
 id uuid primary key default gen_random_uuid(), token_hash text not null unique,
 quiz_id uuid not null references public.quizzes(id), quiz_version integer not null,
 certification_type_id uuid not null references public.certification_types(id),
 trainer_user_id uuid not null references auth.users(id), trainer_name text not null,
 expires_at timestamptz not null, revoked_at timestamptz,
 capacity integer not null check(capacity between 1 and 200),
 created_at timestamptz not null default now(), check(expires_at>created_at));
alter table public.quiz_attempts add column training_session_id uuid references public.training_sessions(id);
alter table public.quiz_attempts add column account_user_id uuid references auth.users(id);
alter table public.quiz_attempts add column authorized_certification_type_id uuid references public.certification_types(id);
create unique index one_attempt_per_training_session on public.quiz_attempts(training_session_id,participant_id) where training_session_id is not null;
create table public.manual_training_records (
 id uuid primary key default gen_random_uuid(), person_id uuid not null references public.people(id),
 certification_type_id uuid not null references public.certification_types(id),
 trained_on date not null, trainer_name text not null, evidence text not null check(length(btrim(evidence))>=10),
 outcome text not null check(outcome in ('passed','attended','not_passed')),
 recorded_by uuid not null references auth.users(id), created_at timestamptz not null default now());
create table public.subscription_plans (
 id uuid primary key default gen_random_uuid(), name text not null,
 pricing_tier text not null check(pricing_tier in ('external','kec_alumni','external_student','plus_2')),
 monthly_npr numeric(12,2) not null check(monthly_npr>=0), minimum_months integer not null default 3 check(minimum_months>=3),
 certification_type_ids uuid[] not null check(cardinality(certification_type_ids)>0), active boolean not null default true);
create table public.client_subscriptions (
 id uuid primary key default gen_random_uuid(), person_id uuid not null references public.people(id),
 plan_id uuid not null references public.subscription_plans(id),
 starts_on date not null, ends_on date not null,
 agreed_total_npr numeric(12,2) not null check(agreed_total_npr>=0),
 status text not null default 'active' check(status in ('active','cancelled')),
 note text not null, recorded_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 check(ends_on>starts_on));
create table public.subscription_payments (
 id uuid primary key default gen_random_uuid(), subscription_id uuid not null references public.client_subscriptions(id),
 amount_npr numeric(12,2) not null check(amount_npr>0), receipt_reference text not null unique,
 paid_on date not null, recorded_by uuid not null references auth.users(id), created_at timestamptz not null default now());
create table public.material_catalog (
 id uuid primary key default gen_random_uuid(), name text not null,
 kind text not null check(kind in ('filament','material','electronics')),
 unit text not null, stock_quantity numeric(12,3) not null default 0 check(stock_quantity>=0),
 market_price_npr numeric(12,2) not null check(market_price_npr>=0),
 description text not null default '', active boolean not null default true,
 updated_at timestamptz not null default now());

-- Private by default; all new endpoints authenticate and project permitted fields.
do $$ declare t text; begin
 foreach t in array array['person_accounts','account_security','training_sessions','manual_training_records','subscription_plans','client_subscriptions','subscription_payments','material_catalog'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public, anon, authenticated',t);
 execute format('grant select,insert,update,delete on public.%I to service_role',t);
 if t not in ('account_security','person_accounts') then
 execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row_change()',t||'_audit',t);
 end if;
 end loop;
 -- Edge APIs are the staff read boundary. Scoped staff cannot bypass UI restrictions with REST.
 for t in select tablename from pg_tables where schemaname='public' and tablename<>'staff_roles' loop
 execute format('revoke select on public.%I from authenticated',t);
 end loop;
end $$;
drop policy staff_roles_self_or_staff_read on public.staff_roles;
create policy staff_roles_self_or_staff_read on public.staff_roles for select to authenticated
 using(user_id=auth.uid() or private.has_staff_rank('owner'));

create function public.link_person_account(p_user uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare linked_person uuid; mail text;
begin
 select lower(btrim(email)) into mail from auth.users where id=p_user and email_confirmed_at is not null;
 if mail is null then raise exception 'Confirm your email before continuing.'; end if;
 select p.id into linked_person from public.people p where p.email_normalized=mail;
 if linked_person is null then raise exception 'Ask the desk to add your Makerspace record using this email. Existing trainees should use the email on their training record.'; end if;
 insert into public.person_accounts(user_id,person_id) values(p_user,linked_person)
 on conflict(user_id) do nothing;
 if not exists(select 1 from public.person_accounts a where a.user_id=p_user and a.person_id=linked_person) then
 raise exception 'The account email no longer matches its Makerspace record. Contact staff.'; end if;
 return linked_person;
end $$;

create function public.start_training_session_attempt(p_user uuid,p_session_hash text,p_attempt_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.training_sessions%rowtype; q public.quizzes%rowtype; p public.people%rowtype;
 pid uuid; aid uuid; qo uuid[]; oo jsonb; used integer;
begin
 pid:=public.link_person_account(p_user);
 select * into s from public.training_sessions where token_hash=p_session_hash for update;
 if s.id is null or s.revoked_at is not null or s.expires_at<=now() then raise exception 'This training QR has expired or was closed by the trainer.'; end if;
 if not private.staff_can(s.trainer_user_id,'training') then raise exception 'The trainer no longer has training permission.'; end if;
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

create function public.record_manual_training(p_actor uuid,p_person uuid,p_type uuid,p_date date,p_trainer text,p_evidence text,p_outcome text)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if not private.staff_can(p_actor,'training') then raise exception 'Training permission required.'; end if;
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

create function private.validate_subscription() returns trigger language plpgsql set search_path='' as $$
declare minimum integer;
begin
 select minimum_months into minimum from public.subscription_plans where id=new.plan_id and active;
 if minimum is null or new.ends_on<(new.starts_on+make_interval(months=>minimum))::date then raise exception 'Subscriptions require at least three calendar months (or the plan minimum). End date is exclusive.'; end if;
 return new;
end $$;
create trigger subscription_term before insert or update on public.client_subscriptions for each row execute function private.validate_subscription();

create function public.book_for_account(p_user uuid,p_equipment uuid,p_start timestamptz,p_end timestamptz,p_purpose text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pid uuid; p public.people%rowtype; vid uuid; result jsonb;
begin
 pid:=public.link_person_account(p_user);
 select * into p from public.people where id=pid for update;
 if p.category='outreach_minor' then raise exception 'Outreach records cannot receive independent bookings.'; end if;
 insert into public.identity_verifications(person_id,category,identity_fingerprint,result,expires_at)
 values(pid,p.category,'account:'||p_user::text,'verified',now()+interval '1 minute') returning id into vid;
 result:=public.create_verified_booking(vid,'account:'||p_user::text,p_equipment,p_start,p_end,p.full_name,p.email::text,coalesce(p.phone,''),p.roll_number,p.organization,p_purpose);
 update public.bookings set requested_by=p_user where booking_reference=result->>'bookingReference';
 return result;
end $$;
create function public.cancel_for_account(p_user uuid,p_booking uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pid uuid; b public.bookings%rowtype; token text;
begin
 pid:=public.link_person_account(p_user);
 select * into b from public.bookings where id=p_booking and person_id=pid for update;
 if b.id is null then raise exception 'Booking not found in your account.'; end if;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 update public.bookings set manage_token_hash=encode(extensions.digest(token,'sha256'),'hex') where id=b.id;
 return public.cancel_public_booking(b.booking_reference,token);
end $$;

-- Only trusted Edge Functions supply verified user/actor IDs.
revoke all on function public.link_person_account(uuid),public.start_training_session_attempt(uuid,text,text),public.record_manual_training(uuid,uuid,uuid,date,text,text,text),public.book_for_account(uuid,uuid,timestamptz,timestamptz,text),public.cancel_for_account(uuid,uuid) from public,anon,authenticated;
grant execute on function public.link_person_account(uuid),public.start_training_session_attempt(uuid,text,text),public.record_manual_training(uuid,uuid,uuid,date,text,text,text),public.book_for_account(uuid,uuid,timestamptz,timestamptz,text),public.cancel_for_account(uuid,uuid) to service_role;

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


create function public.add_client_subscription(p_actor uuid,p_person uuid,p_plan uuid,p_start date,p_months integer,p_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare plan public.subscription_plans%rowtype; sid uuid;
begin
 if not private.staff_can(p_actor,'subscriptions') then raise exception 'Subscription permission required.'; end if;
 select * into plan from public.subscription_plans where id=p_plan and active for share;
 if plan.id is null or p_months<plan.minimum_months or p_months>36 then raise exception 'Invalid subscription term.'; end if;
 insert into public.client_subscriptions(person_id,plan_id,starts_on,ends_on,agreed_total_npr,note,recorded_by)
 values(p_person,plan.id,p_start,(p_start+make_interval(months=>p_months))::date,plan.monthly_npr*p_months,p_note,p_actor) returning id into sid;
 insert into public.audit_log(actor_user_id,action,target_type,target_id,metadata) values(p_actor,'subscription_started','client_subscriptions',sid::text,jsonb_build_object('months',p_months));
 return sid;
end $$;
revoke all on function public.add_client_subscription(uuid,uuid,uuid,date,integer,text) from public,anon,authenticated;
grant execute on function public.add_client_subscription(uuid,uuid,uuid,date,integer,text) to service_role;
-- Snapshot Policy Book v1.1 rates. No people or paid memberships are inferred.
insert into public.subscription_plans(name,pricing_tier,monthly_npr,certification_type_ids)
select c.display_name||' · '||v.tier,v.tier,v.price,array[c.id]
from public.certification_types c join (values
 ('laser-cutting','external',1200),('laser-cutting','kec_alumni',1020),('laser-cutting','external_student',960),('laser-cutting','plus_2',840),
 ('3d-printing','external',1000),('3d-printing','kec_alumni',850),('3d-printing','external_student',800),('3d-printing','plus_2',700),
 ('electronics-workstation','external',1000),('electronics-workstation','kec_alumni',850),('electronics-workstation','external_student',800),('electronics-workstation','plus_2',700)
) v(slug,tier,price) on c.slug=v.slug;
insert into public.subscription_plans(name,pricing_tier,monthly_npr,certification_type_ids)
select v.name||' · '||v.tier,v.tier,v.price,array(select id from public.certification_types where slug in ('laser-cutting','3d-printing','electronics-workstation') or (v.scanner and slug='3d-scanning'))
from (values
('All equipment without scanner','external',4500,false),('All equipment without scanner','kec_alumni',3825,false),('All equipment without scanner','external_student',3600,false),('All equipment without scanner','plus_2',3150,false),
('All equipment with scanner','external',5000,true),('All equipment with scanner','kec_alumni',4250,true),('All equipment with scanner','external_student',4000,true),('All equipment with scanner','plus_2',3500,true)
) v(name,tier,price,scanner);

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
  perform 1 from public.people where id=(select person_id from public.certifications where id=p_certification_id) for update;
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


create function private.on_account_password_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.encrypted_password is distinct from old.encrypted_password then
 update public.account_security set password_change_required=false,temporary_expires_at=null,updated_at=now() where user_id=new.id;
 end if;
 return new;
end $$;
revoke all on function private.on_account_password_changed() from public,anon,authenticated;
create trigger kec_password_changed after update of encrypted_password on auth.users for each row execute function private.on_account_password_changed();

-- Correct a legacy variable/column ambiguity exposed by the real database booking tests.
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
  new_booking_id uuid;
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
  ) returning id into new_booking_id;

  update public.identity_verifications set consumed_at = now() where id = verification.id;

  if machine.google_calendar_id is not null then
    insert into public.calendar_sync_jobs(booking_id, operation) values (new_booking_id, 'upsert')
    on conflict (booking_id, operation) do update set status = 'pending', next_attempt_at = now(), last_error = null;
  end if;
  insert into public.notification_jobs(booking_id, notification_type) values (new_booking_id, 'booking_confirmed')
  on conflict (booking_id, notification_type) do nothing;

  insert into public.audit_log(actor_display, action, target_type, target_id, metadata)
  values ('public_booking', 'booking_created', 'bookings', new_booking_id::text, jsonb_build_object('booking_reference', reference));

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


-- Record verification evidence in the same transaction as the state change.
create function public.verify_person_records(p_actor uuid,p_person uuid,p_safety public.compliance_status,p_waiver public.compliance_status,p_age public.minor_status,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.staff_can(p_actor,'access') then raise exception 'Access permission required.'; end if;
 if length(btrim(p_reason))<10 then raise exception 'A meaningful evidence note is required.'; end if;
 update public.people set safety_training_status=p_safety,waiver_status=p_waiver,minor_status=p_age,
 migration_review_required=not(p_safety='verified' and p_waiver='verified' and p_age='adult') where id=p_person;
 if not found then raise exception 'Person not found.'; end if;
 insert into public.audit_log(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'compliance_evidence_recorded','people',p_person::text,jsonb_build_object('safety',p_safety,'waiver',p_waiver,'age',p_age,'reason',p_reason));
end $$;
revoke all on function public.verify_person_records(uuid,uuid,public.compliance_status,public.compliance_status,public.minor_status,text) from public,anon,authenticated;
grant execute on function public.verify_person_records(uuid,uuid,public.compliance_status,public.compliance_status,public.minor_status,text) to service_role;

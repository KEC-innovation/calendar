-- Additive training preferences and assigned appointments. No certificates issued here.
alter table public.training_requests
 add column preferred_date date,
 add column preferred_start time,
 add column preferred_end time,
 add column scheduled_end_at timestamptz,
 add column assigned_trainer_id uuid references public.staff_roles(user_id),
 add column alternate_time_confirmed_at timestamptz,
 add constraint training_preference_window check (
  (preferred_date is null and preferred_start is null and preferred_end is null) or
  (preferred_date is not null and preferred_start is not null and preferred_end is not null and preferred_end > preferred_start)),
 add constraint training_appointment_window check (scheduled_end_at is null or scheduled_end_at > scheduled_at);
create index training_assigned_schedule on public.training_requests(assigned_trainer_id,scheduled_at)
 where status='scheduled';
alter table public.training_sessions add column display_name text not null default '' check(length(display_name)<=120);

create function public.request_training_with_preference(
 p_user uuid,p_type uuid,p_phone text,p_date date,p_start time,p_end time,p_availability text,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if p_date is null or p_start is null or p_end is null or p_end<=p_start then
  raise exception 'Choose a preferred date and a valid start/end time window.';
 end if;
 if (p_date+p_start) at time zone 'Asia/Kathmandu'<=now() then raise exception 'Choose a future preferred training time.';end if;
 rid:=public.request_account_training(p_user,p_type,p_phone,
  to_char(p_date,'YYYY-MM-DD')||' '||left(p_start::text,5)||'–'||left(p_end::text,5)||' Nepal. '||coalesce(p_availability,''),p_note);
 update public.training_requests set preferred_date=p_date,preferred_start=p_start,preferred_end=p_end where id=rid;
 return rid;
end $$;

create function public.update_training_appointment(
 p_actor uuid,p_request uuid,p_status text,p_start timestamptz,p_end timestamptz,
 p_trainer uuid,p_note text,p_contact_confirmed boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare r public.training_requests%rowtype;broad boolean;alternate boolean:=false;
begin
 select * into r from public.training_requests where id=p_request for update;
 if r.id is null then raise exception 'Training request not found.';end if;
 if not private.staff_can_train(p_actor,r.certification_type_id) then raise exception 'This request is outside your assigned training authority.' using errcode='42501';end if;
 broad:=private.has_staff_rank('admin',p_actor);
 if not broad and (p_status<>'completed' or r.assigned_trainer_id is distinct from p_actor) then
  raise exception 'Admins schedule requests. Assigned trainers can complete their own sessions.' using errcode='42501';
 end if;
 if p_status='scheduled' then
  if p_start is null or p_end is null or p_end<=p_start or p_start<=now() then raise exception 'Choose a future session with an end after its start.';end if;
  if p_trainer is null or not private.staff_can_train(p_trainer,r.certification_type_id) then
   raise exception 'Assign an active trainer authorized for this equipment.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trainer::text,918));
  if exists(select 1 from public.training_requests other where other.id<>r.id and other.status='scheduled'
   and other.assigned_trainer_id=p_trainer and other.scheduled_at<p_end
   and coalesce(other.scheduled_end_at,other.scheduled_at+interval '1 hour')>p_start
   and not (other.scheduled_at=p_start and other.scheduled_end_at=p_end and other.certification_type_id=r.certification_type_id)) then
   raise exception 'This trainer already has an overlapping session. Use a different time or trainer.';
  end if;
  alternate:=(r.preferred_date is not null and (p_start<(r.preferred_date+r.preferred_start) at time zone 'Asia/Kathmandu'
    or p_end>(r.preferred_date+r.preferred_end) at time zone 'Asia/Kathmandu'))
   or (r.status='scheduled' and (r.scheduled_at is distinct from p_start or r.scheduled_end_at is distinct from p_end));
  if alternate and p_contact_confirmed is not true then raise exception 'Contact the participant and confirm the changed time before accepting it.';end if;
 end if;
 if p_status='completed' and coalesce(r.scheduled_end_at,r.scheduled_at)>now() then raise exception 'Complete the session after its scheduled end.';end if;
 perform public.update_training_request(p_actor,p_request,p_status,p_start,p_note);
 update public.training_requests set
  scheduled_end_at=case when p_status='scheduled' then p_end when p_status='completed' then r.scheduled_end_at else null end,
  assigned_trainer_id=case when p_status='scheduled' then p_trainer when p_status='completed' then r.assigned_trainer_id else null end,
  alternate_time_confirmed_at=case when alternate then now() else r.alternate_time_confirmed_at end
 where id=r.id;
 insert into public.audit_log(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'training_appointment_updated','training_requests',r.id::text,
  jsonb_build_object('status',p_status,'starts_at',p_start,'ends_at',p_end,'trainer_user_id',p_trainer,
   'alternate_time_confirmed',alternate,'note',btrim(p_note)));
end $$;

create function public.list_training_request_queue(
 p_actor uuid,p_search text default '',p_audience text default 'all',p_status text default 'open',
 p_type uuid default null,p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare broad boolean;result jsonb;allowed_types uuid[];
begin
 if not private.staff_can(p_actor,'training') then raise exception 'Training permission required.' using errcode='42501';end if;
 broad:=private.has_staff_rank('admin',p_actor);
 select coalesce(array_agg(id),array[]::uuid[]) into allowed_types from public.certification_types where private.staff_can_train(p_actor,id);
 if p_audience not in ('all','external','kec') or p_status not in ('all','open','pending','scheduled','completed','cancelled')
  or p_audience is null or p_status is null or p_page is null or p_page<1 or p_page>10000 or length(coalesce(p_search,''))>100 then
  raise exception 'Choose valid training request filters.';
 end if;
 with filtered as (
  select r.*,p.full_name,p.email,p.category,p.organization,s.display_name trainer_name
  from public.training_requests r join public.people p on p.id=r.person_id
  left join public.staff_roles s on s.user_id=r.assigned_trainer_id
  where r.certification_type_id=any(allowed_types)
   and (broad or (r.status in ('scheduled','completed') and r.assigned_trainer_id=p_actor))
   and (p_type is null or r.certification_type_id=p_type)
   and (p_status='all' or (p_status='open' and r.status in ('pending','scheduled')) or r.status=p_status)
   and (p_audience='all' or (p_audience='kec' and p.category in ('kec_student','kec_staff'))
    or (p_audience='external' and p.category in ('other_college_student','business_external','member_non_kec')))
   and (coalesce(btrim(p_search),'')='' or position(lower(btrim(p_search)) in lower(p.full_name||' '||p.email||' '||r.contact_phone||' '||coalesce(p.organization,'')))>0)
 ), page_rows as (
  select * from filtered order by case when status='scheduled' then scheduled_at end asc nulls last,created_at desc,id
  limit 50 offset (p_page-1)*50
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(
  (to_jsonb(r)-'full_name'-'email'-'category'-'organization'-'trainer_name')||
  jsonb_build_object('people',jsonb_build_object('full_name',r.full_name,'email',r.email,'category',r.category,'organization',r.organization),
   'assigned_trainer',case when r.trainer_name is null then null else jsonb_build_object('display_name',r.trainer_name) end,
   'certification_types',jsonb_build_object('display_name',t.display_name)))
  from page_rows r join public.certification_types t on t.id=r.certification_type_id),'[]'::jsonb),
  'total',(select count(*) from filtered),'page',p_page,'pageSize',50) into result;
 return result;
end $$;

revoke all on function public.request_training_with_preference(uuid,uuid,text,date,time,time,text,text) from public,anon,authenticated;
revoke all on function public.update_training_appointment(uuid,uuid,text,timestamptz,timestamptz,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.list_training_request_queue(uuid,text,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.request_training_with_preference(uuid,uuid,text,date,time,time,text,text) to service_role;
grant execute on function public.update_training_appointment(uuid,uuid,text,timestamptz,timestamptz,uuid,text,boolean) to service_role;
grant execute on function public.list_training_request_queue(uuid,text,text,text,uuid,integer) to service_role;

-- Search the retained attempt history without downloading the directory or answers.
create function public.search_training_attempts(p_actor uuid,p_search text default '',p_result text default 'all',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.has_staff_rank('admin',p_actor) then raise exception 'Admin permission required.' using errcode='42501';end if;
 if p_page is null or p_page<1 or p_page>10000 or length(coalesce(p_search,''))>100 or p_result is null or p_result not in ('all','started','passed','failed','expired') then raise exception 'Choose valid attempt filters.';end if;
 with filtered as (
  select a.id,a.attempt_reference,a.status,a.started_at,a.score,a.max_score,a.passed,a.trainer_name_snapshot,
   p.full_name,p.email,q.display_name quiz_name
  from public.quiz_attempts a join public.people p on p.id=a.participant_id join public.quizzes q on q.id=a.quiz_id
  where (p_result='all' or (p_result='passed' and a.passed=true) or (p_result='failed' and a.status='submitted' and a.passed=false) or a.status::text=p_result)
   and (coalesce(btrim(p_search),'')='' or position(lower(btrim(p_search)) in lower(concat_ws(' ',a.attempt_reference,p.full_name,p.email,q.display_name,a.trainer_name_snapshot)))>0)
 ), page_rows as (select * from filtered order by started_at desc,id limit 50 offset (p_page-1)*50)
 select jsonb_build_object('rows',coalesce((select jsonb_agg((to_jsonb(r)-'full_name'-'email'-'quiz_name')||jsonb_build_object('people',jsonb_build_object('full_name',full_name,'email',email),'quizzes',jsonb_build_object('display_name',quiz_name))) from page_rows r),'[]'::jsonb),'total',(select count(*) from filtered),'pageSize',50) into result;
 return result;
end $$;
revoke all on function public.search_training_attempts(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.search_training_attempts(uuid,text,text,integer) to service_role;

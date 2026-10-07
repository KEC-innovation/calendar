-- Registration -> training request -> staff scheduling. No certificates are issued here.
create table public.training_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),person_id uuid not null references public.people(id),
 certification_type_id uuid not null references public.certification_types(id),
 contact_phone text not null check(length(btrim(contact_phone)) between 7 and 40),
 availability text not null check(length(btrim(availability)) between 10 and 1000),
 student_note text not null default '' check(length(student_note)<=1000),
 status text not null default 'pending' check(status in ('pending','scheduled','completed','cancelled')),
 scheduled_at timestamptz,staff_note text not null default '',handled_by uuid references auth.users(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(status<>'scheduled' or scheduled_at is not null)
);
create unique index one_open_training_request on public.training_requests(user_id,certification_type_id)
 where status in ('pending','scheduled');
create index training_request_queue on public.training_requests(status,certification_type_id,created_at);
alter table public.training_requests enable row level security;
revoke all on public.training_requests from public,anon,authenticated;
grant select,insert,update on public.training_requests to service_role;
create trigger training_request_audit after insert or update on public.training_requests
 for each row execute function private.audit_row_change();
create trigger training_request_preserve before delete on public.training_requests
 for each row execute function private.preserve_business_records();
create function public.request_account_training(p_user uuid,p_type uuid,p_phone text,p_availability text,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare pid uuid;rid uuid;p public.people%rowtype;
begin
 pid:=public.link_person_account(p_user);
 select * into p from public.people where id=pid for share;
 if not p.active then raise exception 'Your Makerspace record is inactive. Ask the help desk.';end if;
 if p.category='outreach_minor' or p.minor_status='minor' then raise exception 'Contact the help desk for supervised outreach training.';end if;
 if not exists(select 1 from public.certification_types where id=p_type and active) then raise exception 'Choose an available equipment training type.';end if;
 if coalesce(length(btrim(p_phone)),0) not between 7 and 40 or coalesce(length(btrim(p_availability)),0) not between 10 and 1000 or coalesce(length(p_note),0)>1000 then raise exception 'Enter your contact number and preferred availability.';end if;
 insert into public.training_requests(user_id,person_id,certification_type_id,contact_phone,availability,student_note)
 values(p_user,pid,p_type,btrim(p_phone),btrim(p_availability),coalesce(btrim(p_note),'')) returning id into rid;
 insert into public.audit_log(actor_user_id,action,target_type,target_id,metadata)
 values(p_user,'training_requested','training_requests',rid::text,jsonb_build_object('certification_type_id',p_type));
 return rid;
exception when unique_violation then raise exception 'You already have an open request for this training. Check its status below.';
end $$;
create function public.update_training_request(p_actor uuid,p_request uuid,p_status text,p_scheduled timestamptz,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.training_requests%rowtype;
begin
 select * into r from public.training_requests where id=p_request for update;
 if r.id is null then raise exception 'Training request not found.';end if;
 if not private.staff_can_train(p_actor,r.certification_type_id) then raise exception 'This request is outside your assigned training authority.' using errcode='42501';end if;
 if p_status not in ('pending','scheduled','completed','cancelled') or p_status is null then raise exception 'Choose a valid request state.';end if;
 if r.status in ('completed','cancelled') then raise exception 'Closed requests remain in history. Ask the student to submit a new request.';end if;
 if coalesce(length(btrim(p_note)),0) not between 10 and 1000 then raise exception 'Enter session instructions or a meaningful staff note.';end if;
 if p_status='scheduled' and (p_scheduled is null or p_scheduled<=now()) then raise exception 'Choose a future session time.';end if;
 if p_status='completed' and (r.status<>'scheduled' or r.scheduled_at>now()) then raise exception 'Complete the scheduled session after its start time.';end if;
 update public.training_requests set status=p_status,scheduled_at=case when p_status='scheduled' then p_scheduled when p_status='completed' then r.scheduled_at else null end,
  staff_note=btrim(p_note),handled_by=p_actor,updated_at=now() where id=r.id;
 insert into public.audit_log(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'training_request_updated','training_requests',r.id::text,jsonb_build_object('status',p_status,'scheduled_at',p_scheduled,'note',btrim(p_note)));
end $$;
create function public.cancel_account_training_request(p_user uuid,p_request uuid)
returns void language plpgsql security definer set search_path='' as $$
declare pid uuid;
begin
 pid:=public.link_person_account(p_user);
 update public.training_requests set status='cancelled',updated_at=now(),staff_note=staff_note
 where id=p_request and user_id=p_user and person_id=pid and status in ('pending','scheduled');
 if not found then raise exception 'You can cancel only your own open training requests.' using errcode='42501';end if;
 insert into public.audit_log(actor_user_id,action,target_type,target_id,metadata)
 values(p_user,'own_training_request_cancelled','training_requests',p_request::text,'{}');
end $$;
revoke all on function public.request_account_training(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.update_training_request(uuid,uuid,text,timestamptz,text) from public,anon,authenticated;
revoke all on function public.cancel_account_training_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_account_training(uuid,uuid,text,text,text) to service_role;
grant execute on function public.update_training_request(uuid,uuid,text,timestamptz,text) to service_role;
grant execute on function public.cancel_account_training_request(uuid,uuid) to service_role;

-- Additive upgrade. Does not rewrite people, certifications or booking times.
create or replace function public.claim_calendar_sync_jobs(p_limit integer default 20)
returns setof public.calendar_sync_jobs
language sql security definer set search_path = '' as $$
  update public.calendar_sync_jobs job
  set status = 'processing', locked_at = now(), attempt_count = least(job.attempt_count::integer + 1, 32767)::smallint
  from (
    select j.id from public.calendar_sync_jobs j
    where (j.status in ('pending', 'failed', 'not_configured') and j.next_attempt_at <= now()
      or j.status = 'processing' and j.locked_at < now() - interval '10 minutes')
    and not exists (
      select 1 from public.calendar_sync_jobs active
      where active.booking_id = j.booking_id and active.status = 'processing'
        and active.locked_at >= now() - interval '10 minutes'
    )
    and j.id = (
      select first_job.id from public.calendar_sync_jobs first_job
      where first_job.booking_id = j.booking_id
        and (first_job.status in ('pending','failed','not_configured') and first_job.next_attempt_at <= now()
          or first_job.status = 'processing' and first_job.locked_at < now() - interval '10 minutes')
      order by first_job.next_attempt_at, first_job.created_at, first_job.id limit 1
    )
    order by j.next_attempt_at, j.created_at, j.id
    for update of j skip locked
    limit least(greatest(p_limit, 1), 50)
  ) candidate
  where job.id = candidate.id returning job.*;
$$;
revoke all on function public.claim_calendar_sync_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_calendar_sync_jobs(integer) to service_role;

create or replace function private.enqueue_calendar_booking()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.equipment e where e.id=new.equipment_id and nullif(btrim(e.google_calendar_id),'') is not null) then
    insert into public.calendar_sync_jobs(booking_id,operation) values(new.id,'upsert')
    on conflict(booking_id,operation) do update
      set status='pending', next_attempt_at=now(), last_error=null, locked_at=null, completed_at=null;
    update public.bookings set calendar_sync_status='pending',last_calendar_sync_error=null where id=new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.enqueue_calendar_booking() from public, anon, authenticated;
create trigger bookings_queue_calendar_changes
  after insert or update of status,starts_at,ends_at,contact_name on public.bookings
  for each row execute function private.enqueue_calendar_booking();

-- Older bookings without a job are included once. Existing event IDs are retained.
insert into public.calendar_sync_jobs(booking_id,operation)
select b.id,'upsert' from public.bookings b join public.equipment e on e.id=b.equipment_id
where nullif(btrim(e.google_calendar_id),'') is not null
  and (b.calendar_event_id is not null or b.ends_at>=now())
on conflict(booking_id,operation) do update
  set status='pending',next_attempt_at=now(),last_error=null,locked_at=null,completed_at=null;

-- Mapping an equipment record for the first time picks up future existing bookings.
create or replace function private.enqueue_new_calendar_mapping()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if nullif(btrim(old.google_calendar_id),'') is null and nullif(btrim(new.google_calendar_id),'') is not null then
    insert into public.calendar_sync_jobs(booking_id,operation)
    select b.id,'upsert' from public.bookings b where b.equipment_id=new.id and b.ends_at>=now()
    on conflict(booking_id,operation) do update
      set status='pending',next_attempt_at=now(),last_error=null,locked_at=null,completed_at=null;
    update public.bookings set calendar_sync_status='pending',last_calendar_sync_error=null
      where equipment_id=new.id and ends_at>=now();
  end if;
  return new;
end;
$$;
revoke all on function private.enqueue_new_calendar_mapping() from public, anon, authenticated;
create trigger equipment_queue_new_calendar_mapping
  after update of google_calendar_id on public.equipment
  for each row execute function private.enqueue_new_calendar_mapping();

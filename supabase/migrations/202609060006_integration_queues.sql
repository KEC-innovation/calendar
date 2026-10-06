create or replace function public.claim_calendar_sync_jobs(p_limit integer default 20)
returns setof public.calendar_sync_jobs
language sql
security definer
set search_path = ''
as $$
  update public.calendar_sync_jobs job
  set status = 'processing', locked_at = now(), attempt_count = job.attempt_count + 1
  from (
    select id from public.calendar_sync_jobs
    where status in ('pending', 'failed') and next_attempt_at <= now()
    order by next_attempt_at, created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 50)
  ) candidate
  where job.id = candidate.id
  returning job.*;
$$;

create or replace function public.claim_notification_jobs(p_limit integer default 20)
returns setof public.notification_jobs
language sql
security definer
set search_path = ''
as $$
  update public.notification_jobs job
  set status = 'processing', attempt_count = job.attempt_count + 1
  from (
    select id from public.notification_jobs
    where status in ('pending', 'failed') and next_attempt_at <= now()
    order by next_attempt_at, created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 50)
  ) candidate
  where job.id = candidate.id
  returning job.*;
$$;

revoke all on function public.claim_calendar_sync_jobs(integer) from public, anon, authenticated;
revoke all on function public.claim_notification_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_calendar_sync_jobs(integer) to service_role;
grant execute on function public.claim_notification_jobs(integer) to service_role;

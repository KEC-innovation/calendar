-- Policy alignment, part 1: staff booking safeguards and category-derived ranks.
-- Does not reimport people or change safety/waiver/age/certification evidence.
-- Priority values are descriptive until a request-allocation workflow exists.

create or replace function private.apply_people_policy_priority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.priority_rank := case
    when new.category in ('kec_student', 'kec_staff') then 10
    when new.category = 'member_non_kec' then 20
    else 30
  end;
  return new;
end;
$$;

revoke all on function private.apply_people_policy_priority() from public, anon, authenticated;

create trigger people_policy_priority
before insert or update of category, priority_rank on public.people
for each row execute function private.apply_people_policy_priority();

update public.people
set priority_rank = case
  when category in ('kec_student', 'kec_staff') then 10
  when category = 'member_non_kec' then 20
  else 30
end
where priority_rank is distinct from case
  when category in ('kec_student', 'kec_staff') then 10
  when category = 'member_non_kec' then 20
  else 30
end;

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
  select * into person from public.people where id = p_person_id for share;
  select * into machine from public.equipment where id = p_equipment_id for share;
  if person.id is null or machine.id is null then raise exception 'Person or equipment not found.' using errcode = 'P0002'; end if;
  if not person.active or not person.booking_privilege_active then raise exception 'Person cannot hold an advance booking.' using errcode = '42501'; end if;
  if person.safety_training_status <> 'verified' or person.waiver_status <> 'verified' then
    raise exception 'Verified safety training and liability waiver are required, including for staff-created bookings.' using errcode = '42501';
  end if;
  if person.minor_status <> 'adult' or person.category = 'outreach_minor' then
    raise exception 'Minors may attend supervised events only; independent equipment bookings require verified adult status.' using errcode = '42501';
  end if;
  if person.category not in ('kec_student', 'kec_staff') and not machine.external_allowed then
    raise exception 'Selected equipment is not available for this user category.' using errcode = '42501';
  end if;
  if p_starts_at is null or p_ends_at is null or p_starts_at <= now() then
    raise exception 'Choose a future booking time with a start and end.' using errcode = '22007';
  end if;
  if machine.status <> 'active' or not machine.booking_enabled then raise exception 'Equipment is not bookable.' using errcode = '22023'; end if;
  if p_starts_at >= p_ends_at or p_ends_at > p_starts_at + make_interval(mins => machine.max_booking_minutes) then raise exception 'Invalid booking duration.' using errcode = '22023'; end if;
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
    case when machine.google_calendar_id is null then 'not_configured'::public.sync_status else 'pending'::public.sync_status end,
    encode(extensions.digest(encode(extensions.gen_random_bytes(24), 'hex'), 'sha256'), 'hex')
  ) returning id into new_id;
  if machine.google_calendar_id is not null then insert into public.calendar_sync_jobs(booking_id, operation) values (new_id, 'upsert'); end if;
  insert into public.notification_jobs(booking_id, notification_type) values (new_id, 'booking_confirmed');
  return jsonb_build_object('bookingReference', reference, 'bookingId', new_id);
end;
$$;

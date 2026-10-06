-- KEC Makerspace core schema. The database is the operational source of truth.
create schema if not exists extensions;
create schema if not exists private;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;

create type public.person_category as enum (
  'kec_student',
  'kec_staff',
  'other_college_student',
  'business_external',
  'member_non_kec',
  'outreach_minor'
);
create type public.staff_role as enum ('owner', 'admin', 'trainer', 'viewer');
create type public.compliance_status as enum ('unknown', 'pending', 'verified', 'revoked');
create type public.minor_status as enum ('unknown', 'adult', 'minor');
create type public.equipment_status as enum ('active', 'out_of_service', 'inactive');
create type public.certification_status as enum ('active', 'suspended', 'revoked');
create type public.booking_status as enum ('confirmed', 'checked_in', 'completed', 'cancelled', 'no_show');
create type public.quiz_attempt_status as enum ('started', 'submitted', 'expired', 'invalidated');
create type public.sync_status as enum ('pending', 'processing', 'synced', 'failed', 'not_configured');
create type public.notification_status as enum ('pending', 'processing', 'sent', 'failed', 'not_configured');

create table public.people (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null,
  email_normalized text generated always as (lower(btrim(email::text))) stored,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  roll_number text,
  phone text,
  category public.person_category not null,
  organization text,
  active boolean not null default true,
  booking_privilege_active boolean not null default true,
  safety_training_status public.compliance_status not null default 'unknown',
  waiver_status public.compliance_status not null default 'unknown',
  minor_status public.minor_status not null default 'unknown',
  migration_review_required boolean not null default false,
  priority_rank smallint not null default 30 check (priority_rank between 1 and 100),
  legacy_source_key text unique,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint people_email_unique unique (email_normalized),
  constraint people_email_shape check (email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

create unique index people_roll_number_unique
  on public.people (lower(btrim(roll_number)))
  where roll_number is not null and btrim(roll_number) <> '' and category = 'kec_student';
create index people_name_search_idx on public.people using gin (to_tsvector('simple', full_name));
create index people_category_active_idx on public.people (category, active);
create index people_org_idx on public.people (lower(organization)) where organization is not null;

create table public.staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  role public.staff_role not null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  deactivated_by uuid references auth.users(id) on delete set null
);

create table public.equipment_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null unique,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.certification_types (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null unique,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null unique,
  category_id uuid not null references public.equipment_categories(id),
  status public.equipment_status not null default 'active',
  booking_enabled boolean not null default true,
  external_allowed boolean not null default false,
  max_booking_minutes smallint not null default 360 check (max_booking_minutes between 15 and 360),
  google_calendar_id text,
  notes text,
  legacy_name text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index equipment_available_idx on public.equipment (status, booking_enabled, category_id);

create table public.equipment_certification_requirements (
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  certification_type_id uuid not null references public.certification_types(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (equipment_id, certification_type_id)
);

create table public.weekly_hours (
  iso_day smallint primary key check (iso_day between 1 and 7),
  day_name text not null unique,
  open_time time not null,
  close_time time not null,
  bookable boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint weekly_hours_order check (open_time < close_time)
);

create table public.closures (
  id uuid primary key default gen_random_uuid(),
  closure_date date not null,
  starts_at time,
  ends_at time,
  reason text not null check (char_length(btrim(reason)) between 2 and 240),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint closure_time_pair check ((starts_at is null and ends_at is null) or (starts_at is not null and ends_at is not null and starts_at < ends_at))
);
create index closures_active_date_idx on public.closures (closure_date) where active;

create table public.membership_types (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null unique,
  minimum_months smallint,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  person_category public.person_category,
  membership_type_id uuid references public.membership_types(id) on delete cascade,
  equipment_category_id uuid references public.equipment_categories(id) on delete cascade,
  rule_name text not null,
  amount_npr numeric(12,2) check (amount_npr is null or amount_npr >= 0),
  unit text,
  active boolean not null default false,
  effective_from date,
  effective_to date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_period check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null unique,
  duration_minutes smallint not null default 8 check (duration_minutes between 1 and 60),
  question_count smallint not null default 20 check (question_count between 1 and 100),
  pass_mark smallint not null default 16 check (pass_mark > 0),
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quiz_pass_mark_valid check (pass_mark <= question_count)
);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  prompt text not null check (char_length(btrim(prompt)) between 5 and 1000),
  position smallint not null check (position between 1 and 100),
  active boolean not null default true,
  legacy_question_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index quiz_questions_active_position_idx
  on public.quiz_questions (quiz_id, position)
  where active;
create unique index quiz_questions_active_legacy_id_idx
  on public.quiz_questions (quiz_id, legacy_question_id)
  where active and legacy_question_id is not null;

create table public.quiz_question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 1000),
  position smallint not null check (position between 1 and 12),
  is_correct boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, position),
  unique (question_id, label)
);
create unique index quiz_one_correct_option_idx
  on public.quiz_question_options (question_id)
  where is_correct;

create table public.quiz_certification_mappings (
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  certification_type_id uuid not null references public.certification_types(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (quiz_id, certification_type_id)
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  attempt_reference text not null unique,
  token_hash text unique,
  quiz_id uuid not null references public.quizzes(id) on delete restrict,
  quiz_version integer not null,
  participant_id uuid not null references public.people(id) on delete restrict,
  trainer_user_id uuid references auth.users(id) on delete set null,
  trainer_name_snapshot text not null,
  status public.quiz_attempt_status not null default 'started',
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  score smallint,
  max_score smallint not null,
  pass_mark smallint not null,
  passed boolean,
  question_order uuid[] not null default '{}'::uuid[],
  option_order jsonb not null default '{}'::jsonb check (jsonb_typeof(option_order) = 'object'),
  legacy_source_key text unique,
  source_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(source_metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint attempt_expiry_after_start check (expires_at > started_at),
  constraint attempt_score_bounds check (score is null or (score >= 0 and score <= max_score)),
  constraint attempt_pass_mark_bounds check (pass_mark > 0 and pass_mark <= max_score)
);
create index quiz_attempts_status_expiry_idx on public.quiz_attempts (status, expires_at);
create index quiz_attempts_participant_idx on public.quiz_attempts (participant_id, started_at desc);
create index quiz_attempts_trainer_idx on public.quiz_attempts (trainer_user_id, started_at desc);

create table public.quiz_attempt_answers (
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  question_id uuid not null references public.quiz_questions(id) on delete restrict,
  selected_option_id uuid not null references public.quiz_question_options(id) on delete restrict,
  was_correct boolean not null,
  answered_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create table public.certifications (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete restrict,
  certification_type_id uuid not null references public.certification_types(id) on delete restrict,
  status public.certification_status not null default 'active',
  issued_at timestamptz,
  issued_by uuid references auth.users(id) on delete set null,
  source_quiz_attempt_id uuid references public.quiz_attempts(id) on delete set null,
  source_kind text not null default 'manual' check (source_kind in ('quiz', 'manual', 'legacy_training_result', 'legacy_permission')),
  suspended_at timestamptz,
  suspended_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  reason text,
  legacy_source_key text unique,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint certification_state_dates check (
    (status = 'active' and revoked_at is null and suspended_at is null)
    or (status = 'suspended' and suspended_at is not null and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);
create unique index certifications_one_active_idx
  on public.certifications (person_id, certification_type_id)
  where status = 'active';
create unique index certifications_attempt_once_idx
  on public.certifications (source_quiz_attempt_id, certification_type_id)
  where source_quiz_attempt_id is not null;
create index certifications_person_history_idx on public.certifications (person_id, created_at desc);

create table public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references public.people(id) on delete cascade,
  category public.person_category not null,
  identity_fingerprint text not null,
  result text not null check (result in ('verified', 'needs_staff_review', 'inactive')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index identity_verifications_expiry_idx on public.identity_verifications (expires_at);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_reference text not null unique,
  person_id uuid not null references public.people(id) on delete restrict,
  equipment_id uuid not null references public.equipment(id) on delete restrict,
  status public.booking_status not null default 'confirmed',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  booking_slot tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  contact_name text not null,
  contact_email extensions.citext not null,
  contact_phone text not null,
  contact_roll_number text,
  contact_organization text,
  purpose text check (purpose is null or char_length(purpose) <= 500),
  requested_by uuid references auth.users(id) on delete set null,
  after_hours_override boolean not null default false,
  override_reason text,
  override_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  late_cancellation boolean not null default false,
  checked_in_at timestamptz,
  completed_at timestamptz,
  no_show_at timestamptz,
  manage_token_hash text,
  calendar_event_id text,
  calendar_sync_status public.sync_status not null default 'pending',
  last_calendar_sync_error text,
  calendar_retry_count smallint not null default 0,
  notification_status public.notification_status not null default 'pending',
  legacy_booking_id text unique,
  legacy_authorization_result text,
  legacy_conflict_check text,
  admin_notes text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_time_order check (starts_at < ends_at),
  constraint booking_max_duration check (ends_at <= starts_at + interval '6 hours'),
  constraint booking_cancel_state check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint booking_after_hours_reason check (not after_hours_override or (override_by is not null and char_length(btrim(override_reason)) >= 3)),
  constraint bookings_no_overlapping_active_slots exclude using gist (
    equipment_id with =,
    booking_slot with &&
  ) where (status in ('confirmed', 'checked_in'))
);
create index bookings_equipment_time_idx on public.bookings (equipment_id, starts_at, ends_at);
create index bookings_person_time_idx on public.bookings (person_id, starts_at desc);
create index bookings_status_time_idx on public.bookings (status, starts_at);
create index bookings_calendar_failures_idx on public.bookings (calendar_sync_status, updated_at) where calendar_sync_status = 'failed';

create table public.calendar_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  operation text not null check (operation in ('upsert', 'cancel')),
  status public.sync_status not null default 'pending',
  attempt_count smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  locked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, operation)
);
create index calendar_jobs_ready_idx on public.calendar_sync_jobs (status, next_attempt_at);

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  notification_type text not null check (notification_type in ('booking_confirmed', 'booking_cancelled', 'calendar_sync_failed')),
  status public.notification_status not null default 'pending',
  attempt_count smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, notification_type)
);
create index notification_jobs_ready_idx on public.notification_jobs (status, next_attempt_at);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_display text,
  action text not null,
  target_type text not null,
  target_id text,
  result text not null default 'success',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  request_id text,
  legacy_source_key text unique,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_target_idx on public.audit_log (target_type, target_id);
create index audit_log_actor_idx on public.audit_log (actor_user_id, created_at desc);

create table private.rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now()
);

create table public.policy_settings (
  setting_key text primary key,
  value jsonb not null,
  description text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.people is 'Private person/member records; never enumerable by anonymous clients.';
comment on column public.people.minor_status is 'Unknown blocks independent booking until staff review; minors are supervised-only.';
comment on table public.quiz_question_options is 'Contains answer keys. No anonymous or trainer table access.';
comment on column public.certifications.issued_at is 'Nullable only because some legacy grants have no defensible issue timestamp.';
comment on table public.identity_verifications is 'Short-lived server-issued identity checks; not exposed for direct client writes.';
comment on table public.audit_log is 'Append-only operational audit history.';

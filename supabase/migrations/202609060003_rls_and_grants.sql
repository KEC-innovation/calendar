-- Deny by default. Browsers read only what their active staff role permits;
-- all mutations flow through audited Edge Functions or controlled RPCs.

alter table public.people enable row level security;
alter table public.staff_roles enable row level security;
alter table public.equipment_categories enable row level security;
alter table public.certification_types enable row level security;
alter table public.equipment enable row level security;
alter table public.equipment_certification_requirements enable row level security;
alter table public.weekly_hours enable row level security;
alter table public.closures enable row level security;
alter table public.membership_types enable row level security;
alter table public.pricing_rules enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_question_options enable row level security;
alter table public.quiz_certification_mappings enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_attempt_answers enable row level security;
alter table public.certifications enable row level security;
alter table public.identity_verifications enable row level security;
alter table public.bookings enable row level security;
alter table public.calendar_sync_jobs enable row level security;
alter table public.notification_jobs enable row level security;
alter table public.audit_log enable row level security;
alter table public.policy_settings enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant usage on schema private to authenticated, service_role;

grant select on public.staff_roles to authenticated;
grant select on public.people to authenticated;
grant select on public.equipment_categories to authenticated;
grant select on public.certification_types to authenticated;
grant select on public.equipment to authenticated;
grant select on public.equipment_certification_requirements to authenticated;
grant select on public.weekly_hours to authenticated;
grant select on public.closures to authenticated;
grant select on public.membership_types to authenticated;
grant select on public.pricing_rules to authenticated;
grant select on public.quizzes to authenticated;
grant select on public.quiz_questions to authenticated;
grant select on public.quiz_question_options to authenticated;
grant select on public.quiz_certification_mappings to authenticated;
grant select on public.quiz_attempts to authenticated;
grant select on public.quiz_attempt_answers to authenticated;
grant select on public.certifications to authenticated;
grant select on public.bookings to authenticated;
grant select on public.calendar_sync_jobs to authenticated;
grant select on public.notification_jobs to authenticated;
grant select on public.audit_log to authenticated;
grant select on public.policy_settings to authenticated;

create policy staff_roles_self_or_staff_read
on public.staff_roles for select to authenticated
using (user_id = auth.uid() or private.has_staff_rank('viewer'));

create policy active_staff_read_people
on public.people for select to authenticated
using (private.has_staff_rank('viewer'));

create policy active_staff_read_equipment_categories
on public.equipment_categories for select to authenticated
using (private.has_staff_rank('viewer'));
create policy active_staff_read_certification_types
on public.certification_types for select to authenticated
using (private.has_staff_rank('viewer'));
create policy active_staff_read_equipment
on public.equipment for select to authenticated
using (private.has_staff_rank('viewer'));
create policy active_staff_read_equipment_requirements
on public.equipment_certification_requirements for select to authenticated
using (private.has_staff_rank('viewer'));
create policy active_staff_read_weekly_hours
on public.weekly_hours for select to authenticated
using (private.has_staff_rank('viewer'));
create policy active_staff_read_closures
on public.closures for select to authenticated
using (private.has_staff_rank('viewer'));
create policy active_staff_read_memberships
on public.membership_types for select to authenticated
using (private.has_staff_rank('viewer'));
create policy owner_admin_read_pricing
on public.pricing_rules for select to authenticated
using (private.has_staff_rank('admin'));

create policy active_staff_read_quizzes
on public.quizzes for select to authenticated
using (private.has_staff_rank('viewer'));
create policy owner_admin_read_quiz_questions
on public.quiz_questions for select to authenticated
using (private.has_staff_rank('admin'));
create policy owner_admin_read_quiz_answer_keys
on public.quiz_question_options for select to authenticated
using (private.has_staff_rank('admin'));
create policy owner_admin_read_quiz_mappings
on public.quiz_certification_mappings for select to authenticated
using (private.has_staff_rank('admin'));
create policy active_staff_read_quiz_attempts
on public.quiz_attempts for select to authenticated
using (private.has_staff_rank('viewer'));
create policy owner_admin_read_attempt_answers
on public.quiz_attempt_answers for select to authenticated
using (private.has_staff_rank('admin'));

create policy active_staff_read_certifications
on public.certifications for select to authenticated
using (private.has_staff_rank('viewer'));
create policy active_staff_read_bookings
on public.bookings for select to authenticated
using (private.has_staff_rank('viewer'));
create policy owner_admin_read_calendar_jobs
on public.calendar_sync_jobs for select to authenticated
using (private.has_staff_rank('admin'));
create policy owner_admin_read_notification_jobs
on public.notification_jobs for select to authenticated
using (private.has_staff_rank('admin'));
create policy active_staff_read_audit
on public.audit_log for select to authenticated
using (private.has_staff_rank('viewer'));
create policy active_staff_read_policy_settings
on public.policy_settings for select to authenticated
using (private.has_staff_rank('viewer'));

-- No policies and no grants exist for identity_verifications or rate-limit data.
-- No browser role receives INSERT, UPDATE, or DELETE on base tables.

grant execute on function private.current_staff_role(uuid) to authenticated;
grant execute on function private.has_staff_rank(public.staff_role, uuid) to authenticated;
grant execute on function public.grant_certification(uuid, uuid, text) to authenticated;
grant execute on function public.set_certification_status(uuid, public.certification_status, text) to authenticated;
grant execute on function public.create_staff_booking(uuid, uuid, timestamptz, timestamptz, text, boolean, text) to authenticated;
grant execute on function public.set_booking_status(uuid, public.booking_status, text) to authenticated;

grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
grant execute on function public.get_public_availability(uuid, date) to service_role;
grant execute on function public.create_verified_booking(uuid, text, uuid, timestamptz, timestamptz, text, text, text, text, text, text) to service_role;
grant execute on function public.cancel_public_booking(text, text) to service_role;
grant execute on function public.submit_quiz_attempt(text, jsonb) to service_role;

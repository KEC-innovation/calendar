-- Projects with automatic Data API grants disabled require explicit privileges.
-- The service_role is used only by trusted server code. Browser grants and
-- row-level security policies remain governed by migration 003.

grant usage on schema public, extensions to service_role;

grant select, insert, update, delete on table
  public.people,
  public.staff_roles,
  public.equipment_categories,
  public.certification_types,
  public.equipment,
  public.equipment_certification_requirements,
  public.weekly_hours,
  public.closures,
  public.membership_types,
  public.pricing_rules,
  public.quizzes,
  public.quiz_questions,
  public.quiz_question_options,
  public.quiz_certification_mappings,
  public.quiz_attempts,
  public.quiz_attempt_answers,
  public.certifications,
  public.identity_verifications,
  public.bookings,
  public.calendar_sync_jobs,
  public.notification_jobs,
  public.policy_settings
to service_role;

-- Audit events are append-only, including for the server role.
revoke update, delete, truncate on table public.audit_log from service_role;
grant select, insert on table public.audit_log to service_role;
grant usage, select on sequence public.audit_log_id_seq to service_role;

-- Interim password sign-in, explicitly selected while email OTP is deferred.
-- This changes only the assurance-level restriction, not roles or permissions.
-- Edge APIs still verify tokens with Auth, confirmed email and initial-password status.
-- Existing authenticator factors, people, training and audit records are retained.
create or replace function private.current_staff_role(p_user_id uuid default auth.uid())
returns public.staff_role
language sql stable security definer set search_path = '' as $$
 select sr.role from public.staff_roles sr
 where sr.user_id = p_user_id and sr.active
 limit 1;
$$;

-- Safe production metadata only. Real people, calendar IDs, historical records,
-- and quiz answer keys are loaded from the private legacy importer.

insert into public.equipment_categories(slug, display_name, description) values
  ('laser-cutting', 'Laser cutting', 'Laser cutting and engraving equipment.'),
  ('3d-printing', '3D printing', 'FDM 3D printers.'),
  ('3d-scanning', '3D scanning', '3D scanning equipment.'),
  ('electronics', 'Electronics', 'Electronics workstations and benches.'),
  ('design-workstations', 'Design workstations', 'CAD and design computers.'),
  ('collaboration-space', 'Collaboration space', 'Shared tables retained for history only.')
on conflict (slug) do update set display_name = excluded.display_name, description = excluded.description;

insert into public.certification_types(slug, display_name, description) values
  ('laser-cutting', 'Laser Cutting', 'Independent operation of the laser cutter.'),
  ('3d-printing', '3D Printing', 'Independent operation of the mapped FDM printers.'),
  ('3d-scanning', '3D Scanning', 'Independent operation of the 3D scanner.'),
  ('electronics-workstation', 'Electronics Workstation', 'Independent use of electronics workstations.')
on conflict (slug) do update set display_name = excluded.display_name, description = excluded.description;

insert into public.equipment(
  slug, display_name, category_id, status, booking_enabled,
  external_allowed, max_booking_minutes, legacy_name, notes
)
select seed.slug, seed.display_name, category.id, seed.status::public.equipment_status,
  seed.booking_enabled, seed.external_allowed, 360, seed.legacy_name, seed.notes
from (values
  ('laser-cutter-katrina', 'Laser Cutter (Katrina)', 'laser-cutting', 'active', true, true, 'Laser Cutter (Katrina)', null),
  ('3d-scanner-raptor', '3D Scanner (Raptor)', '3d-scanning', 'active', true, true, '3D Scanner (Raptor)', null),
  ('anycubic-kobra-3-nagini', 'Anycubic Kobra 3 (Nagini)', '3d-printing', 'active', true, true, 'Anycubic Kobra 3 (Nagini)', null),
  ('anycubic-neo-niro', 'Anycubic Neo (Niro)', '3d-printing', 'active', true, true, 'Anycubic Neo (Niro)', null),
  ('bambu-a1-1', 'Bambu A1 (1)', '3d-printing', 'active', true, true, 'Bambu A1 (1)', null),
  ('bambu-a1-2', 'Bambu A1 (2)', '3d-printing', 'active', true, true, 'Bambu A1 (2)', null),
  ('computer', 'Computer', 'design-workstations', 'active', true, true, 'Computer', 'General equipment certification is not required; safety training and waiver still are.'),
  ('electronic-station-1', 'Electronic Station 1', 'electronics', 'active', true, true, 'Electronic Station 1', 'Electronics certification required by the Policy Book override.'),
  ('electronic-station-2', 'Electronic Station 2', 'electronics', 'active', true, true, 'Electronic Station 2', 'Electronics certification required by the Policy Book override.'),
  ('table-1', 'Table 1', 'collaboration-space', 'inactive', false, true, 'Table 1', 'Historical records only; not bookable in the new application.'),
  ('table-2', 'Table 2', 'collaboration-space', 'inactive', false, true, 'Table 2', 'Historical records only; not bookable in the new application.')
) as seed(slug, display_name, category_slug, status, booking_enabled, external_allowed, legacy_name, notes)
join public.equipment_categories category on category.slug = seed.category_slug
on conflict (slug) do update set
  display_name = excluded.display_name,
  category_id = excluded.category_id,
  status = excluded.status,
  booking_enabled = excluded.booking_enabled,
  external_allowed = excluded.external_allowed,
  max_booking_minutes = excluded.max_booking_minutes,
  legacy_name = excluded.legacy_name,
  notes = excluded.notes;

insert into public.equipment_certification_requirements(equipment_id, certification_type_id)
select equipment.id, cert.id
from (values
  ('laser-cutter-katrina', 'laser-cutting'),
  ('3d-scanner-raptor', '3d-scanning'),
  ('anycubic-kobra-3-nagini', '3d-printing'),
  ('anycubic-neo-niro', '3d-printing'),
  ('bambu-a1-1', '3d-printing'),
  ('bambu-a1-2', '3d-printing'),
  ('electronic-station-1', 'electronics-workstation'),
  ('electronic-station-2', 'electronics-workstation')
) as mapping(equipment_slug, certification_slug)
join public.equipment equipment on equipment.slug = mapping.equipment_slug
join public.certification_types cert on cert.slug = mapping.certification_slug
on conflict do nothing;

insert into public.weekly_hours(iso_day, day_name, open_time, close_time, bookable) values
  (1, 'Monday', '09:00', '19:00', true),
  (2, 'Tuesday', '09:00', '19:00', true),
  (3, 'Wednesday', '09:00', '19:00', true),
  (4, 'Thursday', '09:00', '18:00', true),
  (5, 'Friday', '09:00', '17:00', true),
  (6, 'Saturday', '09:00', '17:00', true),
  (7, 'Sunday', '09:00', '17:00', true)
on conflict (iso_day) do update set
  day_name = excluded.day_name, open_time = excluded.open_time,
  close_time = excluded.close_time, bookable = excluded.bookable;

insert into public.quizzes(slug, display_name, duration_minutes, question_count, pass_mark, active, notes) values
  ('laser-cutting', 'Laser Cutting Training Quiz', 8, 20, 16, false, 'Activate only after the private legacy answer bank has been imported and validated.'),
  ('3d-printing', '3D Printing Training Quiz', 8, 20, 16, false, 'Activate only after the private legacy answer bank has been imported and validated.')
on conflict (slug) do update set
  display_name = excluded.display_name,
  duration_minutes = excluded.duration_minutes,
  question_count = excluded.question_count,
  pass_mark = excluded.pass_mark;

insert into public.quiz_certification_mappings(quiz_id, certification_type_id)
select quiz.id, cert.id
from (values ('laser-cutting', 'laser-cutting'), ('3d-printing', '3d-printing')) mapping(quiz_slug, certification_slug)
join public.quizzes quiz on quiz.slug = mapping.quiz_slug
join public.certification_types cert on cert.slug = mapping.certification_slug
on conflict do nothing;

insert into public.membership_types(slug, display_name, minimum_months, notes) values
  ('category-subscription', 'Equipment category subscription', 3, 'One equipment category; training required.'),
  ('all-equipment-without-scanner', 'All equipment - without scanner', 3, 'Pricing scaffold only; no payment processing.'),
  ('all-equipment-with-scanner', 'All equipment - with scanner', 3, 'Pricing scaffold only; no payment processing.')
on conflict (slug) do update set display_name = excluded.display_name, minimum_months = excluded.minimum_months, notes = excluded.notes;

insert into public.policy_settings(setting_key, value, description) values
  ('timezone', '"Asia/Kathmandu"'::jsonb, 'Operational timezone used for display and schedule validation.'),
  ('maximum_booking_minutes', '360'::jsonb, 'Maximum single equipment session under Policy Book section 7.'),
  ('cancellation_cutoff_minutes', '120'::jsonb, 'Late cancellation cutoff under Policy Book section 7.'),
  ('late_arrival_minutes', '15'::jsonb, 'No-show/slot release threshold under Policy Book section 7.'),
  ('quiz_duration_minutes', '8'::jsonb, 'Explicit product override; Policy Book v1.1 still says 10 minutes and needs updating.'),
  ('quiz_pass_mark', '16'::jsonb, 'Current pass mark out of 20.'),
  ('calendar_sync_enabled', 'false'::jsonb, 'Enable only after service-account calendars are shared and secrets configured.'),
  ('notification_delivery_enabled', 'false'::jsonb, 'Enable only after a server-side notification provider is configured.')
on conflict (setting_key) do update set value = excluded.value, description = excluded.description;

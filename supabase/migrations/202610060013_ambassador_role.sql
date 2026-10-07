-- Separate migration so the enum value is committed before use.
alter type public.staff_role add value if not exists 'ambassador';

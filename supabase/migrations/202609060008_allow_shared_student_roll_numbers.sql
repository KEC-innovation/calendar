-- Legacy roll numbers are not globally unique: distinct email identities can
-- share a class/batch-local roll. Keep their records and certifications separate.
-- people_email_unique remains the identity uniqueness constraint. The public
-- API resolves by normalized email and then checks the supplied student roll.

drop index if exists public.people_roll_number_unique;

create index if not exists people_roll_number_lookup_idx
  on public.people (lower(btrim(roll_number)))
  where roll_number is not null
    and btrim(roll_number) <> ''
    and category = 'kec_student';

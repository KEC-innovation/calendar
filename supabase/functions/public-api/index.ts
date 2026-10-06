import { evaluateEquipmentAccess } from '../_shared/equipmentAccess.ts';
import { adminClient } from '../_shared/supabase.ts';
import { handle, HttpError, json, readJson, requireUuid, requiredText, text } from '../_shared/http.ts';
import {
  consumeRateLimit,
  identityFingerprint,
  normalizeIdentityPart,
  safeEmail,
} from '../_shared/security.ts';

const USER_CATEGORIES = [
  'kec_student',
  'kec_staff',
  'other_college_student',
  'business_external',
  'member_non_kec',
] as const;

type Category = (typeof USER_CATEGORIES)[number];

function parseCategory(value: unknown): Category {
  const category = text(value, 40) as Category;
  if (!USER_CATEGORIES.includes(category)) throw new HttpError(400, 'Choose a valid user category.', 'VALIDATION_ERROR');
  return category;
}

function parseTimestamp(value: unknown, label: string): string {
  const raw = requiredText(value, label, 50);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, `${label} is invalid.`, 'VALIDATION_ERROR');
  return parsed.toISOString();
}

function categoryLabel(category: Category): string {
  return {
    kec_student: 'KEC student',
    kec_staff: 'KEC staff',
    other_college_student: 'Other college student',
    business_external: 'Business / external',
    member_non_kec: 'Non-KEC member',
  }[category];
}

Deno.serve((request) => handle(request, async () => {
  const body = await readJson(request);
  const action = text(body.action, 50);
  const admin = adminClient();

  if (action === 'bootstrap') {
    await consumeRateLimit(admin, request, 'public-bootstrap', 120, 60);
    const [{ data: hours, error: hoursError }, { data: settings, error: settingsError }] = await Promise.all([
      admin.from('weekly_hours').select('iso_day,day_name,open_time,close_time,bookable').order('iso_day'),
      admin.from('policy_settings').select('setting_key,value'),
    ]);
    if (hoursError) throw hoursError;
    if (settingsError) throw settingsError;
    const policy = Object.fromEntries((settings || []).map((row) => [row.setting_key, row.value]));
    return json(request, {
      timezone: 'Asia/Kathmandu',
      weeklyHours: (hours || []).map((row) => ({
        isoDay: row.iso_day,
        dayName: row.day_name,
        openTime: row.open_time,
        closeTime: row.close_time,
        bookable: row.bookable,
      })),
      categories: USER_CATEGORIES.map((value) => ({ value, label: categoryLabel(value) })),
      policy: {
        maxBookingMinutes: Number(policy.maximum_booking_minutes ?? 360),
        cancellationCutoffMinutes: Number(policy.cancellation_cutoff_minutes ?? 120),
        lateArrivalMinutes: Number(policy.late_arrival_minutes ?? 15),
        quizMinutes: Number(policy.quiz_duration_minutes ?? 8),
        quizPassMark: Number(policy.quiz_pass_mark ?? 16),
        quizMaxScore: 20,
      },
    });
  }

  if (action === 'verify-identity' || action === 'create-booking') throw new HttpError(401,'Sign in to your Makerspace account to check your own access and book.','ACCOUNT_REQUIRED');
  if (action === 'verify-identity') {
    await consumeRateLimit(admin, request, 'verify-identity', 20, 600);
    const identity = body.identity;
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) throw new HttpError(400, 'Identity details are required.', 'VALIDATION_ERROR');
    const input = identity as Record<string, unknown>;
    const category = parseCategory(input.category);
    const email = safeEmail(input.email);
    const rollNumber = text(input.rollNumber, 80);
    const organization = text(input.organization, 160);
    if (category === 'kec_student' && !rollNumber) throw new HttpError(400, 'Roll number is required for a KEC student.', 'VALIDATION_ERROR');
    if (['other_college_student', 'business_external', 'member_non_kec'].includes(category) && !organization) {
      throw new HttpError(400, 'College or organization is required.', 'VALIDATION_ERROR');
    }

    const { data: candidate, error: peopleError } = await admin
      .from('people')
      .select('id,category,roll_number,active,booking_privilege_active,safety_training_status,waiver_status,minor_status')
      .eq('email_normalized', email)
      .maybeSingle();
    if (peopleError) throw peopleError;

    const exactIdentity = Boolean(
      candidate
      && candidate.category === category
      && (category !== 'kec_student' || normalizeIdentityPart(candidate.roll_number) === normalizeIdentityPart(rollNumber)),
    );
    const person = exactIdentity ? candidate : null;
    const identityStatus = !person ? 'needs_staff_review' : person.active ? 'verified' : 'inactive';

    const [{ data: machines, error: machineError }, { data: certRows, error: certError }] = await Promise.all([
      admin
        .from('equipment')
        .select('id,slug,display_name,status,booking_enabled,external_allowed,max_booking_minutes,equipment_categories!inner(display_name),equipment_certification_requirements(certification_type_id)')
        .eq('booking_enabled', true)
        .neq('status', 'inactive')
        .order('display_name'),
      person
        ? admin.from('certifications').select('certification_type_id,certification_types(display_name)').eq('person_id', person.id).eq('status', 'active')
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (machineError) throw machineError;
    if (certError) throw certError;
    const certifications = new Set((certRows || []).map((row) => row.certification_type_id));
    const external = !['kec_student', 'kec_staff'].includes(category);

    const resources = (machines || []).flatMap((machine) => {
      const requirements = (machine.equipment_certification_requirements || []) as Array<{ certification_type_id: string }>;
      const access = evaluateEquipmentAccess({
        person, requiredCertifications: requirements.map((item) => item.certification_type_id),
        activeCertifications: [...certifications], status: machine.status,
        bookingEnabled: machine.booking_enabled, external, externalAllowed: machine.external_allowed,
      });
      if (!access.visible) return [];

      const categoryData = machine.equipment_categories as unknown as { display_name?: string } | Array<{ display_name?: string }>;
      const categoryName = Array.isArray(categoryData) ? categoryData[0]?.display_name : categoryData?.display_name;
      return [{
        id: machine.id,
        slug: machine.slug,
        displayName: machine.display_name,
        categoryName: categoryName || 'Equipment',
        status: machine.status,
        bookingEnabled: machine.booking_enabled,
        externalAllowed: machine.external_allowed,
        maxMinutes: machine.max_booking_minutes,
        requiresCertification: access.requiresCertification,
        certified: access.certified,
        eligible: access.eligible,
        blockers: access.blockers,
      }];
    });

    const fingerprint = await identityFingerprint(category, email, rollNumber, organization);
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const { data: verification, error: verificationError } = await admin
      .from('identity_verifications')
      .insert({
        person_id: person?.id || null,
        category,
        identity_fingerprint: fingerprint,
        result: identityStatus,
        expires_at: expiresAt,
      })
      .select('id')
      .single();
    if (verificationError) throw verificationError;

    const message = identityStatus === 'verified'
      ? resources.some((resource) => resource.eligible)
        ? 'Only equipment currently available to your verified record is shown.'
        : 'Your identity matched, but a staff review is needed before you can book.'
      : identityStatus === 'inactive'
        ? 'This record is inactive. Ask Makerspace staff to review it.'
        : 'No exact active record matched these details. General resources are shown for reference; staff must verify your access before booking.';

    return json(request, {
      identityStatus,
      recognizedTraining: (certRows || []).map((row) => {
        const type = row.certification_types as unknown as { display_name: string } | Array<{ display_name: string }>;
        return Array.isArray(type) ? type[0]?.display_name : type?.display_name;
      }).filter(Boolean),
      resources,
      message,
      verificationId: verification.id,
      expiresAt,
    });
  }

  if (action === 'availability') {
    await consumeRateLimit(admin, request, 'availability', 90, 300);
    const equipmentId = requireUuid(body.equipmentId, 'Equipment');
    const date = requiredText(body.date, 'Date', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Date is invalid.', 'VALIDATION_ERROR');
    const { data: machine, error: machineError } = await admin
      .from('equipment')
      .select('id')
      .eq('id', equipmentId)
      .eq('booking_enabled', true)
      .eq('status', 'active')
      .maybeSingle();
    if (machineError) throw machineError;
    if (!machine) throw new HttpError(404, 'Equipment is not available.', 'NOT_FOUND');
    const [{ data: busyRows, error: busyError }, { data: closures, error: closureError }] = await Promise.all([
      admin.rpc('get_public_availability', { p_equipment_id: equipmentId, p_local_date: date }),
      admin.from('closures').select('reason').eq('closure_date', date).eq('active', true).is('starts_at', null).limit(1),
    ]);
    if (busyError) throw busyError;
    if (closureError) throw closureError;
    return json(request, {
      equipmentId,
      date,
      timezone: 'Asia/Kathmandu',
      busy: (busyRows || []).map((row: {starts_at: string; ends_at: string}) => ({ startsAt: row.starts_at, endsAt: row.ends_at })),
      closureReason: closures?.[0]?.reason || undefined,
    });
  }

  if (action === 'create-booking') {
    await consumeRateLimit(admin, request, 'create-booking', 8, 900);
    const booking = body.booking;
    if (!booking || typeof booking !== 'object' || Array.isArray(booking)) throw new HttpError(400, 'Booking details are required.', 'VALIDATION_ERROR');
    const input = booking as Record<string, unknown>;
    const category = parseCategory(input.category);
    const email = safeEmail(input.email);
    const rollNumber = text(input.rollNumber, 80);
    const organization = text(input.organization, 160);
    const fingerprint = await identityFingerprint(category, email, rollNumber, organization);
    const { data, error } = await admin.rpc('create_verified_booking', {
      p_verification_id: requireUuid(input.verificationId, 'Verification'),
      p_identity_fingerprint: fingerprint,
      p_equipment_id: requireUuid(input.equipmentId, 'Equipment'),
      p_starts_at: parseTimestamp(input.startsAt, 'Start time'),
      p_ends_at: parseTimestamp(input.endsAt, 'End time'),
      p_contact_name: requiredText(input.fullName, 'Full name', 120),
      p_contact_email: email,
      p_contact_phone: requiredText(input.phone, 'Phone number', 40),
      p_contact_roll_number: rollNumber,
      p_contact_organization: organization,
      p_purpose: text(input.purpose, 500),
    });
    if (error) {
      if (error.code === '23P01') throw new HttpError(409, 'That time has just been booked. Choose another slot.', 'BOOKING_CONFLICT');
      if (['22023', '22007', '28000', '42501'].includes(error.code || '')) throw new HttpError(400, error.message, 'BOOKING_REJECTED');
      throw error;
    }
    return json(request, data, 201);
  }

  if (action === 'cancel-booking') {
    await consumeRateLimit(admin, request, 'cancel-booking', 10, 900);
    const { data, error } = await admin.rpc('cancel_public_booking', {
      p_booking_reference: requiredText(body.bookingReference, 'Booking reference', 40),
      p_manage_token: requiredText(body.manageToken, 'Management token', 100),
    });
    if (error) {
      if (['22023', '28000'].includes(error.code || '')) throw new HttpError(400, error.message, 'CANCELLATION_REJECTED');
      throw error;
    }
    return json(request, data);
  }

  throw new HttpError(404, 'Unknown public operation.', 'ACTION_NOT_FOUND');
}));

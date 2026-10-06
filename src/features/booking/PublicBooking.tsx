import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, Clock3, ShieldCheck, Wrench } from 'lucide-react';
import { z } from 'zod';
import { api } from '../../lib/api';
import { isMockMode } from '../../lib/supabase';
import {
  bookableResources,
  dayHours,
  formatClock,
  formatKathmanduDateTime,
  intervalsOverlap,
  toKathmanduUtcIso,
  validateBookingRange,
} from '../../lib/bookingRules';
import { Brand } from '../../components/Brand';
import { Spinner } from '../../components/Spinner';
import { StatusBadge } from '../../components/StatusBadge';
import type {
  AvailabilityResult,
  BookingConfirmation,
  IdentityInput,
  IdentityVerification,
  PersonCategory,
  PublicBootstrap,
} from '../../types/domain';

const identitySchema = z
  .object({
    category: z.enum(['kec_student', 'kec_staff', 'other_college_student', 'business_external', 'member_non_kec']),
    fullName: z.string().trim().min(2, 'Enter your full name.').max(120),
    email: z.email('Enter a valid email address.'),
    rollNumber: z.string().trim().max(80).optional(),
    phone: z.string().trim().min(7, 'Enter a valid phone number.').max(40),
    organization: z.string().trim().max(160).optional(),
  })
  .superRefine((value, context) => {
    if (value.category === 'kec_student' && !value.rollNumber) {
      context.addIssue({ code: 'custom', path: ['rollNumber'], message: 'Roll number is required for KEC students.' });
    }
    if (['other_college_student', 'business_external', 'member_non_kec'].includes(value.category) && !value.organization) {
      context.addIssue({ code: 'custom', path: ['organization'], message: 'Enter your college, organization, or “Individual”.' });
    }
  });

type BookingStep = 'identity' | 'equipment' | 'time' | 'confirmed';

function kathmanduDate(offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(Date.now() + offsetDays * 24 * 60 * 60_000));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

const kathmanduToday = () => kathmanduDate(0);

function fieldError(error: z.ZodError, name: string): string | undefined {
  return error.issues.find((issue) => issue.path[0] === name)?.message;
}

export function PublicBooking() {
  const [bootstrap, setBootstrap] = useState<PublicBootstrap | null>(null);
  const [step, setStep] = useState<BookingStep>('identity');
  const [identity, setIdentity] = useState<IdentityInput>({
    category: 'kec_student',
    fullName: '',
    email: '',
    rollNumber: '',
    phone: '',
    organization: '',
  });
  const [identityErrors, setIdentityErrors] = useState<Record<string, string>>({});
  const [verification, setVerification] = useState<IdentityVerification | null>(null);
  const [equipmentId, setEquipmentId] = useState('');
  const [date, setDate] = useState(() => kathmanduDate(1));
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [purpose, setPurpose] = useState('');
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void api
      .bootstrap()
      .then((data) => active && setBootstrap(data))
      .catch((cause: unknown) => active && setError(cause instanceof Error ? cause.message : 'Booking information could not be loaded.'));
    return () => {
      active = false;
    };
  }, []);

  const resources = useMemo(
    () => bookableResources(verification?.resources || []),
    [verification],
  );
  const chosenEquipment = resources.find((resource) => resource.id === equipmentId);

  function updateIdentity<K extends keyof IdentityInput>(key: K, value: IdentityInput[K]) {
    setIdentity((current) => ({ ...current, [key]: value }));
    setIdentityErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function checkAccess(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const parsed = identitySchema.safeParse(identity);
    if (!parsed.success) {
      setIdentityErrors(Object.fromEntries(['fullName', 'email', 'rollNumber', 'phone', 'organization'].map((key) => [key, fieldError(parsed.error, key) || '']).filter(([, value]) => value)));
      return;
    }
    setBusy(true);
    try {
      const result = await api.verifyIdentity(parsed.data);
      setIdentity(parsed.data);
      setVerification(result);
      setEquipmentId('');
      setStep('equipment');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Access could not be checked.');
    } finally {
      setBusy(false);
    }
  }

  function chooseEquipment(id: string) {
    setEquipmentId(id);
    setAvailability(null);
    setError('');
  }

  function continueToTime() {
    if (!equipmentId) {
      setError('Choose an available resource.');
      return;
    }
    setError('');
    setStep('time');
  }

  function currentRange(): { startsAt: string; endsAt: string } | null {
    try {
      return { startsAt: toKathmanduUtcIso(date, startTime), endsAt: toKathmanduUtcIso(date, endTime) };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Choose a valid date and time.');
      return null;
    }
  }

  async function checkAvailability(): Promise<boolean> {
    const range = currentRange();
    if (!range) return false;
    const rangeErrors = validateBookingRange(range.startsAt, range.endsAt);
    if (rangeErrors.length) {
      setError(rangeErrors[0] || 'Choose a valid time.');
      return false;
    }
    const hours = bootstrap ? dayHours(bootstrap.weeklyHours, date) : undefined;
    if (!hours?.bookable || startTime < hours.openTime.slice(0, 5) || endTime > hours.closeTime.slice(0, 5)) {
      setError(hours?.bookable ? `Choose a time between ${formatClock(hours.openTime)} and ${formatClock(hours.closeTime)}.` : 'The Makerspace is closed on this date.');
      return false;
    }
    setError('');
    setBusy(true);
    try {
      const result = await api.availability(equipmentId, date);
      setAvailability(result);
      if (result.closureReason) {
        setError(`Closed: ${result.closureReason}`);
        return false;
      }
      const overlap = result.busy.some((slot) => intervalsOverlap(range, slot));
      if (overlap) {
        setError('That time overlaps an existing booking. Choose another time.');
        return false;
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Availability could not be checked.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitBooking(event: React.FormEvent) {
    event.preventDefault();
    if (!verification || !chosenEquipment) return;
    const available = await checkAvailability();
    if (!available) return;
    const range = currentRange();
    if (!range) return;
    setBusy(true);
    try {
      const result = await api.createBooking({
        ...identity,
        verificationId: verification.verificationId,
        equipmentId,
        startsAt: range.startsAt,
        endsAt: range.endsAt,
        purpose: purpose.trim() || undefined,
      });
      setConfirmation(result);
      setStep('confirmed');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The booking could not be created.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep('identity');
    setVerification(null);
    setEquipmentId('');
    setAvailability(null);
    setConfirmation(null);
    setPurpose('');
    setError('');
  }

  if (!bootstrap && !error) {
    return <main className="center-screen"><Spinner label="Loading booking system" /></main>;
  }

  return (
    <main className="public-shell">
      <header className="public-header">
        <Brand />
        <a className="text-link" href="#/staff/login">Staff sign in</a>
      </header>

      <div className="booking-layout">
        <aside className="booking-aside">
          <p className="eyebrow">Equipment booking</p>
          <h1>Reserve a machine in a few minutes.</h1>
          <p>Your access is checked privately. You will only see equipment available to your verified record.</p>
          <ol className="step-list" aria-label="Booking progress">
            {[
              ['identity', 'Your details'],
              ['equipment', 'Choose equipment'],
              ['time', 'Choose a time'],
              ['confirmed', 'Confirmation'],
            ].map(([key, label], index) => (
              <li key={key} className={step === key ? 'is-current' : ''}>
                <span>{step === 'confirmed' || ['identity', 'equipment', 'time', 'confirmed'].indexOf(step) > index ? <Check size={15} /> : index + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          {bootstrap && (
            <div className="policy-note">
              <Clock3 size={18} />
              <span>Maximum booking: 6 hours. Times are shown in Nepal time.</span>
            </div>
          )}
        </aside>

        <section className="booking-card" aria-live="polite">
          {error && <div className="alert alert--error" role="alert">{error}</div>}

          {step === 'identity' && bootstrap && (
            <form onSubmit={(event) => void checkAccess(event)} noValidate>
              <div className="section-heading">
                <span>1</span>
                <div><h2>Tell us who is booking</h2><p>For KEC students, email and roll number must match the same record.</p></div>
              </div>
              <div className="form-grid">
                <label className="field field--full">
                  <span>Booking as</span>
                  <select value={identity.category} onChange={(event) => updateIdentity('category', event.target.value as PersonCategory)}>
                    {bootstrap.categories.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Full name</span>
                  <input value={identity.fullName} onChange={(event) => updateIdentity('fullName', event.target.value)} autoComplete="name" />
                  {identityErrors.fullName && <small className="field-error">{identityErrors.fullName}</small>}
                </label>
                <label className="field">
                  <span>Email</span>
                  <input type="email" value={identity.email} onChange={(event) => updateIdentity('email', event.target.value)} autoComplete="email" />
                  {identityErrors.email && <small className="field-error">{identityErrors.email}</small>}
                </label>
                {identity.category === 'kec_student' ? (
                  <label className="field">
                    <span>Roll number</span>
                    <input value={identity.rollNumber || ''} onChange={(event) => updateIdentity('rollNumber', event.target.value)} autoComplete="off" />
                    {identityErrors.rollNumber && <small className="field-error">{identityErrors.rollNumber}</small>}
                  </label>
                ) : identity.category !== 'kec_staff' ? (
                  <label className="field">
                    <span>College / organization</span>
                    <input value={identity.organization || ''} onChange={(event) => updateIdentity('organization', event.target.value)} autoComplete="organization" placeholder="Use Individual if not applicable" />
                    {identityErrors.organization && <small className="field-error">{identityErrors.organization}</small>}
                  </label>
                ) : null}
                <label className="field">
                  <span>Phone number</span>
                  <input type="tel" value={identity.phone} onChange={(event) => updateIdentity('phone', event.target.value)} autoComplete="tel" inputMode="tel" />
                  {identityErrors.phone && <small className="field-error">{identityErrors.phone}</small>}
                </label>
              </div>
              <div className="privacy-line"><ShieldCheck size={17} /><span>Your profile and certifications are checked on the server and are never listed publicly.</span></div>
              {isMockMode() && <p className="demo-notice">Demo only — these are synthetic records, not your people list. Try student@kec.edu.np / KEC-001, or review@kec.edu.np / KEC-002 to see a trained person awaiting paperwork. Real records appear after the private database import.</p>}
              <p className="training-note">Already passed training? Use the email and roll number from your training record. Your existing equipment certifications count; you do not need to take the quiz again.</p>
              <button className="button button--primary button--wide" disabled={busy} type="submit">{busy ? <Spinner label="Checking access" /> : 'Check my access'}</button>
            </form>
          )}

          {step === 'equipment' && verification && (
            <div>
              <button className="back-button" type="button" onClick={() => setStep('identity')}><ChevronLeft size={17} /> Change details</button>
              <div className="section-heading">
                <span>2</span>
                <div><h2>Choose equipment</h2><p>{verification.message}</p></div>
              </div>
              {Boolean(verification.recognizedTraining?.length) && <section className="recognized-training" aria-label="Your existing training"><ShieldCheck size={22} /><div><strong>Your training is already recognized</strong><p>{verification.recognizedTraining?.join(', ')}</p><small>No repeat quiz is needed for these certifications. Any outstanding record checks are listed separately below.</small></div></section>}
              <div className="resource-list" role="radiogroup" aria-label="Available equipment">
                {resources.map((resource) => (
                  <label key={resource.id} className={`resource-option ${resource.eligible ? '' : 'is-disabled'} ${equipmentId === resource.id ? 'is-selected' : ''}`}>
                    <input type="radio" name="equipment" value={resource.id} checked={equipmentId === resource.id} disabled={!resource.eligible} onChange={() => chooseEquipment(resource.id)} />
                    <span className="resource-icon"><Wrench size={20} /></span>
                    <span className="resource-copy">
                      <strong>{resource.displayName}</strong>
                      <small>{resource.categoryName} · up to {resource.maxMinutes / 60} hours</small>
                      {!resource.eligible && resource.blockers.length > 0 && <em>{resource.blockers.join(' ')}</em>}
                    </span>
                    {resource.requiresCertification ? <StatusBadge tone={resource.certified ? 'good' : 'warn'}>{resource.certified ? 'Training recognized' : 'Certification needed'}</StatusBadge> : <StatusBadge tone="neutral">General access</StatusBadge>}
                  </label>
                ))}
              </div>
              {resources.length === 0 && <div className="empty-state"><strong>No bookable equipment found</strong><p>Ask Makerspace staff to check your access record.</p></div>}
              <button className="button button--primary button--wide" type="button" onClick={continueToTime} disabled={!equipmentId}>Continue to time</button>
            </div>
          )}

          {step === 'time' && verification && chosenEquipment && bootstrap && (
            <form onSubmit={(event) => void submitBooking(event)}>
              <button className="back-button" type="button" onClick={() => setStep('equipment')}><ChevronLeft size={17} /> Change equipment</button>
              <div className="section-heading">
                <span>3</span>
                <div><h2>Choose a time</h2><p>{chosenEquipment.displayName}</p></div>
              </div>
              <div className="form-grid form-grid--time">
                <label className="field field--full"><span>Date</span><input type="date" min={kathmanduToday()} value={date} onChange={(event) => { setDate(event.target.value); setAvailability(null); }} /></label>
                <label className="field"><span>Start</span><input type="time" step="900" value={startTime} onChange={(event) => { setStartTime(event.target.value); setAvailability(null); }} /></label>
                <label className="field"><span>End</span><input type="time" step="900" value={endTime} onChange={(event) => { setEndTime(event.target.value); setAvailability(null); }} /></label>
                <label className="field field--full"><span>Purpose <small>(optional)</small></span><textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} maxLength={500} placeholder="Project, prototype, training preparation…" /></label>
              </div>
              {(() => {
                const hours = dayHours(bootstrap.weeklyHours, date);
                return <div className="hours-strip"><Clock3 size={17} /><span>{hours?.bookable ? `Open ${formatClock(hours.openTime)}–${formatClock(hours.closeTime)}` : 'Closed'} on this day</span></div>;
              })()}
              {availability && !error && <div className="alert alert--success"><Check size={18} /> This time is available. The database will check once more when you confirm.</div>}
              <div className="button-row">
                <button className="button button--secondary" type="button" disabled={busy} onClick={() => void checkAvailability()}>Check availability</button>
                <button className="button button--primary" type="submit" disabled={busy}>{busy ? <Spinner label="Confirming" /> : 'Confirm booking'}</button>
              </div>
            </form>
          )}

          {step === 'confirmed' && confirmation && (
            <div className="confirmation">
              <div className="confirmation__icon"><Check size={30} /></div>
              <p className="eyebrow">Booking confirmed</p>
              <h2>{confirmation.equipmentName}</h2>
              <p>{formatKathmanduDateTime(confirmation.startsAt)} – {new Intl.DateTimeFormat('en-NP', { timeZone: 'Asia/Kathmandu', hour: 'numeric', minute: '2-digit' }).format(new Date(confirmation.endsAt))}</p>
              <div className="reference-box"><span>Booking reference</span><strong data-testid="booking-reference">{confirmation.bookingReference}</strong></div>
              <p className="muted">Keep this reference. Calendar and email updates continue in the background and do not affect the confirmed slot.</p>
              <div className="button-row button-row--center">
                <a className="button button--secondary" href={`#/booking/manage?ref=${encodeURIComponent(confirmation.bookingReference)}&token=${encodeURIComponent(confirmation.manageToken)}`}>Manage booking</a>
                <button className="button button--primary" type="button" onClick={reset}>Book another</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

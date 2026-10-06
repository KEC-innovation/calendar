import { adminClient } from '../_shared/supabase.ts';
import { handle, HttpError, json } from '../_shared/http.ts';

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index % Math.max(1, left.length)) || 0)
      ^ (right.charCodeAt(index % Math.max(1, right.length)) || 0);
  }
  return mismatch === 0;
}

function requireCron(request: Request): void {
  const expected = Deno.env.get('CRON_SECRET') || '';
  const provided = request.headers.get('x-cron-secret') || '';
  if (!expected || !provided || !constantTimeEqual(expected, provided)) {
    throw new HttpError(401, 'Worker authorization failed.', 'AUTH_REQUIRED');
  }
}

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemBytes(pem: string): Uint8Array {
  const clean = pem.replace(/\\n/g, '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = atob(clean);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function googleAccessToken(): Promise<string> {
  const email = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY');
  if (!email || !privateKey) throw new Error('Google Calendar service-account secrets are not configured.');
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims: Record<string, unknown> = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/calendar.events',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const delegatedUser = Deno.env.get('GOOGLE_CALENDAR_DELEGATED_USER');
  if (delegatedUser) claims.sub = delegatedUser;
  const payload = base64Url(JSON.stringify(claims));
  const input = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', new Uint8Array(pemBytes(privateKey)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  const assertion = `${input}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const result = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !result.access_token) throw new Error(result.error_description || 'Google authentication failed.');
  return result.access_token;
}

async function calendarRequest(token: string, calendarId: string, path: string, init: RequestInit): Promise<Response> {
  return fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

Deno.serve((request) => handle(request, async () => {
  requireCron(request);
  const admin = adminClient();
  if (Deno.env.get('GOOGLE_CALENDAR_ENABLED') !== 'true') {
    const { data: queued, error } = await admin.rpc('claim_calendar_sync_jobs', { p_limit: 50 });
    if (error) throw error;
    const ids = (queued || []).map((job: {id: string; booking_id: string}) => job.id);
    if (ids.length) {
      await admin.from('calendar_sync_jobs').update({ status: 'not_configured', last_error: 'Calendar integration is disabled.' }).in('id', ids);
      await admin.from('bookings').update({ calendar_sync_status: 'not_configured' }).in('id', (queued || []).map((job: {id: string; booking_id: string}) => job.booking_id));
    }
    return json(request, { processed: ids.length, status: 'not_configured' });
  }

  const token = await googleAccessToken();
  const { data: jobs, error: claimError } = await admin.rpc('claim_calendar_sync_jobs', { p_limit: 20 });
  if (claimError) throw claimError;
  let synced = 0;
  let failed = 0;

  for (const job of jobs || []) {
    try {
      const { data: booking, error } = await admin
        .from('bookings')
        .select('id,booking_reference,status,starts_at,ends_at,contact_email,purpose,calendar_event_id,equipment!inner(display_name,google_calendar_id)')
        .eq('id', job.booking_id)
        .single();
      if (error) throw error;
      const equipment = Array.isArray(booking.equipment) ? booking.equipment[0] : booking.equipment;
      if (!equipment?.google_calendar_id) throw new Error('Equipment calendar ID is not configured.');

      if (job.operation === 'cancel' || booking.status === 'cancelled') {
        if (booking.calendar_event_id) {
          const response = await calendarRequest(token, equipment.google_calendar_id, `/${encodeURIComponent(booking.calendar_event_id)}`, { method: 'DELETE' });
          if (!response.ok && ![404, 410].includes(response.status)) throw new Error(`Google Calendar delete failed (${response.status}).`);
        }
      } else {
        const event = {
          summary: `KEC Makerspace - ${booking.booking_reference}`,
          description: `Equipment: ${equipment.display_name}\nBooking reference: ${booking.booking_reference}\nReference display only. Manage bookings in the KEC Makerspace app.`,
          start: { dateTime: booking.starts_at, timeZone: 'Asia/Kathmandu' },
          end: { dateTime: booking.ends_at, timeZone: 'Asia/Kathmandu' },
          guestsCanModify: false,
          guestsCanInviteOthers: false,
          guestsCanSeeOtherGuests: false,
        };
        const path = booking.calendar_event_id ? `/${encodeURIComponent(booking.calendar_event_id)}?sendUpdates=none` : '?sendUpdates=none';
        const response = await calendarRequest(token, equipment.google_calendar_id, path, { method: booking.calendar_event_id ? 'PUT' : 'POST', body: JSON.stringify(event) });
        const result = await response.json() as { id?: string; error?: { message?: string } };
        if (!response.ok || !result.id) throw new Error(result.error?.message || `Google Calendar write failed (${response.status}).`);
        await admin.from('bookings').update({ calendar_event_id: result.id }).eq('id', booking.id);
      }

      await admin.from('calendar_sync_jobs').update({ status: 'synced', last_error: null }).eq('id', job.id);
      await admin.from('bookings').update({ calendar_sync_status: 'synced', last_calendar_sync_error: null, calendar_retry_count: job.attempt_count }).eq('id', booking.id);
      synced += 1;
    } catch (cause) {
      const message = (cause instanceof Error ? cause.message : 'Calendar sync failed.').slice(0, 1000);
      const retryMinutes = Math.min(360, 2 ** Math.min(8, Number(job.attempt_count) || 1));
      const nextAttempt = new Date(Date.now() + retryMinutes * 60_000).toISOString();
      await admin.from('calendar_sync_jobs').update({ status: 'failed', last_error: message, next_attempt_at: nextAttempt }).eq('id', job.id);
      await admin.from('bookings').update({ calendar_sync_status: 'failed', last_calendar_sync_error: message, calendar_retry_count: job.attempt_count }).eq('id', job.booking_id);
      failed += 1;
    }
  }
  return json(request, { processed: (jobs || []).length, synced, failed });
}));

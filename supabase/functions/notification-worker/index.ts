import { adminClient } from '../_shared/supabase.ts';
import { handle, HttpError, json } from '../_shared/http.ts';

function authorize(request: Request): void {
  const expected = Deno.env.get('CRON_SECRET') || '';
  const provided = request.headers.get('x-cron-secret') || '';
  if (!expected || provided !== expected) throw new HttpError(401, 'Worker authorization failed.', 'AUTH_REQUIRED');
}

Deno.serve((request) => handle(request, async () => {
  authorize(request);
  const admin = adminClient();
  const providerUrl = Deno.env.get('NOTIFICATION_PROVIDER_URL');
  const providerToken = Deno.env.get('NOTIFICATION_PROVIDER_TOKEN');
  const { data: jobs, error: claimError } = await admin.rpc('claim_notification_jobs', { p_limit: 20 });
  if (claimError) throw claimError;
  if (!providerUrl || !providerToken || Deno.env.get('NOTIFICATION_DELIVERY_ENABLED') !== 'true') {
    const ids = (jobs || []).map((job: {id: string; booking_id: string}) => job.id);
    if (ids.length) {
      await admin.from('notification_jobs').update({ status: 'not_configured', last_error: 'Notification delivery is disabled.' }).in('id', ids);
      await admin.from('bookings').update({ notification_status: 'not_configured' }).in('id', (jobs || []).map((job: {id: string; booking_id: string}) => job.booking_id));
    }
    return json(request, { processed: ids.length, status: 'not_configured' });
  }

  let sent = 0;
  let failed = 0;
  for (const job of jobs || []) {
    try {
      const { data: booking, error } = await admin
        .from('bookings')
        .select('id,booking_reference,status,starts_at,ends_at,contact_name,contact_email,equipment(display_name)')
        .eq('id', job.booking_id)
        .single();
      if (error) throw error;
      const equipment = Array.isArray(booking.equipment) ? booking.equipment[0] : booking.equipment;
      const response = await fetch(providerUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: booking.contact_email,
          template: job.notification_type,
          data: {
            name: booking.contact_name,
            bookingReference: booking.booking_reference,
            equipment: equipment?.display_name,
            startsAt: booking.starts_at,
            endsAt: booking.ends_at,
            timezone: 'Asia/Kathmandu',
            status: booking.status,
          },
        }),
      });
      if (!response.ok) throw new Error(`Notification provider returned ${response.status}.`);
      await admin.from('notification_jobs').update({ status: 'sent', last_error: null }).eq('id', job.id);
      await admin.from('bookings').update({ notification_status: 'sent' }).eq('id', booking.id);
      sent += 1;
    } catch (cause) {
      const message = (cause instanceof Error ? cause.message : 'Notification delivery failed.').slice(0, 1000);
      const retryMinutes = Math.min(360, 2 ** Math.min(8, Number(job.attempt_count) || 1));
      await admin.from('notification_jobs').update({ status: 'failed', last_error: message, next_attempt_at: new Date(Date.now() + retryMinutes * 60_000).toISOString() }).eq('id', job.id);
      await admin.from('bookings').update({ notification_status: 'failed' }).eq('id', job.booking_id);
      failed += 1;
    }
  }
  return json(request, { processed: (jobs || []).length, sent, failed });
}));

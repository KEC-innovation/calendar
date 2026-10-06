import { describe, expect, it, vi } from 'vitest';
import { calendarEvent, calendarEventId, syncCalendarEvent } from '../supabase/functions/_shared/calendarEvents';
const booking = {
  id: '00000000-0000-4000-8000-000000000001', booking_reference: 'KEC-TEST-001',
  contact_name: 'Synthetic trainee', status: 'confirmed',
  starts_at: '2026-10-07T05:15:00Z', ends_at: '2026-10-07T06:15:00Z',
};
const eventId = calendarEventId(booking.id);
function sender(...responses: Response[]) {
  const send = vi.fn<typeof fetch>();
  for (const response of responses) send.mockResolvedValueOnce(response);
  return send;
}
const ok = (id = eventId) => Response.json({ id });
describe('Google Calendar mirror', () => {
  it('creates a readable Nepal-time event and omits names unless enabled', () => {
    const event = calendarEvent(booking, 'Bambu A1');
    expect(event.summary).toContain('Bambu A1');
    expect(event.summary).not.toContain(booking.contact_name);
    expect(calendarEvent(booking, 'Bambu A1', true).summary).toContain(booking.contact_name);
    expect(event.start).toEqual({ dateTime: booking.starts_at, timeZone: 'Asia/Kathmandu' });
    expect(event).not.toHaveProperty('attendees');
    expect(eventId).toMatch(/^[0-9a-v]{5,1024}$/);
  });
  it('retry after successful insertion updates the same deterministic event', async () => {
    const send = sender(new Response('', { status: 409 }), ok());
    expect(await syncCalendarEvent('fake', 'calendar@example.invalid', booking, 'Bambu A1', false, send)).toBe(eventId);
    expect(send.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body)).id).toBe(eventId);
    expect(send.mock.calls[1]?.[1]?.method).toBe('PUT');
    expect(String(send.mock.calls[1]?.[0])).toContain(eventId);
  });
  it('updates the stored legacy event instead of creating another', async () => {
    const send = sender(ok('legacy123'));
    await syncCalendarEvent('fake', 'calendar', { ...booking, calendar_event_id: 'legacy123' }, 'Bambu', false, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0]?.[0])).toContain('/legacy123?');
    expect(send.mock.calls[0]?.[1]?.method).toBe('PUT');
  });
  it('recreates an externally missing event with the same ID', async () => {
    const send = sender(new Response('', { status: 404 }), ok('legacy123'));
    await syncCalendarEvent('fake', 'calendar', { ...booking, calendar_event_id: 'legacy123' }, 'Bambu', false, send);
    expect(send.mock.calls[1]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(send.mock.calls[1]?.[1]?.body)).id).toBe('legacy123');
  });
  it.each([204, 404, 410])('cancellation handles HTTP %s even without saved event ID', async status => {
    const send = sender(new Response(null, { status }));
    await syncCalendarEvent('fake', 'calendar', { ...booking, status: 'cancelled' }, 'Bambu', false, send);
    expect(send.mock.calls[0]?.[1]?.method).toBe('DELETE');
    expect(String(send.mock.calls[0]?.[0])).toContain(eventId);
  });
  it('surfaces denied calendar access so the queue can retry', async () => {
    const send = sender(Response.json({ error: { message: 'Forbidden' } }, { status: 403 }));
    await expect(syncCalendarEvent('fake', 'calendar', booking, 'Bambu', false, send)).rejects.toThrow('Forbidden');
  });
});

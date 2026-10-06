export interface CalendarBooking {
  id: string;
  booking_reference: string;
  status: string;
  starts_at: string;
  ends_at: string;
  contact_name?: string | null;
  calendar_event_id?: string | null;
}

export function calendarEventId(bookingId: string): string {
  // Lowercase hex is a subset of Google's base32hex event-ID alphabet.
  return `kec${bookingId.replace(/-/g, '').toLowerCase()}`;
}

export function calendarEvent(booking: CalendarBooking, equipmentName: string, includeNames = false) {
  const name = includeNames && booking.contact_name ? ` — ${booking.contact_name}` : '';
  return {
    summary: `${equipmentName}${name} · ${booking.booking_reference}`,
    description: `Equipment: ${equipmentName}\nStatus: ${booking.status}\nBooking reference: ${booking.booking_reference}\nManage bookings in the KEC Makerspace app.`,
    status: 'confirmed',
    start: { dateTime: booking.starts_at, timeZone: 'Asia/Kathmandu' },
    end: { dateTime: booking.ends_at, timeZone: 'Asia/Kathmandu' },
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    guestsCanSeeOtherGuests: false,
    extendedProperties: { private: { kecBookingId: booking.id } },
  };
}

export async function syncCalendarEvent(
  token: string, calendarId: string, booking: CalendarBooking, equipmentName: string,
  includeNames = false, send: typeof fetch = fetch,
): Promise<string> {
  const id = booking.calendar_event_id || calendarEventId(booking.id);
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const request = (path: string, method: string, body?: unknown) => send(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (booking.status === 'cancelled') {
    // Also delete a deterministic ID if the previous insert succeeded but DB writeback failed.
    const response = await request(`/${encodeURIComponent(id)}?sendUpdates=none`, 'DELETE');
    if (!response.ok && ![404, 410].includes(response.status)) {
      throw new Error(`Google Calendar delete failed (${response.status}).`);
    }
    return id;
  }
  const event = calendarEvent(booking, equipmentName, includeNames);
  let response: Response;
  if (booking.calendar_event_id) {
    response = await request(`/${encodeURIComponent(id)}?sendUpdates=none`, 'PUT', event);
    if (response.status === 404) response = await request('?sendUpdates=none', 'POST', { ...event, id });
  } else {
    response = await request('?sendUpdates=none', 'POST', { ...event, id });
  }
  // Retrying after an insert/writeback interruption updates the same event.
  if (response.status === 409) response = await request(`/${encodeURIComponent(id)}?sendUpdates=none`, 'PUT', event);
  const result = await response.json() as { id?: string; error?: { message?: string } };
  if (!response.ok || !result.id) throw new Error(result.error?.message || `Google Calendar write failed (${response.status}).`);
  return result.id;
}

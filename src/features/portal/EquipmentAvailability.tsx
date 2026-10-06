import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { buildDayTimeline, calendarWeek, nepalInputValue, selectedRangeIssue, shiftDate } from '../../lib/availabilityTimeline';
import type { AvailabilityResult } from '../../types/domain';

interface Props {
  equipmentId: string;
  equipmentName: string;
  date: string;
  start: string;
  end: string;
  maxMinutes: number;
  revision: number;
  onDateChange: (date: string) => void;
  onChoose: (start: string, end: string) => void;
}
const clock = (value: string) => new Intl.DateTimeFormat('en-NP', { timeZone: 'Asia/Kathmandu', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const dayLabel = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-NP', { timeZone: 'UTC', ...options }).format(new Date(`${date}T12:00:00Z`));

export function EquipmentAvailability({ equipmentId, equipmentName, date, start, end, maxMinutes, revision, onDateChange, onChoose }: Props) {
  const [result, setResult] = useState<AvailabilityResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    void api.availability(equipmentId, date).then(data => {
      if (live) { setResult(data); setCheckedAt(new Date()); setLoading(false); }
    }).catch(cause => { if (live) { setError(cause instanceof Error ? cause.message : 'Availability could not be loaded.'); setLoading(false); } });
    return () => { live = false; };
  }, [equipmentId, date, revision, refresh]);
  useEffect(() => {
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') setRefresh(value => value + 1); }, 60_000);
    const visible = () => { if (document.visibilityState === 'visible') setRefresh(value => value + 1); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, []);
  const data = result?.equipmentId === equipmentId && result.date === date && !error ? result : null;
  const today = nepalInputValue(new Date()).slice(0, 10);
  const days = calendarWeek(date);
  const timeline = data ? buildDayTimeline(data) : [];
  const issue = data?.openingHours ? selectedRangeIssue(data, start, end, maxMinutes) : null;
  const hours = data?.openingHours;
  return <section className="equipment-availability" aria-label={`${equipmentName} availability`} aria-busy={loading}>
    <div className="availability-heading"><div><h3>{equipmentName} availability</h3><p>Choose a date, then select a free block to fill your booking times. You can adjust the end time.</p></div><button type="button" className="button button--secondary button--small" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh availability</button></div>
    <div className="availability-navigation"><button type="button" aria-label="Previous week" className="button button--secondary button--small" disabled={(days[0] || date) <= (calendarWeek(today)[0] || today)} onClick={() => onDateChange(shiftDate(date, -7))}>‹</button><strong>{dayLabel(date, { month: 'long', year: 'numeric' })}</strong><button type="button" aria-label="Next week" className="button button--secondary button--small" onClick={() => onDateChange(shiftDate(date, 7))}>›</button><label className="field">View date (Nepal)<input type="date" min={today} value={date} onChange={event => { if (event.target.value) onDateChange(event.target.value); }} /></label></div>
    <div className="availability-week" aria-label="Dates">{days.map(day => <button type="button" key={day} disabled={day < today} aria-pressed={day === date} aria-label={dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} onClick={() => onDateChange(day)}><span>{dayLabel(day, { weekday: 'short' })}</span><strong>{Number(day.slice(-2))}</strong></button>)}</div>
    <div className="availability-day-heading"><strong>{dayLabel(date, { weekday: 'long', day: 'numeric', month: 'long' })}</strong><span>All times Nepal time</span></div>
    {loading && <p role="status">{data ? 'Refreshing availability…' : 'Loading this equipment’s availability…'}</p>}
    {error && <p role="alert" className="alert alert--error">{error} Use Refresh availability to try again.</p>}
    {!loading && data && !hours && <p role="status">Opening hours could not be loaded. Refresh availability or ask staff.</p>}
    {data && hours && <>
      <div className="availability-legend"><span className="availability-key availability-key--free">Free</span><span className="availability-key availability-key--reserved">Reserved</span><span className="availability-key availability-key--closed">Closed / started</span></div>
      {data.closureReason || !hours.bookable ? <p className="alert" role="status">Closed for booking{data.closureReason ? `: ${data.closureReason}` : ' on this date.'}</p> : <>
        <p className="availability-hours">Open {clock(`${date}T${hours.openTime}+05:45`)} – {clock(`${date}T${hours.closeTime}+05:45`)}</p>
        <div className="availability-blocks">{timeline.map(block => {
          const selected = new Date(block.startsAt).getTime() === new Date(`${start}+05:45`).getTime();
          const label = block.status === 'past' ? 'Started' : block.status === 'free' ? 'Free' : block.status === 'reserved' ? 'Reserved' : 'Closed';
          return <button type="button" key={block.startsAt} className={`availability-block availability-block--${block.status}${selected ? ' availability-block--selected' : ''}`} disabled={block.status !== 'free' || loading} aria-pressed={selected} aria-label={`${clock(block.startsAt)} to ${clock(block.endsAt)}, ${label}`} title={block.reason} onClick={() => {
            const endTime = new Date(Math.min(new Date(block.endsAt).getTime(), new Date(block.startsAt).getTime() + maxMinutes * 60_000)).toISOString();
            onChoose(nepalInputValue(block.startsAt), nepalInputValue(endTime));
          }}><strong>{clock(block.startsAt)} – {clock(block.endsAt)}</strong><span>{label}{block.reason ? ` · ${block.reason}` : ''}</span></button>;
        })}</div>
        {timeline.length > 0 && !timeline.some(block => block.status === 'free') && <p role="status">No free blocks remain on this date. Choose another date.</p>}
      </>}
      {!loading && <p className={issue ? 'availability-selection availability-selection--warning' : 'availability-selection'} role="status">{issue || 'Your selected time is free in the latest availability check.'}</p>}
      <p className="availability-note">Reservations refresh every minute. Your booking is checked again when you confirm.{checkedAt ? ` Last checked ${clock(checkedAt.toISOString())}.` : ''}</p>
    </>}
  </section>;
}

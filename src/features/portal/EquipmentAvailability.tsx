import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { buildDayTimeline, chooseInterval, calendarWeek, nepalInputValue, selectedRangeIssue, shiftDate } from '../../lib/availabilityTimeline';
import type { AvailabilityCache } from '../../lib/availabilityCache';
import type { AvailabilityResult } from '../../types/domain';

interface Props {
  cache: AvailabilityCache;
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
const clockFormatter = new Intl.DateTimeFormat('en-NP', { timeZone: 'Asia/Kathmandu', hour: 'numeric', minute: '2-digit' });
const clock = (value: string) => clockFormatter.format(new Date(value));
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const dayLabel = (date: string, options: Intl.DateTimeFormatOptions) => {
  const key = JSON.stringify(options);
  let formatter = dateFormatters.get(key);
  if (!formatter) { formatter = new Intl.DateTimeFormat('en-NP', { timeZone: 'UTC', ...options }); dateFormatters.set(key, formatter); }
  return formatter.format(new Date(`${date}T12:00:00Z`));
};

export function EquipmentAvailability({ cache, equipmentId, equipmentName, date, start, end, maxMinutes, revision, onDateChange, onChoose }: Props) {
  const [anchor,setAnchor]=useState<{start:string;end:string;equipmentId:string;date:string}|null>(null);
  const [rangeError,setRangeError]=useState('');
  const [result, setResult] = useState<AvailabilityResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  useEffect(()=>{setRangeError('');},[start,end,equipmentId,date]);
  const lastRefresh = useRef(refresh);
  useEffect(() => {
    let live = true;
    const force = lastRefresh.current !== refresh;
    lastRefresh.current = refresh;
    const cached = force ? null : cache.get(equipmentId, date, revision);
    setError('');
    if (cached) { setResult(cached.data); setCheckedAt(cached.checkedAt); setLoading(false); return; }
    setLoading(true);
    void api.availability(equipmentId, date).then(data => {
      if (live) { const checked = new Date(); cache.set(data, revision, checked); setResult(data); setCheckedAt(checked); setLoading(false); }
    }).catch(cause => { if (live) { cache.forget(equipmentId, date); setError(cause instanceof Error ? cause.message : 'Availability could not be loaded.'); setLoading(false); } });
    return () => { live = false; };
  }, [cache, equipmentId, date, revision, refresh]);
  useEffect(() => {
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') setRefresh(value => value + 1); }, 60_000);
    const visible = () => { if (document.visibilityState === 'visible') setRefresh(value => value + 1); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, []);
  const data = result?.equipmentId === equipmentId && result.date === date && !error ? result : null;
  const today = nepalInputValue(new Date()).slice(0, 10);
  const days = useMemo(() => calendarWeek(date), [date]);
  const timeline = useMemo(() => data ? buildDayTimeline(data) : [], [data, refresh]);
  const issue = data?.openingHours ? selectedRangeIssue(data, start, end, maxMinutes) : null;
  const hours = data?.openingHours;
  return <section className="equipment-availability" aria-label={`${equipmentName} availability`} aria-busy={loading}>
    <div className="availability-heading"><div><h3>{equipmentName} availability</h3><p>Click the first free block, then the last block to book the time between them. The typed start and end fields remain available.</p></div><button type="button" className="button button--secondary button--small" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh availability</button></div>
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
          const selected = new Date(block.startsAt).getTime() >= new Date(`${start}+05:45`).getTime() && new Date(block.endsAt).getTime() <= new Date(`${end}+05:45`).getTime();
          const label = block.status === 'past' ? 'Started' : block.status === 'free' ? 'Free' : block.status === 'reserved' ? 'Reserved' : 'Closed';
          return <button type="button" key={block.startsAt} className={`availability-block availability-block--${block.status}${selected ? ' availability-block--selected' : ''}`} disabled={block.status !== 'free' || loading} aria-pressed={selected} aria-label={`${clock(block.startsAt)} to ${clock(block.endsAt)}, ${label}`} title={block.reason} onClick={() => {
            const pending=anchor&&anchor.equipmentId===equipmentId&&anchor.date===date&&anchor.start===start&&anchor.end===end;
            if(pending){const range=chooseInterval(data,{startsAt:`${anchor.start}+05:45`,endsAt:`${anchor.end}+05:45`},block,maxMinutes);if(range.issue){setRangeError(range.issue);return;}onChoose(range.start,range.end);setAnchor(null);setRangeError('');}
            else{const first=nepalInputValue(block.startsAt),last=nepalInputValue(block.endsAt);onChoose(first,last);setAnchor({start:first,end:last,equipmentId,date});setRangeError('');}
          }}><strong>{clock(block.startsAt)} – {clock(block.endsAt)}</strong><span>{label}{block.reason ? ` · ${block.reason}` : ''}</span></button>;
        })}</div>
        {anchor&&anchor.equipmentId===equipmentId&&anchor.date===date&&anchor.start===start&&anchor.end===end&&<p role="status">Start selected. Click the last free block to finish your range, or click the same block for 30 minutes.</p>}
        {rangeError&&<p role="alert" className="alert alert--error">{rangeError}</p>}
        {timeline.length > 0 && !timeline.some(block => block.status === 'free') && <p role="status">No free blocks remain on this date. Choose another date.</p>}
      </>}
      {!loading && <p className={issue ? 'availability-selection availability-selection--warning' : 'availability-selection'} role="status">{issue || 'Your selected time is free in the latest availability check.'}</p>}
      <p className="availability-note">Reservations refresh every minute. Your booking is checked again when you confirm.{checkedAt ? ` Last checked ${clock(checkedAt.toISOString())}.` : ''}</p>
    </>}
  </section>;
}

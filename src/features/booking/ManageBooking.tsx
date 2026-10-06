import { useState } from 'react';
import { AlertTriangle, Check, ChevronLeft } from 'lucide-react';
import { api } from '../../lib/api';
import { Brand } from '../../components/Brand';
import { Spinner } from '../../components/Spinner';

export function ManageBooking({ reference, token }: { reference: string; token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cancelled, setCancelled] = useState<{ lateCancellation: boolean } | null>(null);

  async function cancel() {
    if (!reference || !token) {
      setError('This management link is incomplete.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      setCancelled(await api.cancelBooking(reference, token));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The booking could not be cancelled.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="simple-shell">
      <header><Brand /><a className="text-link" href="#/"><ChevronLeft size={16} /> Booking</a></header>
      <section className="simple-card">
        {cancelled ? (
          <div className="confirmation">
            <div className="confirmation__icon"><Check size={28} /></div>
            <h1>Booking cancelled</h1>
            <p>{cancelled.lateCancellation ? 'This was within two hours of the slot and has been recorded as a late cancellation.' : 'The equipment is available for someone else again.'}</p>
            <a className="button button--primary" href="#/">Return to booking</a>
          </div>
        ) : (
          <>
            <p className="eyebrow">Manage booking</p>
            <h1>{reference || 'Booking reference missing'}</h1>
            <div className="alert alert--warning"><AlertTriangle size={18} /><span>Cancelling less than 2 hours before the slot is recorded as a late cancellation.</span></div>
            {error && <div className="alert alert--error" role="alert">{error}</div>}
            <button className="button button--danger" type="button" onClick={() => void cancel()} disabled={busy}>{busy ? <Spinner label="Cancelling" /> : 'Cancel this booking'}</button>
          </>
        )}
      </section>
    </main>
  );
}

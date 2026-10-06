import { useEffect } from 'react';

export interface ToastMessage {
  type: 'success' | 'error' | 'info';
  text: string;
}

export function Toast({ message, onDismiss }: { message: ToastMessage | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);
  if (!message) return null;
  return (
    <div className={`toast toast--${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>
      <span>{message.text}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss message">×</button>
    </div>
  );
}

export function StatusBadge({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'neutral'; children: React.ReactNode }) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}

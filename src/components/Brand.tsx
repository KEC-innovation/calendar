export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a className={`brand ${compact ? 'brand--compact' : ''}`} href="#/" aria-label="KEC Makerspace home">
      <span className="brand__mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span>
        <strong>KEC</strong>
        <b>Makerspace</b>
      </span>
    </a>
  );
}

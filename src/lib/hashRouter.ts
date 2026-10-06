import { useEffect, useMemo, useState } from 'react';

export interface HashRoute {
  path: string;
  query: URLSearchParams;
}

function currentRoute(): HashRoute {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path = '/', query = ''] = raw.split('?');
  return { path: path.startsWith('/') ? path : `/${path}`, query: new URLSearchParams(query) };
}

export function useHashRoute(): HashRoute {
  const [raw, setRaw] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setRaw(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return useMemo(currentRoute, [raw]);
}

export function navigate(path: string): void {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (window.location.hash === `#${normalized}`) return;
  window.location.hash = normalized;
}

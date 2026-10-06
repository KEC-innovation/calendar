const DEFAULT_LOCAL_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  const configured = (Deno.env.get('ALLOWED_ORIGINS') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowed = new Set(configured);
  if (Deno.env.get('ENVIRONMENT') !== 'production') {
    for (const local of DEFAULT_LOCAL_ORIGINS) allowed.add(local);
  }
  const acceptedOrigin = origin && allowed.has(origin) ? origin : configured[0] || '';
  return {
    'Access-Control-Allow-Origin': acceptedOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function assertOriginAllowed(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const configured = (Deno.env.get('ALLOWED_ORIGINS') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.includes(origin)) return;
  if (Deno.env.get('ENVIRONMENT') !== 'production' && DEFAULT_LOCAL_ORIGINS.has(origin)) return;
  throw new Error('ORIGIN_NOT_ALLOWED');
}

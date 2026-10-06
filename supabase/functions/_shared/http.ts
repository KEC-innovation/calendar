import { assertOriginAllowed, corsHeaders } from './cors.ts';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'REQUEST_FAILED',
  ) {
    super(message);
  }
}

export function json(request: Request, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function readJson(request: Request, maxBytes = 80_000): Promise<Record<string, unknown>> {
  const size = Number(request.headers.get('content-length') || '0');
  if (size > maxBytes) throw new HttpError(413, 'Request is too large.', 'PAYLOAD_TOO_LARGE');
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.', 'INVALID_JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Request body must be a JSON object.', 'INVALID_BODY');
  }
  return value as Record<string, unknown>;
}

export async function handle(
  request: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  try {
    assertOriginAllowed(request);
    if (request.method !== 'POST') throw new HttpError(405, 'Only POST requests are accepted.', 'METHOD_NOT_ALLOWED');
    return await handler();
  } catch (cause) {
    if (cause instanceof HttpError) return json(request, { error: cause.message, code: cause.code }, cause.status);
    const message = cause instanceof Error ? cause.message : 'Unexpected request failure.';
    if (message === 'ORIGIN_NOT_ALLOWED') return json(request, { error: 'Origin is not allowed.', code: message }, 403);
    console.error(cause);
    return json(request, { error: 'The request could not be completed.', code: 'INTERNAL_ERROR' }, 500);
  }
}

export function text(value: unknown, maxLength = 500): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function requiredText(value: unknown, label: string, maxLength = 500): string {
  const result = text(value, maxLength);
  if (!result) throw new HttpError(400, `${label} is required.`, 'VALIDATION_ERROR');
  return result;
}

export function requireUuid(value: unknown, label: string): string {
  const result = text(value, 50);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new HttpError(400, `${label} is invalid.`, 'VALIDATION_ERROR');
  }
  return result;
}

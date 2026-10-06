import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.115.0';
import { HttpError } from './http.ts';

export function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeIdentityPart(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function identityFingerprint(
  category: string,
  email: string,
  rollNumber: string,
  organization: string,
): Promise<string> {
  const salt = Deno.env.get('IDENTITY_FINGERPRINT_SALT') || Deno.env.get('RATE_LIMIT_SALT');
  if (!salt) throw new Error('Missing server configuration: IDENTITY_FINGERPRINT_SALT');
  return sha256([salt, category, normalizeEmail(email), normalizeIdentityPart(rollNumber), normalizeIdentityPart(organization)].join('|'));
}

export function randomToken(bytes = 32): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function consumeRateLimit(
  admin: SupabaseClient,
  request: Request,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const clientAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('cf-connecting-ip')
    || 'unavailable';
  const salt = Deno.env.get('RATE_LIMIT_SALT');
  if (!salt) throw new Error('Missing server configuration: RATE_LIMIT_SALT');
  const key = await sha256(`${salt}|${bucket}|${clientAddress}`);
  const { data, error } = await admin.rpc('consume_rate_limit', {
    p_bucket_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw error;
  if (!data) throw new HttpError(429, 'Too many requests. Wait a few minutes and try again.', 'RATE_LIMITED');
}

export function safeEmail(value: unknown): string {
  const email = normalizeEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new HttpError(400, 'Enter a valid email address.', 'VALIDATION_ERROR');
  }
  return email;
}

export function shuffle<T>(values: T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    const target = random % (index + 1);
    [result[index], result[target]] = [result[target] as T, result[index] as T];
  }
  return result;
}

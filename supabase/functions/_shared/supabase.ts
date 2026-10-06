import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.115.0';
import { HttpError } from './http.ts';

function requiredEnv(name: string, fallback?: string): string {
  const value = Deno.env.get(name) || (fallback ? Deno.env.get(fallback) : undefined);
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

export function adminClient(): SupabaseClient {
  return createClient(
    requiredEnv('SUPABASE_URL'),
    requiredEnv('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function userClient(request: Request): SupabaseClient {
  const authorization = request.headers.get('authorization') || '';
  return createClient(
    requiredEnv('SUPABASE_URL'),
    requiredEnv('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'),
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function requireStaff(
  request: Request,
  minimum: 'viewer' | 'trainer' | 'admin' | 'owner' = 'viewer',
): Promise<{ userId: string; email: string; displayName: string; role: 'viewer' | 'trainer' | 'admin' | 'owner'; capabilities: string[] | null }> {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Staff sign-in is required.', 'AUTH_REQUIRED');
  const admin = adminClient();
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new HttpError(401, 'Staff session is invalid or expired.', 'AUTH_INVALID');
  const { data: roleData, error: roleError } = await admin
    .from('staff_roles')
    .select('role, display_name, active, capabilities')
    .eq('user_id', userData.user.id)
    .single();
  if (roleError || !roleData?.active) throw new HttpError(403, 'Staff access is inactive.', 'STAFF_INACTIVE');
  const ranks = { viewer: 10, trainer: 20, admin: 30, owner: 40 } as const;
  const role = roleData.role as keyof typeof ranks;
  if (ranks[role] < ranks[minimum]) throw new HttpError(403, `${minimum[0]?.toUpperCase()}${minimum.slice(1)} role required.`, 'ROLE_REQUIRED');
  return {
    userId: userData.user.id,
    email: userData.user.email || '',
    displayName: String(roleData.display_name),
    role,
    capabilities: roleData.capabilities,
  };
}

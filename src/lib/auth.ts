import { getSupabase, isMockMode } from './supabase';
import type { StaffSession } from '../types/domain';

interface MockAuthModule {
  mockSignIn(email: string, password: string): Promise<StaffSession>;
  mockDemoSignIn(): Promise<StaffSession>;
}

export async function signIn(email: string, password: string): Promise<StaffSession> {
  if (isMockMode()) {
    const mockModulePath = './mockApi.ts';
    const { mockSignIn } = await import(/* @vite-ignore */ mockModulePath) as unknown as MockAuthModule;
    return mockSignIn(email, password);
  }
  const client = getSupabase();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) throw new Error(error?.message || 'Sign-in failed.');
  const { data: roleData, error: roleError } = await client
    .from('staff_roles')
    .select('role, display_name, active, capabilities')
    .eq('user_id', data.user.id)
    .single();
  if (roleError || !roleData?.active) {
    await client.auth.signOut();
    throw new Error('This account does not have active Makerspace staff access.');
  }
  return {
    accessToken: data.session.access_token,
    userId: data.user.id,
    email: data.user.email || email,
    displayName: String(roleData.display_name || data.user.email || 'Staff'),
    role: roleData.role as StaffSession['role'],
    capabilities: roleData.capabilities as string[] | null,
  };
}

export async function restoreSession(): Promise<StaffSession | null> {
  if (isMockMode()) {
    const raw = sessionStorage.getItem('kec-mock-session');
    return raw ? (JSON.parse(raw) as StaffSession) : null;
  }
  const client = getSupabase();
  const { data } = await client.auth.getSession();
  if (!data.session?.user) return null;
  const { data: roleData } = await client
    .from('staff_roles')
    .select('role, display_name, active, capabilities')
    .eq('user_id', data.session.user.id)
    .single();
  if (!roleData?.active) return null;
  return {
    accessToken: data.session.access_token,
    userId: data.session.user.id,
    email: data.session.user.email || '',
    displayName: String(roleData.display_name || data.session.user.email || 'Staff'),
    role: roleData.role as StaffSession['role'],
    capabilities: roleData.capabilities as string[] | null,
  };
}

export async function signInDemo(): Promise<StaffSession> {
  if (!isMockMode()) throw new Error('Demo sign-in is available only in the local preview.');
  const mockModulePath = './mockApi.ts';
  const { mockDemoSignIn } = await import(/* @vite-ignore */ mockModulePath) as unknown as MockAuthModule;
  return mockDemoSignIn();
}

export async function signOut(): Promise<void> {
  if (isMockMode()) {
    sessionStorage.removeItem('kec-mock-session');
    return;
  }
  await getSupabase().auth.signOut();
}

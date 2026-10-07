import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { id: 'test-owner', email: 'owner@example.invalid', email_confirmed_at: '2026-10-07', factors: [] as Array<{ status: string }> },
  authError: false, active: true, role: 'owner', passwordChangeRequired: false,
}));
vi.mock('npm:@supabase/supabase-js@2.115.0', () => ({
  createClient: () => ({
    auth: { getUser: async (token: string) => ({ data: { user: state.authError || token !== 'auth-verified-password-token' ? null : state.user }, error: state.authError ? new Error('Invalid token') : null }) },
    from: (table: string) => {
      const result = {
        select: () => result, eq: () => result,
        single: async () => ({ data: { role: state.role, active: state.active, display_name: 'Staff', capabilities: null, training_certification_type_ids: null }, error: null }),
        maybeSingle: async () => ({ data: table === 'account_security' ? { password_change_required: state.passwordChangeRequired } : null, error: null }),
      };
      return result;
    },
  }),
}));
let requireStaff: (request: Request, minimum?: 'viewer' | 'owner') => Promise<unknown>;
let requireAccount: (request: Request, allowPasswordChange?: boolean) => Promise<unknown>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: () => 'synthetic-test-config' } });
  const staffPath = '../supabase/functions/_shared/supabase.ts';
  const accountPath = '../supabase/functions/_shared/accounts.ts';
  requireStaff = (await import(staffPath)).requireStaff;
  requireAccount = (await import(accountPath)).requireAccount;
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  state.user.email_confirmed_at = '2026-10-07'; state.user.factors = [];
  state.authError = false; state.active = true; state.role = 'owner'; state.passwordChangeRequired = false;
});
const request = (token = 'auth-verified-password-token') => new Request('https://backend.example.invalid', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
describe('interim staff password authentication with real shared guards', () => {
  it('accepts an Auth-verified Owner without authenticator enrollment', async () => {
    await expect(requireStaff(request(), 'owner')).resolves.toMatchObject({ role: 'owner' });
  });
  it('accepts password sessions with a previously enrolled authenticator', async () => {
    state.user.factors = [{ status: 'verified' }];
    await expect(requireStaff(request(), 'owner')).resolves.toMatchObject({ role: 'owner' });
    await expect(requireAccount(request())).resolves.toHaveProperty('user.id', 'test-owner');
  });
  it('rejects missing and forged sessions through Auth verification', async () => {
    await expect(requireStaff(request(''))).rejects.toMatchObject({ status: 401 });
    await expect(requireStaff(request('forged'))).rejects.toMatchObject({ status: 401 });
    await expect(requireAccount(request('forged'))).rejects.toMatchObject({ status: 401 });
  });
  it('rejects expired or revoked sessions', async () => {
    state.authError = true;
    await expect(requireStaff(request())).rejects.toMatchObject({ status: 401 });
    await expect(requireAccount(request())).rejects.toMatchObject({ status: 401 });
  });
  it('keeps confirmed-email requirements', async () => {
    state.user.email_confirmed_at = '';
    await expect(requireStaff(request())).rejects.toMatchObject({ status: 401 });
    await expect(requireAccount(request())).rejects.toMatchObject({ status: 401 });
  });
  it('keeps inactive staff blocked', async () => {
    state.active = false;
    await expect(requireStaff(request())).rejects.toMatchObject({ status: 403 });
  });
  it('does not promote a Trainer to Owner or accept invented roles', async () => {
    state.role = 'trainer';
    await expect(requireStaff(request(), 'owner')).rejects.toMatchObject({ status: 403 });
    state.role = 'participant';
    await expect(requireStaff(request())).rejects.toMatchObject({ status: 403 });
  });
  it('keeps initial-password changes mandatory except on the change/status path', async () => {
    state.passwordChangeRequired = true;
    await expect(requireAccount(request())).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    await expect(requireAccount(request(), true)).resolves.toHaveProperty('security.password_change_required', true);
  });
});

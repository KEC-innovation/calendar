import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  actor: { userId: '00000000-0000-4000-8000-000000000001', role: 'trainer', displayName: 'Trainer', capabilities: ['training'], trainingCertificationTypeIds: ['00000000-0000-4000-8000-000000000002'] as string[] | null },
  tables: {} as Record<string, Row[]>, rpcCalls: [] as Array<{ name: string; args: Row }>,
}));
function query(table: string) {
  let rows = [...(state.tables[table] ?? [])]; let single = false;
  const result = {
    select: () => result, order: () => result, limit: () => result,
    eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return result; },
    maybeSingle: () => { single = true; return result; },
    then: (resolve: (value: { data: Row[] | Row | null; error: null }) => unknown) => Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows, error: null })),
  };
  return result;
}
vi.mock('../supabase/functions/_shared/supabase.ts', () => ({
  requireStaff: async () => state.actor,
  adminClient: () => ({
    from: query,
    auth: { getUser: async () => ({ data: { user: { id: state.actor.userId, email_confirmed_at: '2026-01-01' } }, error: null }) },
    rpc: async (name: string, args: Row) => { state.rpcCalls.push({ name, args }); return { data: true, error: null }; },
  }),
  userClient: () => ({}),
}));
vi.mock('../supabase/functions/_shared/audit.ts', () => ({ writeAudit: async () => undefined }));
let handler: (request: Request) => Promise<Response>;
const firstType = '00000000-0000-4000-8000-000000000002';
const secondType = '00000000-0000-4000-8000-000000000003';
const quiz = '00000000-0000-4000-8000-000000000004';
beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: (key: string) => key === 'RATE_LIMIT_SALT' ? 'synthetic-unit-test-salt' : undefined }, serve: (callback: typeof handler) => { handler = callback; } });
  // Import the real request handler after installing the test-only Deno adapter.
  const modulePath = '../supabase/functions/portal-api/index.ts';
  await import(modulePath);
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  state.actor.role = 'trainer'; state.actor.capabilities = ['training']; state.actor.trainingCertificationTypeIds = [firstType]; state.rpcCalls.length = 0;
  state.tables = {
    people: [], certification_types: [{ id: firstType, active: true }, { id: secondType, active: true }],
    quizzes: [{ id: quiz, active: true, quiz_certification_mappings: [{ certification_type_id: firstType }, { certification_type_id: secondType }] }],
    training_sessions: [{ id: 'own', trainer_user_id: state.actor.userId }, { id: 'other', trainer_user_id: 'someone-else' }],
    manual_training_records: [{ id: 'own', recorded_by: state.actor.userId }, { id: 'other', recorded_by: 'someone-else' }],
  };
});
const invoke = (body: Row) => handler(new Request('https://backend.example.invalid/functions/v1/portal-api', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-token' }, body: JSON.stringify(body) }));
describe('real portal permission boundary with synthetic database responses', () => {
  it('returns only authorized training types and the focused trainer’s own history', async () => {
    const response = await invoke({ action: 'workspace', role: 'owner', trainingCertificationTypeIds: null });
    expect(response.status).toBe(200);
    const data = await response.json() as { types: Row[]; quizzes: { quiz_certification_mappings: Row[] }[]; sessions: Row[]; manual: Row[] };
    expect(data.types.map(row => row.id)).toEqual([firstType]);
    expect(data.quizzes[0]?.quiz_certification_mappings).toEqual([{ certification_type_id: firstType }]);
    expect(data.sessions.map(row => row.id)).toEqual(['own']); expect(data.manual.map(row => row.id)).toEqual(['own']);
  });
  it('rejects unassigned QR certification even when a client claims broad authority', async () => {
    const response = await invoke({ action: 'training.open', quizId: quiz, certificationTypeId: secondType, role: 'owner', capabilities: ['training'], trainingCertificationTypeIds: null });
    expect(response.status).toBe(403);
    expect(state.rpcCalls.filter(call => call.name !== 'consume_rate_limit')).toHaveLength(0);
  });
  it('Admin retains all training types and can review all session history', async () => {
    state.actor.role = 'admin'; state.actor.capabilities = []; state.actor.trainingCertificationTypeIds = [];
    const response = await invoke({ action: 'workspace' }); const data = await response.json() as { types: Row[]; sessions: Row[] };
    expect(response.status).toBe(200); expect(data.types).toHaveLength(2); expect(data.sessions).toHaveLength(2);
  });
  it('Admin cannot assign staff duties by claiming Owner in the payload', async () => {
    state.actor.role = 'admin';
    const response = await invoke({ action: 'staff.capabilities', role: 'owner', userId: state.actor.userId, capabilities: ['access'] });
    expect(response.status).toBe(403);
    expect(state.rpcCalls.filter(call => call.name === 'update_staff_access')).toHaveLength(0);
  });
  it('Owner assignment supplies the server actor, scope and review note to the atomic RPC', async () => {
    state.actor.role = 'owner';
    const response = await invoke({ action: 'staff.capabilities', actor: 'forged', userId: secondType, capabilities: ['training'], trainingCertificationTypeIds: [firstType], reason: 'Verified practical trainer eligibility.' });
    expect(response.status).toBe(200);
    expect(state.rpcCalls.find(call => call.name === 'update_staff_access')?.args).toEqual({ p_actor: state.actor.userId, p_user: secondType, p_mode: 'responsibilities', p_capabilities: ['training'], p_training_type_ids: [firstType], p_reason: 'Verified practical trainer eligibility.' });
  });
});

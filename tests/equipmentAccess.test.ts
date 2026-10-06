import { describe, expect, it } from 'vitest';
import { evaluateEquipmentAccess } from '../supabase/functions/_shared/equipmentAccess';

const person = { active: true, booking_privilege_active: true, safety_training_status: 'verified', waiver_status: 'verified', minor_status: 'adult' };
const base = { person, requiredCertifications: ['printing'], activeCertifications: ['printing'], status: 'active', bookingEnabled: true, external: false, externalAllowed: false };

describe('existing equipment training', () => {
  it('lets a previously certified and verified person book without a new quiz', () => {
    expect(evaluateEquipmentAccess(base)).toMatchObject({ visible: true, certified: true, eligible: true });
  });
  it.each(['unknown', 'pending', 'revoked'])('preserves training when waiver is %s', (waiver_status) => {
    expect(evaluateEquipmentAccess({ ...base, person: { ...person, waiver_status } })).toMatchObject({ visible: true, certified: true, eligible: false });
  });
  it('does not equate an equipment pass with general safety induction', () => {
    const result = evaluateEquipmentAccess({ ...base, person: { ...person, safety_training_status: 'unknown' } });
    expect(result.certified).toBe(true);
    expect(result.eligible).toBe(false);
    expect(result.blockers.join(' ')).not.toContain('repeat');
  });
  it('does not grant independent booking to a minor', () => {
    expect(evaluateEquipmentAccess({ ...base, person: { ...person, minor_status: 'minor' } })).toMatchObject({ certified: true, eligible: false });
  });
  it('hides restricted equipment on a failed identity match, even if certificate IDs are supplied', () => {
    expect(evaluateEquipmentAccess({ ...base, person: null })).toMatchObject({ visible: false, certified: false, eligible: false });
  });
  it('does not turn printing training into laser or electronics certification', () => {
    for (const cert of ['laser', 'electronics']) expect(evaluateEquipmentAccess({ ...base, requiredCertifications: [cert] }).visible).toBe(false);
  });
  it('requires every certification when equipment has multiple requirements', () => {
    expect(evaluateEquipmentAccess({ ...base, requiredCertifications: ['printing', 'electronics'] }).eligible).toBe(false);
  });
  it('preserves training but respects suspended booking privileges', () => {
    expect(evaluateEquipmentAccess({ ...base, person: { ...person, booking_privilege_active: false } })).toMatchObject({ certified: true, eligible: false });
  });
  it('does not book unavailable equipment or disabled historical tables', () => {
    expect(evaluateEquipmentAccess({ ...base, status: 'out_of_service' }).eligible).toBe(false);
    expect(evaluateEquipmentAccess({ ...base, bookingEnabled: false }).visible).toBe(false);
  });
  it('shows general resources for reference without authorizing unknown people', () => {
    expect(evaluateEquipmentAccess({ ...base, person: null, requiredCertifications: [] })).toMatchObject({ visible: true, certified: false, eligible: false });
  });
});

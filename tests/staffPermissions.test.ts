import { describe, expect, it } from 'vitest';
import { staffCan, staffCanTrain } from '../supabase/functions/_shared/staffPermissions';

describe('operational permissions', () => {
  it.each(['owner', 'admin'])('%s retains all operational controls regardless of focused fields', role => {
    const staff = { role, capabilities: [], trainingCertificationTypeIds: [] };
    for (const task of ['training', 'access', 'subscriptions', 'catalog']) expect(staffCan(staff, task)).toBe(true);
    expect(staffCanTrain(staff, 'laser')).toBe(true);
  });
  it('keeps the existing trainer default and denies unrelated tasks', () => {
    expect(staffCan({ role: 'trainer' }, 'training')).toBe(true);
    expect(staffCan({ role: 'trainer' }, 'access')).toBe(false);
    expect(staffCan({ role: 'viewer' }, 'training')).toBe(false);
  });
  it('an explicit empty task assignment overrides the trainer default', () => {
    expect(staffCanTrain({ role: 'trainer', capabilities: [], trainingCertificationTypeIds: ['laser'] }, 'laser')).toBe(false);
  });
  it('limits focused trainers to assigned certification types', () => {
    const staff = { role: 'viewer', capabilities: ['training'], trainingCertificationTypeIds: ['laser'] };
    expect(staffCanTrain(staff, 'laser')).toBe(true);
    expect(staffCanTrain(staff, 'printing')).toBe(false);
    expect(staffCan(staff, 'subscriptions')).toBe(false);
  });
  it('retains existing general training authority until explicitly reviewed', () => {
    expect(staffCanTrain({ role: 'trainer', trainingCertificationTypeIds: null }, 'printing')).toBe(true);
  });
  it('a newly invited trainer awaiting equipment assignment has no equipment authority', () => {
    expect(staffCanTrain({ role: 'trainer', capabilities: ['training'], trainingCertificationTypeIds: [] }, 'printing')).toBe(false);
  });
  it('does not treat arbitrary capability names as permissions', () => {
    expect(staffCan({ role: 'admin' }, 'staff-management')).toBe(false);
  });
});

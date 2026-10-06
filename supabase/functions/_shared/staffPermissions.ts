export const capabilityNames = ['training', 'access', 'subscriptions', 'catalog'] as const;
export interface StaffPermissions {
  role: string;
  capabilities?: string[] | null;
  trainingCertificationTypeIds?: string[] | null;
}
export function staffCan(staff: StaffPermissions, capability: string): boolean {
  if (!(capabilityNames as readonly string[]).includes(capability)) return false;
  return ['owner', 'admin'].includes(staff.role)
    || (staff.capabilities ?? (staff.role === 'trainer' ? ['training'] : [])).includes(capability);
}
export function staffCanTrain(staff: StaffPermissions, certificationTypeId: string): boolean {
  if (!staffCan(staff, 'training')) return false;
  return ['owner', 'admin'].includes(staff.role)
    || staff.trainingCertificationTypeIds == null
    || staff.trainingCertificationTypeIds.includes(certificationTypeId);
}

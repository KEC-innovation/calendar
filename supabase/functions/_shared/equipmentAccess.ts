// Shared by the server and synthetic regression fixtures. Certification and
// booking readiness are deliberately separate: paperwork never erases training.
export interface AccessPerson {
  active: boolean;
  booking_privilege_active: boolean;
  safety_training_status: string;
  waiver_status: string;
  minor_status: string;
}

export function evaluateEquipmentAccess(input: {
  person: AccessPerson | null;
  requiredCertifications: string[];
  activeCertifications: string[];
  status: string;
  bookingEnabled: boolean;
  external: boolean;
  externalAllowed: boolean;
}) {
  const { person } = input;
  const requiresCertification = input.requiredCertifications.length > 0;
  const certified = Boolean(person) && requiresCertification
    && input.requiredCertifications.every((id) => input.activeCertifications.includes(id));
  const visible = input.bookingEnabled && input.status !== 'inactive'
    && (!input.external || input.externalAllowed)
    && (!requiresCertification || certified);
  const blockers: string[] = [];
  if (!person) blockers.push('Staff must verify your member, general safety, waiver, and adult-status records first.');
  else {
    if (!person.active) blockers.push('Makerspace access is inactive.');
    if (!person.booking_privilege_active) blockers.push('Advance-booking privileges are suspended.');
    if (person.safety_training_status !== 'verified') blockers.push('General safety induction needs staff verification; this is separate from equipment training.');
    if (person.waiver_status !== 'verified') blockers.push('Liability waiver needs staff verification.');
    if (person.minor_status !== 'adult') blockers.push('Adult status needs staff verification; minors cannot book independently.');
  }
  if (input.status === 'out_of_service') blockers.push('Equipment is currently out of service.');
  return { visible, requiresCertification, certified, eligible: visible && blockers.length === 0, blockers };
}

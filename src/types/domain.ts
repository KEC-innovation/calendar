export type PersonCategory =
  | 'kec_student'
  | 'kec_staff'
  | 'other_college_student'
  | 'business_external'
  | 'member_non_kec'
  | 'outreach_minor';

export type StaffRole = 'owner' | 'admin' | 'trainer' | 'viewer';
export type EquipmentStatus = 'active' | 'out_of_service' | 'inactive';
export type ComplianceStatus = 'unknown' | 'pending' | 'verified' | 'revoked';
export type MinorStatus = 'unknown' | 'adult' | 'minor';
export type BookingStatus =
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface WeeklyHours {
  isoDay: number;
  dayName: string;
  openTime: string;
  closeTime: string;
  bookable: boolean;
}

export interface EquipmentResource {
  id: string;
  slug: string;
  displayName: string;
  categoryName: string;
  status: EquipmentStatus;
  bookingEnabled: boolean;
  externalAllowed: boolean;
  maxMinutes: number;
  requiresCertification: boolean;
  certified?: boolean;
  eligible: boolean;
  blockers: string[];
}

export interface PublicBootstrap {
  timezone: 'Asia/Kathmandu';
  weeklyHours: WeeklyHours[];
  categories: Array<{ value: PersonCategory; label: string }>;
  policy: {
    maxBookingMinutes: number;
    cancellationCutoffMinutes: number;
    lateArrivalMinutes: number;
    quizMinutes: number;
    quizPassMark: number;
    quizMaxScore: number;
  };
}

export interface IdentityInput {
  category: PersonCategory;
  fullName: string;
  email: string;
  rollNumber?: string;
  phone: string;
  organization?: string;
}

export interface IdentityVerification {
  identityStatus: 'verified' | 'needs_staff_review' | 'inactive';
  resources: EquipmentResource[];
  message: string;
  verificationId: string;
  expiresAt: string;
  recognizedTraining?: string[];
}

export interface AvailabilityResult {
  equipmentId: string;
  date: string;
  timezone: 'Asia/Kathmandu';
  busy: Array<{ startsAt: string; endsAt: string }>;
  closureReason?: string;
  openingHours?: { openTime: string; closeTime: string; bookable: boolean };
  closures?: Array<{ startsAt: string; endsAt: string; reason: string }>;
}

export interface BookingRequest extends IdentityInput {
  verificationId: string;
  equipmentId: string;
  startsAt: string;
  endsAt: string;
  purpose?: string;
}

export interface BookingConfirmation {
  bookingReference: string;
  manageToken: string;
  startsAt: string;
  endsAt: string;
  equipmentName: string;
  calendarSyncStatus: 'pending' | 'not_configured' | 'synced' | 'failed';
  notificationStatus: 'pending' | 'not_configured' | 'sent' | 'failed';
}

export interface QuizQuestionOption {
  id: string;
  label: string;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: QuizQuestionOption[];
}

export interface QuizSession {
  attemptToken: string;
  attemptReference: string;
  quizName: string;
  participantName: string;
  participantEmail: string;
  trainerName: string;
  passMark: number;
  maxScore: number;
  expiresAt: string;
  questions: QuizQuestion[];
}

export interface QuizResult {
  attemptReference: string;
  score: number;
  maxScore: number;
  passMark: number;
  passed: boolean;
  certificationNames: string[];
}

export interface StaffSession {
  capabilities?: string[] | null;
  accessToken: string;
  userId: string;
  email: string;
  displayName: string;
  role: StaffRole;
}

export interface PageResult<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type JsonObject = Record<string, unknown>;

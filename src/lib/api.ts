import { getSupabase, isMockMode } from './supabase';
import type {
  AvailabilityResult,
  BookingConfirmation,
  BookingRequest,
  IdentityInput,
  IdentityVerification,
  JsonObject,
  PublicBootstrap,
  QuizResult,
  QuizSession,
  StaffSession,
} from '../types/domain';

type FunctionName = 'public-api' | 'quiz-api' | 'admin-api';

interface MockApiModule {
  invokeMock<T>(functionName: FunctionName, body: JsonObject, accessToken?: string): Promise<T>;
}

async function invoke<T>(functionName: FunctionName, body: JsonObject, accessToken?: string): Promise<T> {
  if (isMockMode()) {
    const mockModulePath = './mockApi.ts';
    const { invokeMock } = await import(/* @vite-ignore */ mockModulePath) as unknown as MockApiModule;
    return invokeMock<T>(functionName, body, accessToken);
  }

  const client = getSupabase();
  const { data, error } = await client.functions.invoke(functionName, {
    body,
    // Supabase supplies the current refreshed session token.
    headers: undefined,
  });
  if (error) {
    let message = error.message || 'The request could not be completed.';
    const context = 'context' in error ? error.context : undefined;
    if (context instanceof Response) {
      try {
        const payload = (await context.clone().json()) as { error?: string; message?: string };
        message = payload.error || payload.message || message;
      } catch {
        // Keep the safe function error message when the response is not JSON.
      }
    }
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  bootstrap(): Promise<PublicBootstrap> {
    return invoke('public-api', { action: 'bootstrap' });
  },
  verifyIdentity(identity: IdentityInput): Promise<IdentityVerification> {
    return invoke('public-api', { action: 'verify-identity', identity });
  },
  availability(equipmentId: string, date: string): Promise<AvailabilityResult> {
    return invoke('public-api', { action: 'availability', equipmentId, date });
  },
  createBooking(booking: BookingRequest): Promise<BookingConfirmation> {
    return invoke('public-api', { action: 'create-booking', booking });
  },
  cancelBooking(bookingReference: string, manageToken: string): Promise<{ lateCancellation: boolean }> {
    return invoke('public-api', { action: 'cancel-booking', bookingReference, manageToken });
  },
  resumeQuiz(attemptToken: string): Promise<QuizSession> {
    return invoke('quiz-api', { action: 'resume', attemptToken });
  },
  submitQuiz(attemptToken: string, answers: Array<{ questionId: string; optionId: string }>): Promise<QuizResult> {
    return invoke('quiz-api', { action: 'submit', attemptToken, answers });
  },
  startQuiz(accessToken: string, payload: JsonObject): Promise<QuizSession> {
    return invoke('quiz-api', { action: 'start', ...payload }, accessToken);
  },
  admin<T>(session: StaffSession, action: string, payload: JsonObject = {}): Promise<T> {
    return invoke('admin-api', { action, ...payload }, session.accessToken);
  },
};

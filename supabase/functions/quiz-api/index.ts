import { requireAccount, staffCan } from '../_shared/accounts.ts';
import { adminClient, requireStaff } from '../_shared/supabase.ts';
import { handle, HttpError, json, readJson, requireUuid, requiredText, text } from '../_shared/http.ts';
import { writeAudit } from '../_shared/audit.ts';
import { consumeRateLimit, normalizeIdentityPart, randomToken, safeEmail, sha256, shuffle } from '../_shared/security.ts';

interface QuestionRow {
  id: string;
  prompt: string;
  position: number;
  quiz_question_options: Array<{ id: string; label: string; position: number; is_correct: boolean }>;
}

interface AttemptRow {
  id: string;
  attempt_reference: string;
  status: 'started' | 'submitted' | 'expired' | 'invalidated';
  expires_at: string;
  pass_mark: number;
  max_score: number;
  question_order: string[];
  option_order: Record<string, string[]>;
  trainer_name_snapshot: string;
  quizzes: { id: string; display_name: string } | Array<{ id: string; display_name: string }>;
  people: { full_name: string; email: string } | Array<{ full_name: string; email: string }>;
}

function objectRelation<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] as T : value;
}

function attemptReference(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const suffix = randomToken(3).toUpperCase();
  return `QUIZ-${values.year}${values.month}${values.day}-${values.hour}${values.minute}${values.second}-${suffix}`;
}

async function loadQuestions(admin: ReturnType<typeof adminClient>, quizId: string): Promise<QuestionRow[]> {
  const { data, error } = await admin
    .from('quiz_questions')
    .select('id,prompt,position,quiz_question_options(id,label,position,is_correct)')
    .eq('quiz_id', quizId)
    .eq('active', true)
    .order('position')
    .order('position', { referencedTable: 'quiz_question_options' });
  if (error) throw error;
  return (data || []) as unknown as QuestionRow[];
}

function publicQuestions(
  rows: QuestionRow[],
  questionOrder: string[],
  optionOrder: Record<string, string[]>,
): Array<{ id: string; prompt: string; options: Array<{ id: string; label: string }> }> {
  const questions = new Map(rows.map((row) => [row.id, row]));
  return questionOrder.map((questionId) => {
    const question = questions.get(questionId);
    if (!question) throw new HttpError(409, 'Quiz content changed after this attempt started.', 'QUIZ_VERSION_CHANGED');
    const options = new Map(question.quiz_question_options.map((option) => [option.id, option]));
    return {
      id: question.id,
      prompt: question.prompt,
      options: (optionOrder[question.id] || []).map((optionId) => {
        const option = options.get(optionId);
        if (!option) throw new HttpError(409, 'Quiz options changed after this attempt started.', 'QUIZ_VERSION_CHANGED');
        // Deliberately omit is_correct from the participant payload.
        return { id: option.id, label: option.label };
      }),
    };
  });
}

async function sessionPayload(admin: ReturnType<typeof adminClient>, attempt: AttemptRow, token: string) {
  const quiz = objectRelation(attempt.quizzes);
  const participant = objectRelation(attempt.people);
  const rows = await loadQuestions(admin, quiz.id);
  return {
    attemptToken: token,
    attemptReference: attempt.attempt_reference,
    quizName: quiz.display_name,
    participantName: participant.full_name,
    participantEmail: participant.email,
    trainerName: attempt.trainer_name_snapshot,
    passMark: attempt.pass_mark,
    maxScore: attempt.max_score,
    expiresAt: attempt.expires_at,
    questions: publicQuestions(rows, attempt.question_order, attempt.option_order || {}),
  };
}

Deno.serve((request) => handle(request, async () => {
  const body = await readJson(request, 120_000);
  const action = text(body.action, 40);
  const admin = adminClient();

  if (action === 'start') {
    await requireAccount(request);
    const staff = await requireStaff(request, 'admin');
    await consumeRateLimit(admin, request, `quiz-start-${staff.userId}`, 12, 600);
    const quizId = requireUuid(body.quizId, 'Quiz');
    const participantValue = body.participant;
    if (!participantValue || typeof participantValue !== 'object' || Array.isArray(participantValue)) {
      throw new HttpError(400, 'Participant details are required.', 'VALIDATION_ERROR');
    }
    const participant = participantValue as Record<string, unknown>;
    const fullName = requiredText(participant.fullName, 'Participant name', 120);
    const email = safeEmail(participant.email);
    const rollNumber = text(participant.rollNumber, 80);
    const phone = requiredText(participant.phone, 'Phone number', 40);
    const organization = text(participant.organization, 160);
    const category = text(participant.category, 40);
    const validCategories = ['kec_student', 'kec_staff', 'other_college_student', 'business_external', 'member_non_kec'];
    if (!validCategories.includes(category)) throw new HttpError(400, 'Participant category is invalid.', 'VALIDATION_ERROR');
    if (category === 'kec_student' && !rollNumber) throw new HttpError(400, 'Roll number is required.', 'VALIDATION_ERROR');
    if (!['kec_student', 'kec_staff'].includes(category) && !organization) throw new HttpError(400, 'College or organization is required.', 'VALIDATION_ERROR');
    if (participant.confirmAdult !== true) throw new HttpError(400, 'A trainer must confirm that the participant is an adult. Minors cannot receive independent access.', 'MINOR_RESTRICTION');
    if (participant.confirmSafetyTraining !== true || participant.confirmWaiver !== true) {
      throw new HttpError(400, 'Safety training and liability waiver must be confirmed before the quiz.', 'COMPLIANCE_REQUIRED');
    }

    const { data: quiz, error: quizError } = await admin
      .from('quizzes')
      .select('id,display_name,duration_minutes,question_count,pass_mark,version,active')
      .eq('id', quizId)
      .eq('active', true)
      .single();
    if (quizError || !quiz) throw new HttpError(404, 'Quiz is not active or its answer bank has not been imported.', 'QUIZ_UNAVAILABLE');

    // Validate the complete bank before changing a participant record. This keeps
    // a broken quiz configuration from producing a partial compliance update.
    const questionRows = await loadQuestions(admin, quiz.id);
    if (questionRows.length !== quiz.question_count || questionRows.some((row) => row.quiz_question_options.length < 2 || row.quiz_question_options.filter((option) => option.is_correct).length !== 1)) {
      throw new HttpError(409, 'Quiz configuration failed its answer-bank integrity check.', 'QUIZ_CONFIGURATION_INVALID');
    }

    const { data: existingPerson, error: existingError } = await admin
      .from('people')
      .select('id,category,roll_number,minor_status')
      .eq('email_normalized', email)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existingPerson && existingPerson.category !== category) throw new HttpError(409, 'This email is registered under a different user category.', 'IDENTITY_CONFLICT');
    if (existingPerson && category === 'kec_student' && normalizeIdentityPart(existingPerson.roll_number) !== normalizeIdentityPart(rollNumber)) {
      throw new HttpError(409, 'The roll number does not match the existing email record.', 'IDENTITY_CONFLICT');
    }
    if (existingPerson?.minor_status === 'minor') throw new HttpError(403, 'Minors may participate only in supervised events and cannot receive independent equipment access.', 'MINOR_RESTRICTION');

    let personId = existingPerson?.id as string | undefined;
    if (personId) {
      const { error } = await admin.from('people').update({
        full_name: fullName,
        phone,
        organization: organization || null,
        safety_training_status: 'verified',
        waiver_status: 'verified',
        minor_status: 'adult',
        migration_review_required: false,
      }).eq('id', personId);
      if (error) throw error;
    } else {
      const { data, error } = await admin.from('people').insert({
        full_name: fullName,
        email,
        roll_number: rollNumber || null,
        phone,
        category,
        organization: organization || null,
        safety_training_status: 'verified',
        waiver_status: 'verified',
        minor_status: 'adult',
        migration_review_required: false,
        priority_rank: ['kec_student', 'kec_staff'].includes(category) ? 10 : category === 'member_non_kec' ? 20 : 30,
      }).select('id').single();
      if (error) throw error;
      personId = data.id;
    }

    const orderedQuestions = shuffle(questionRows);
    const questionOrder = orderedQuestions.map((question) => question.id);
    const optionOrder = Object.fromEntries(orderedQuestions.map((question) => [question.id, shuffle(question.quiz_question_options).map((option) => option.id)]));
    const rawToken = randomToken(32);
    const tokenHash = await sha256(rawToken);
    const reference = attemptReference();
    const expiresAt = new Date(Date.now() + quiz.duration_minutes * 60_000).toISOString();
    const { data: attempt, error: attemptError } = await admin.from('quiz_attempts').insert({
      attempt_reference: reference,
      token_hash: tokenHash,
      quiz_id: quiz.id,
      quiz_version: quiz.version,
      participant_id: personId,
      trainer_user_id: staff.userId,
      trainer_name_snapshot: staff.displayName,
      expires_at: expiresAt,
      max_score: quiz.question_count,
      pass_mark: quiz.pass_mark,
      question_order: questionOrder,
      option_order: optionOrder,
    }).select('id').single();
    if (attemptError) throw attemptError;
    await writeAudit(admin, staff, 'quiz_started', 'quiz_attempts', attempt.id, { quiz_id: quiz.id, participant_id: personId });
    return json(request, {
      attemptToken: rawToken,
      attemptReference: reference,
      quizName: quiz.display_name,
      participantName: fullName,
      participantEmail: email,
      trainerName: staff.displayName,
      passMark: quiz.pass_mark,
      maxScore: quiz.question_count,
      expiresAt,
      questions: publicQuestions(questionRows, questionOrder, optionOrder),
    }, 201);
  }

  if (action === 'resume' || action === 'submit') {
    const hash=await sha256(requiredText(body.attemptToken,'Attempt token',128));
    const {data:binding,error:bindingError}=await admin.from('quiz_attempts').select('account_user_id').eq('token_hash',hash).maybeSingle();
    if(bindingError) throw bindingError;
    if(binding?.account_user_id) {
      const {user}=await requireAccount(request);
      if(user.id!==binding.account_user_id) throw new HttpError(403,'This attempt belongs to another account.','ATTEMPT_OWNER');
    }
  }
  if (action === 'resume') {
    await consumeRateLimit(admin, request, 'quiz-resume', 60, 600);
    const token = requiredText(body.attemptToken, 'Attempt token', 128);
    const tokenHash = await sha256(token);
    const { data, error } = await admin
      .from('quiz_attempts')
      .select('id,attempt_reference,status,expires_at,pass_mark,max_score,question_order,option_order,trainer_name_snapshot,quizzes!inner(id,display_name),people!inner(full_name,email)')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, 'Quiz session is missing or invalid.', 'INVALID_TOKEN');
    const attempt = data as unknown as AttemptRow;
    if (attempt.status !== 'started') throw new HttpError(409, 'This quiz has already ended.', 'ATTEMPT_NOT_ACTIVE');
    if (new Date(attempt.expires_at) <= new Date()) {
      await admin.from('quiz_attempts').update({ status: 'expired' }).eq('id', attempt.id).eq('status', 'started');
      throw new HttpError(410, 'The 8-minute quiz window has expired.', 'ATTEMPT_EXPIRED');
    }
    return json(request, await sessionPayload(admin, attempt, token));
  }

  if (action === 'submit') {
    await consumeRateLimit(admin, request, 'quiz-submit', 15, 600);
    const token = requiredText(body.attemptToken, 'Attempt token', 128);
    if (!Array.isArray(body.answers)) throw new HttpError(400, 'Answers must be an array.', 'VALIDATION_ERROR');
    const answers = body.answers.map((answer) => {
      if (!answer || typeof answer !== 'object' || Array.isArray(answer)) throw new HttpError(400, 'An answer is invalid.', 'VALIDATION_ERROR');
      const value = answer as Record<string, unknown>;
      return { questionId: requireUuid(value.questionId, 'Question'), optionId: requireUuid(value.optionId, 'Option') };
    });
    const { data, error } = await admin.rpc('submit_quiz_attempt', {
      p_token_hash: await sha256(token),
      p_answers: answers,
    });
    if (error) throw error;
    if (!data?.ok) {
      const status = data?.code === 'EXPIRED' ? 410 : data?.code === 'ALREADY_SUBMITTED' ? 409 : 400;
      throw new HttpError(status, data?.message || 'Quiz submission was rejected.', data?.code || 'QUIZ_REJECTED');
    }
    const { ok: _ok, ...result } = data;
    return json(request, result);
  }

  throw new HttpError(404, 'Unknown quiz operation.', 'ACTION_NOT_FOUND');
}));

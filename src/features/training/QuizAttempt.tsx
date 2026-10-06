import { useEffect, useMemo, useState } from 'react';
import { Check, Clock3, LockKeyhole } from 'lucide-react';
import { api } from '../../lib/api';
import { Brand } from '../../components/Brand';
import { Spinner } from '../../components/Spinner';
import type { QuizResult, QuizSession } from '../../types/domain';

function remainingSeconds(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

export function QuizAttempt({ token }: { token: string }) {
  const [session, setSession] = useState<QuizSession | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [seconds, setSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void api.resumeQuiz(token).then((data) => {
      if (!active) return;
      setSession(data);
      setSeconds(remainingSeconds(data.expiresAt));
    }).catch((cause: unknown) => active && setError(cause instanceof Error ? cause.message : 'The quiz could not be loaded.'));
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!session || result || frozen) return;
    const timer = window.setInterval(() => {
      const next = remainingSeconds(session.expiresAt);
      setSeconds(next);
      if (next <= 0) {
        setFrozen(true);
        setError('The 8-minute quiz window has expired. Ask a trainer to start a new attempt.');
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session, result, frozen]);

  const answered = Object.keys(answers).length;
  const progress = session ? Math.round((answered / session.questions.length) * 100) : 0;
  const timerText = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const allAnswered = Boolean(session && answered === session.questions.length);
  const questionAnswers = useMemo(
    () => session?.questions.map((question) => ({ questionId: question.id, optionId: answers[question.id] || '' })) || [],
    [answers, session],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!session || !allAnswered || frozen) return;
    setFrozen(true);
    setSubmitting(true);
    setError('');
    try {
      setResult(await api.submitQuiz(token, questionAnswers));
      setAnswers({});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The attempt could not be submitted.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!session && !error) return <main className="center-screen"><Spinner label="Opening supervised quiz" /></main>;

  if (result) {
    return (
      <main className="quiz-shell quiz-shell--result">
        <Brand compact />
        <section className={`quiz-result-card ${result.passed ? 'is-pass' : 'is-fail'}`}>
          <div className="confirmation__icon">{result.passed ? <Check size={30} /> : <LockKeyhole size={28} />}</div>
          <p className="eyebrow">Attempt submitted</p>
          <h1>{result.passed ? (result.certificationNames.length ? 'Equipment training passed' : 'Assessment passed — review needed') : 'Training not yet passed'}</h1>
          <div className="score-ring"><strong>{result.score}</strong><span>/ {result.maxScore}</span></div>
          <p>{result.passed ? (result.certificationNames.length ? `Certified: ${result.certificationNames.join(', ')}. You can book once your one-time access records are verified.` : 'Your score passed. Ask an access officer to review the certification record; this result does not override a suspension.') : `The pass mark is ${result.passMark}/${result.maxScore}. No certification was granted.`}</p>
          <div className="reference-box"><span>Attempt reference</span><strong>{result.attemptReference}</strong></div>
          <a className="button button--primary" href="#/">Return to booking</a>
        </section>
      </main>
    );
  }

  return (
    <main className="quiz-shell">
      <header className="quiz-header">
        <Brand compact />
        <div className={`quiz-timer ${seconds <= 60 ? 'is-critical' : seconds <= 180 ? 'is-warning' : ''}`}><Clock3 size={18} /><strong>{timerText}</strong><span>remaining</span></div>
      </header>
      {session && (
        <form onSubmit={(event) => void submit(event)}>
          <section className="quiz-intro">
            <p className="eyebrow">Supervised training</p>
            <h1>{session.quizName}</h1>
            <div className="quiz-meta-grid">
              <span><small>Participant</small><strong>{session.participantName}</strong></span>
              <span><small>Email</small><strong>{session.participantEmail}</strong></span>
              <span><small>Trainer</small><strong>{session.trainerName}</strong></span>
              <span><small>Pass mark</small><strong>{session.passMark}/{session.maxScore}</strong></span>
            </div>
            <div className="progress-line"><span>{answered} of {session.questions.length} answered</span><span>{progress}%</span></div>
            <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
          </section>
          {error && <div className="alert alert--error quiz-alert" role="alert">{error}</div>}
          <div className="question-list">
            {session.questions.map((question, index) => (
              <fieldset className={`question-card ${answers[question.id] ? 'is-answered' : ''}`} key={question.id} disabled={frozen}>
                <legend><span>{index + 1}</span>{question.prompt}</legend>
                {question.options.map((option) => (
                  <label className="answer-option" key={option.id}>
                    <input type="radio" name={`question-${question.id}`} value={option.id} checked={answers[question.id] === option.id} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option.id }))} />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="quiz-submit-dock">
            <span>{allAnswered ? 'All questions answered. Submission is final.' : `${session.questions.length - answered} remaining`}</span>
            <button className="button button--primary" type="submit" disabled={!allAnswered || frozen || submitting}>{submitting ? <Spinner label="Grading" /> : 'Submit final answers'}</button>
          </div>
        </form>
      )}
      {!session && error && <section className="simple-card"><div className="alert alert--error">{error}</div><a className="button button--primary" href="#/">Return to booking</a></section>}
    </main>
  );
}

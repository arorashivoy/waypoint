'use client';

import { useRef, useState } from 'react';
import { copyText } from '../api';
import { Button, ErrorNote, Field, Fold } from '../ui';
import { PartBack } from './PartBack';
import { showSection } from './scroll';
import { longAgo } from '@/lib/time-ago';
import type { Answers, AnswersBusy, JobDetailState, Part } from './types';

/** The limits are the same as on the server (src/lib/answers.ts). A client file does not import server code. */
export const QUESTIONS_LIMIT = 4000;
export const MESSAGE_LIMIT = 1000;
const ANSWERS_NOTE_ID = 'jd-answers-note';

/** One line for the fold, so the user sees the state without opening it. */
export function answersStatus(answers: Answers | null): string {
  if (!answers?.text.trim()) return 'Paste the questions of the form';
  return `Answered ${longAgo(answers.updatedAt)}`;
}

function Progress({ busy }: { busy: AnswersBusy }) {
  if (!busy) return null;
  return (
    <p className="jd-hint" role="status">
      {busy === 'answer' ? 'Claude is writing the answers from your profile and the posting…' : 'Claude is changing the answers…'}
    </p>
  );
}

/** The answers in a box that the user can edit, then the chat that asks Claude for a change. */
function AnswerBox({ d, answers }: { d: JobDetailState; answers: Answers }) {
  const [text, setText] = useState(answers.text);
  const [message, setMessage] = useState('');
  const [blocked, setBlocked] = useState(false);
  const dirty = text !== answers.text;
  const busy = !!d.answersBusy;
  const turns = answers.chat.filter((t) => t.role === 'you').length;
  const tooLong = message.length > MESSAGE_LIMIT;

  const send = async () => {
    const m = message.trim();
    if (!m || busy || tooLong) return;
    // Claude changes the saved text. So a hand edit is saved first, and the change builds on it.
    if (dirty && !(await d.saveAnswers(text))) return;
    if (await d.refineAnswers(m)) setMessage('');
  };

  return (
    <div className="jd-block">
      <h3>Answers</h3>
      <Field label="Text of the answers" hint="You can edit this text. Press Save changes to keep your edits.">
        {(c) => <textarea {...c} rows={14} value={text} onChange={(e) => setText(e.target.value)} />}
      </Field>
      <div className="jd-actions">
        <Button
          confirm="Copied"
          onClick={async () => {
            const ok = await copyText(text);
            setBlocked(!ok);
            if (!ok) throw new Error('clipboard');
          }}
        >
          Copy all
        </Button>
        <Button
          confirm="Saved"
          disabled={!dirty || busy}
          onClick={async () => {
            if (!(await d.saveAnswers(text))) throw new Error('save');
          }}
        >
          Save changes
        </Button>
      </div>
      {blocked && <p className="jd-hint">The browser blocked the clipboard. Select the text and copy it.</p>}
      <p className="jd-hint">Check each answer before you send it. Replace each [ADD: …] with your own facts.</p>

      <h3>Change the answers{turns ? `, ${turns} ${turns === 1 ? 'change' : 'changes'}` : ''}</h3>
      {answers.chat.map((t, i) => (
        <p key={i} className={`jd-turn jd-turn-${t.role}`}>{t.text}</p>
      ))}
      {!d.claudeNote && (
        <>
          <Field
            label="What to change"
            hint={`${message.length} of ${MESSAGE_LIMIT} characters`}
            error={tooLong ? `${message.length} of ${MESSAGE_LIMIT} characters. Shorten the request.` : undefined}
          >
            {(c) => (
              <textarea
                {...c}
                value={message}
                placeholder="For example: make the answer to question 2 shorter"
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
              />
            )}
          </Field>
          <div className="jd-actions">
            <Button busy={d.answersBusy === 'refine'} disabled={busy || !message.trim() || tooLong} onClick={send}>
              {d.answersBusy === 'refine' ? 'Changing…' : 'Send'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** "Application questions": paste the questions of the employer form, and Claude writes the answers. Works for every job. */
export function AnswersSection({ d, open = false, onPart, onBack }: { d: JobDetailState; open?: boolean; onPart: (p: Part) => void; onBack: () => void }) {
  const { answers } = d;
  const [questions, setQuestions] = useState(answers?.questions ?? '');
  const root = useRef<HTMLElement>(null);
  const tooLong = questions.length > QUESTIONS_LIMIT;
  const busy = !!d.answersBusy;
  const go = () => {
    if (!questions.trim() || tooLong || busy) return;
    return d.answer(questions);
  };
  return (
    <section className="jd-answers" ref={root}>
      <PartBack label="Application questions" onBack={onBack} />
      <Fold title="Application questions" status={answersStatus(answers)} forceOpen={open} onOpen={() => onPart('answers')} onToggle={(o) => o && showSection(root.current)}>
        <div className="jd-stack">
          <p className="jd-hint">
            Copy the questions from the application form of the employer, and paste them here. Claude writes the answers in your voice,
            from your profile and the posting only.
          </p>
          <Field
            label="Questions of the form"
            hint={`${questions.length} of ${QUESTIONS_LIMIT} characters`}
            error={tooLong ? `${questions.length} of ${QUESTIONS_LIMIT} characters. Send the questions in two parts.` : undefined}
          >
            {(c) => <textarea {...c} rows={6} value={questions} placeholder="Paste the questions here" onChange={(e) => setQuestions(e.target.value)} />}
          </Field>
          {d.claudeNote && <p className="jd-hint" id={ANSWERS_NOTE_ID}>{d.claudeNote}</p>}
          <div className="jd-actions">
            <Button
              variant={answers ? 'plain' : 'go'}
              busy={d.answersBusy === 'answer'}
              disabled={busy || !questions.trim() || tooLong || !!d.claudeNote}
              aria-describedby={d.claudeNote ? ANSWERS_NOTE_ID : undefined}
              onClick={go}
            >
              {d.answersBusy === 'answer' ? 'Writing the answers…' : 'Answer with Claude'}
            </Button>
            {answers && <p className="jd-hint jd-grow">This replaces the answers below and the chat.</p>}
          </div>
          <Progress busy={d.answersBusy} />
          {d.answersError && <ErrorNote live what="Claude could not answer." fix={d.answersError} />}
          {answers && answers.text.trim() && <AnswerBox key={`${answers.updatedAt}-${answers.chat.length}`} d={d} answers={answers} />}
        </div>
      </Fold>
    </section>
  );
}

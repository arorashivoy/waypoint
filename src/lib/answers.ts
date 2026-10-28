import type { Job } from '@prisma/client';
import { db } from '@/lib/db';
import { HttpError } from '@/lib/auth/http';
import { enqueue } from '@/lib/tasks/queue';
import { TaskFatal } from '@/lib/tasks/worker';
import { askJson, claudeStatus } from '@/lib/claude';
import { checkForInjection, refuseUserRequest } from '@/lib/injection';
import { profileSummary } from '@/lib/user';
import { getSettings } from '@/lib/settings';
import { AnswersReply } from '@/lib/schemas';
import { ANSWERS_SYSTEM, answersPrompt } from '@/lib/prompts';
import { ANSWER_MESSAGE_MAX, ANSWER_TEXT_MAX, ANSWER_TURNS, QUESTIONS_MAX } from '@/lib/answers-limits';

/**
 * "Application questions": the user pastes the questions of an employer form, and Claude writes the answers.
 *
 * The state of one application is one OutreachEvent row with kind `answers`. The table has no column for it, and the
 * schema stays as it is, so the columns hold:
 *   incoming = the questions, body = the text of the answers, reason = the chat as JSON,
 *   org = the time of the last change (ISO text).
 * No other code reads a row of this kind: the Pending screen and the counts filter by their own kinds.
 */

export { ANSWER_MESSAGE_MAX, ANSWER_TEXT_MAX, ANSWER_TURNS, QUESTIONS_MAX };

export const ANSWERS_KIND = 'answers';
const NOTE_MAX = 600;

export type AnswerTurn = { role: 'you' | 'claude'; text: string; at: string; task?: string };
export type AnswersState = { questions: string; text: string; chat: AnswerTurn[]; updatedAt: string };

export type AnswersPayload = { applicationId: string; action: 'answer' | 'refine'; text: string };

const parseChat = (s: string | null): AnswerTurn[] => {
  try {
    const v: unknown = s ? JSON.parse(s) : [];
    return Array.isArray(v) ? (v as AnswerTurn[]) : [];
  } catch {
    return [];
  }
};

/** The saved state of an application, or null. */
export async function readAnswers(applicationId: string): Promise<AnswersState | null> {
  const row = await db.outreachEvent.findFirst({ where: { applicationId, kind: ANSWERS_KIND } });
  if (!row) return null;
  return { questions: row.incoming ?? '', text: row.body, chat: parseChat(row.reason), updatedAt: row.org ?? row.createdAt.toISOString() };
}

/** Writes the state. One row for each application: the row is found by the application and the kind. */
export async function saveAnswers(applicationId: string, next: { questions?: string; text: string; chat?: AnswerTurn[] }): Promise<AnswersState> {
  const data = {
    body: next.text,
    org: new Date().toISOString(),
    ...(next.questions !== undefined && { incoming: next.questions }),
    ...(next.chat !== undefined && { reason: JSON.stringify(next.chat) }),
  };
  const row = await db.outreachEvent.findFirst({ where: { applicationId, kind: ANSWERS_KIND }, select: { id: true } });
  if (row) await db.outreachEvent.update({ where: { id: row.id }, data });
  else await db.outreachEvent.create({ data: { applicationId, kind: ANSWERS_KIND, handled: true, ...data } });
  return (await readAnswers(applicationId))!;
}

/** The reason to refuse the questions, in words for the user, or null. */
export function refuseQuestions(text: string): string | null {
  if (!text.trim()) return 'Paste the questions of the form first.';
  if (text.length > QUESTIONS_MAX) return `Paste ${QUESTIONS_MAX} characters or fewer. Send the questions in two parts.`;
  const probe = checkForInjection(text);
  if (probe.suspicious) return `Not sent to Claude: ${probe.why}. Remove that text.`;
  return null;
}

/** The reason to refuse a message of the chat, in words for the user, or null. */
export function refuseMessage(text: string): string | null {
  if (!text.trim()) return 'Type what to change first.';
  if (text.length > ANSWER_MESSAGE_MAX) return `Write ${ANSWER_MESSAGE_MAX} characters or fewer.`;
  const probe = checkForInjection(text);
  if (probe.suspicious) return `Not sent to Claude: ${probe.why}. Remove that text.`;
  const own = refuseUserRequest(text);
  if (own) return `Not sent to Claude: ${own}. Remove that text.`;
  return null;
}

const URL_RE = /\b(?:https?|ftp):\/\/[^\s<>"')\]\\]+|\bwww\.[^\s<>"')\]\\]+/gi;
const trimUrl = (u: string) => u.replace(/[.,;:!?]+$/, '').replace(/\/+$/, '').toLowerCase();

/** The links in a text. Used for the profile, so that an answer can repeat a link that the user already has. */
export const urlsIn = (text: string): string[] => (text.match(URL_RE) ?? []).map(trimUrl);

// Shapes that do not belong in the answer of a form: markup, code, a shell command, or a link that hides its target.
const BAD_SHAPES: { re: RegExp; why: string }[] = [
  { re: /<\/?[a-z!][^>]*>/i, why: 'it has HTML markup' },
  { re: /\b(?:javascript|vbscript|data|file):/i, why: 'it has a script link' },
  { re: /!?\[[^\]]*\]\([^)]*\)/, why: 'it has a markdown link' },
  { re: /```|`[^`\n]+`/, why: 'it has code' },
  { re: /\$\([^)]*\)|\$\{[^}]*\}/, why: 'it has a shell expression' },
  { re: /(?:^|\n)\s*[$#]\s+\w+/, why: 'it has a shell command' },
  { re: /\b(?:rm\s+-[a-z]*r|sudo\s+\w+|curl\s+-|wget\s+\S|chmod\s+[0-7+]|nc\s+-[a-z]+)/i, why: 'it has a shell command' },
  { re: /\|\s*(?:ba|z)?sh\b/i, why: 'it has a shell command' },
];

// A link without a scheme, such as evil.com/login. It is checked on the text without the links that have a scheme.
const BARE_LINK = /\b[a-z0-9-]+\.(?:com|net|org|io|dev|app|xyz|ru|cn|tk|ly|sh|zip)\/\S+/i;

/**
 * Checks text that Claude wrote. The reason why the text must not be stored, or null.
 * A link passes only when it is the link of the job or one that the profile already holds.
 */
export function scanAnswerOutput(text: string, allowed: string[]): string | null {
  const probe = checkForInjection(text);
  if (probe.suspicious) return probe.why;
  for (const { re, why } of BAD_SHAPES) if (re.test(text)) return why;
  if (BARE_LINK.test(text.replace(URL_RE, ' '))) return 'it has a link';
  const ok = new Set(allowed.map(trimUrl));
  for (const u of text.match(URL_RE) ?? []) {
    if (!ok.has(trimUrl(u))) return 'it has a link that is not in your profile or in the job';
  }
  return null;
}

/** Queues an `answers` task. The same payload returns the open task. Another payload gets 409, so no input is lost. */
export async function enqueueAnswers(userId: string, payload: AnswersPayload): Promise<string> {
  const { id, created } = await enqueue({ kind: 'answers', userId, payload, dedupeKey: `answers:${userId}:${payload.applicationId}` });
  if (created) return id;
  const open = await db.task.findUnique({ where: { id }, select: { payload: true } });
  let same = false;
  try {
    same = JSON.stringify(JSON.parse(open?.payload ?? 'null')) === JSON.stringify(payload);
  } catch {
    same = false;
  }
  if (!same) throw new HttpError(409, 'An answer for this job is still being written. Try again when it ends.');
  return id;
}

/** The work of an `answers` task. It runs in the worker. The result is the saved state. */
export async function runAnswers(userId: string, p: AnswersPayload, taskId: string): Promise<AnswersState> {
  const app = await db.application.findFirst({ where: { id: p.applicationId, userId } });
  if (!app) throw new TaskFatal('The job is gone.');
  const job: Job | null = await db.job.findUnique({ where: { id: app.jobId } });
  if (!job) throw new TaskFatal('The job is gone.');

  const saved = await readAnswers(app.id);
  // A retry of a task that saved its result already returns it. No second Claude call.
  if (saved?.chat.some((t) => t.task === taskId)) return saved;

  const text = p.text.trim();
  // The refusal text never holds the text of the user.
  const refused = p.action === 'answer' ? refuseQuestions(text) : refuseMessage(text);
  if (refused) throw new TaskFatal(refused);
  if (p.action === 'refine' && !saved?.text.trim()) throw new TaskFatal('Write the first answer before you ask for a change.');

  const { mode, detail } = await claudeStatus(userId);
  if (mode === 'none') throw new TaskFatal(detail);

  const who = await profileSummary(userId);
  if (!who.positions.length && !who.projects.length) {
    throw new TaskFatal('Answers need a profile. Add your positions and projects on the Profile screen.');
  }
  const { visaStatus } = await getSettings(userId);

  const questions = p.action === 'answer' ? text : saved!.questions;
  // Each refine turn is different, so there is no cache here.
  const { data } = await askJson(
    {
      system: ANSWERS_SYSTEM,
      prompt: answersPrompt({
        who,
        visaStatus,
        job,
        questions,
        change: p.action === 'refine' ? { current: saved!.text, history: saved!.chat.slice(-ANSWER_TURNS), asked: text } : undefined,
      }),
      schema: AnswersReply,
      effort: 'medium',
    },
    { userId, kind: 'answers' },
  );

  const answers = data.answers.trim();
  const note = data.note.trim().slice(0, NOTE_MAX);
  if (!answers) throw new TaskFatal('Claude gave no answer. Press the button again.');
  if (answers.length > ANSWER_TEXT_MAX) throw new TaskFatal(`Claude wrote more than ${ANSWER_TEXT_MAX} characters. Ask for shorter answers.`);

  // The model is told not to write links or code. This check does not depend on that.
  const allowed = [job.url, ...urlsIn(JSON.stringify(who))].filter(Boolean);
  const bad = scanAnswerOutput(answers, allowed) ?? scanAnswerOutput(note, allowed);
  if (bad) throw new TaskFatal(`Waypoint did not keep the answer from Claude, because ${bad}. Change the questions or the request, and try again.`);

  const now = new Date().toISOString();
  const mark = { at: now, task: taskId };
  const reply: AnswerTurn[] = note ? [{ role: 'claude', text: note, ...mark }] : [{ role: 'claude', text: 'Done.', ...mark }];
  if (p.action === 'answer') return saveAnswers(app.id, { questions, text: answers, chat: reply });
  const chat = [...saved!.chat, { role: 'you' as const, text, ...mark }, ...reply].slice(-ANSWER_TURNS);
  return saveAnswers(app.id, { text: answers, chat });
}

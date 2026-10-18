/**
 * A last line of defence on the one path where text can leave without the user
 * reading it first.
 *
 * The reply flow asks Claude for a "certain" verdict, and a certain verdict is
 * what puts a draft in "Replied for you" ready to send in one tap. That makes
 * the verdict itself the thing worth attacking: a message crafted to read as a
 * routine "just send me your CV" while also instructing the model to mark it
 * safe.
 *
 * The model is told to refuse that, and in testing it does. This does not rely
 * on it. A message carrying the shape of an instruction aimed at a model is
 * downgraded to "needs you" here, in ordinary code, after the model has spoken.
 *
 * Deliberately a blunt instrument. It cannot catch a clever paraphrase, and it
 * is not meant to — it is the floor, not the ceiling. Its only failure mode is
 * asking the user to read a message they could have sent blind, which costs one
 * tap. The opposite failure costs a message sent in their name.
 */

// An order to the assistant: the start of a sentence, or after "please", "can you" and so on.
// A bare word in the middle of a sentence ("I ran the build", "I read .env files") does not match.
const ASK = String.raw`(?:^|[.!?\n:;]\s*|\b(?:please|pls|then|now|just|first|next|and|you (?:must|should|will|need to)|(?:can|could|would|will) you)\s+)`;
// A word that starts a shell command.
const CMD = String.raw`(?:ls|cat|rm|curl|wget|sudo|bash|sh|zsh|chmod|chown|nc|ncat|env|printenv|echo|ssh|scp|python3?|node|perl|ruby|powershell|cmd)`;
// The shorter list for a command without backticks, where words such as "node" are normal prose.
const CMD_BARE = String.raw`(?:ls|cat|rm|curl|wget|sudo|bash|sh|zsh|chmod|chown|nc|ncat|printenv|ssh|scp|powershell|cmd)`;

const SIGNALS: { re: RegExp; why: string }[] = [
  { re: /\b(ignore|disregard|forget|override)\b[^.!?\n]{0,40}\b(previous|prior|above|earlier|all|any|these|those|your)\b[^.!?\n]{0,30}\b(instruction|prompt|rule|direction|message|context|system)/i,
    why: 'it tries to override the assistant’s instructions' },
  { re: new RegExp(`${ASK}(show|reveal|print|repeat|tell|output|display|give|share|leak|ignore|bypass|forget)\\b[^.!?\\n]{0,40}\\b(system|developer|initial|hidden|original)\\s+(prompt|message|instruction)`, 'i'),
    why: 'it asks for the system prompt' },
  { re: /\bwhat\s+(is|are|were)\s+your\s+(system\s+)?(prompt|instructions|rules)\b|\brepeat\s+(everything|all|the text)\s+above\b/i, why: 'it asks for the system prompt' },
  { re: new RegExp(`${ASK}(run|execute|exec)\\s+(the\\s+|this\\s+|these\\s+|a\\s+)?(following\\s+)?(shell\\s+|bash\\s+|terminal\\s+)?(commands?|scripts?)\\b(?![- ]line)`, 'i'), why: 'it asks for a shell command to run' },
  { re: new RegExp(`${ASK}(run|execute|exec)\\b[^.!?\\n\`]{0,20}\`\\s*${CMD}\\b`, 'i'), why: 'it asks for a shell command to run' },
  { re: new RegExp(`${ASK}(run|execute|exec)\\s+(sudo\\s+)?${CMD_BARE}\\b`, 'i'), why: 'it asks for a shell command to run' },
  { re: new RegExp(`${ASK}open\\s+(a\\s+|an\\s+|the\\s+)?(reverse\\s+)?(shell|terminal|bash|console)\\b`, 'i'), why: 'it asks for a shell command to run' },
  { re: /\b(ba|z)?sh\s+-c\b|\/bin\/(ba)?sh\b|\brm\s+-[a-z]*r[a-z]*\b|\bsudo\s+(rm|su|chmod|chown|cat|bash|sh|apt|curl|wget)\b/i, why: 'it contains a shell command' },
  { re: new RegExp(`${ASK}(read|cat|open|show|print|dump|send|email|upload|share|attach|reveal|leak|display|output|list)\\b[^.!?\\n]{0,40}(\\.env\\b|/etc/|~/|\\.ssh\\b|id_rsa|waypoint\\.db|\\.\\./)`, 'i'), why: 'it asks to read or send a private file' },
  { re: new RegExp(`${ASK}(read|show|print|dump|send|upload)\\b[^.!?\\n]{0,25}\\b(files?|contents?)\\b[^.!?\\n]{0,25}\\b(on|from|of)\\b[^.!?\\n]{0,20}\\b(server|disk|machine|computer|filesystem|host)\\b`, 'i'), why: 'it asks to read or send a private file' },
  { re: new RegExp(`${ASK}(show|list|give|send|tell|reveal|read|fetch|dump|export|print|display|access|leak)\\b[^.!?\\n]{0,50}\\b(other|another|all|every|each|different)\\s+(the\\s+)?(users?|accounts?|members?|customers?|tenants?)\\b`, 'i'), why: 'it asks about the data of other users' },
  { re: /\byou are (now )?(an?|the)\b[^.!?\n]{0,40}\b(assistant|ai|model|bot|agent)\b/i, why: 'it tries to reassign the assistant’s role' },
  { re: /\b(mark|set|treat|consider|flag)\b[^.!?\n]{0,30}\b(this|it|the reply|the message)\b[^.!?\n]{0,30}\b(certain|safe|verified|approved|auto)/i,
    why: 'it asks for the reply to be marked safe to send' },
  { re: /\b(send|reply)\b[^.!?\n]{0,30}\b(automatically|without|no need for)\b[^.!?\n]{0,30}\b(review|checking|approval|confirmation|reading)/i,
    why: 'it asks for the reply to be sent without review' },
  { re: /<\/?(untrusted|system|assistant|human|user|instructions?)[^>]*>/i, why: 'it contains prompt-fence markup' },
  { re: /\{\{[^}]*\}\}|\[\[[^\]]*\]\]/, why: 'it contains template markup aimed at a model' },
  { re: /\b(as|this is)\b[^.!?\n]{0,20}\b(anthropic|openai|your (developer|creator|administrator))\b/i,
    why: 'it falsely claims to speak for the assistant’s developer' },
  { re: new RegExp(`${ASK}(send|share|give|tell|provide|reveal|show|paste|print|read|dump|forward|email)\\b[^.!?\\n]{0,30}\\b(api[_ -]?keys?|passwords?|credentials?|tokens?|ssh keys?|secrets?|\\.env)(?![\\w-])`, 'i'), why: 'it asks about credentials' },
  { re: /\bwhat('s|\s+is|\s+are)\b[^.!?\n]{0,20}\b(your|the)\b[^.!?\n]{0,15}\b(api[_ -]?keys?|passwords?|credentials?|tokens?|ssh keys?)\b/i, why: 'it asks about credentials' },
];

// Tag/private-use codepoints (E0000-E007F) carry no glyph and are the classic
// way to smuggle a payload past a human reader. Zero-width joiners, the BOM,
// and word joiners can hide word boundaries the signal patterns above rely
// on. None of these belong in a LinkedIn message.
const INVISIBLES_SRC = '[\\u{E0000}-\\u{E007F}]|[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\uFEFF]';
const INVISIBLES = { re: new RegExp(INVISIBLES_SRC, 'u'), why: 'it contains hidden invisible characters' };
const INVISIBLES_ALL = new RegExp(INVISIBLES_SRC, 'gu');

/** The text without invisible characters, folded with NFKC. The signals match on this form. */
export function normaliseForScan(text: string): string {
  return text.replace(INVISIBLES_ALL, '').normalize('NFKC');
}

export type InjectionCheck = { suspicious: boolean; why: string | null };

export function checkForInjection(text: string): InjectionCheck {
  // Find the invisibles on the raw text, because normalising removes them.
  // Then match the other signals on the normalised copy, so a fullwidth form or
  // a split word ("ig<ZWSP>nore") is caught like the plain spelling.
  if (INVISIBLES.re.test(text)) return { suspicious: true, why: INVISIBLES.why };
  const folded = normaliseForScan(text);
  for (const { re, why } of SIGNALS) {
    if (re.test(folded)) return { suspicious: true, why };
  }
  return { suspicious: false, why: null };
}

/**
 * The reason to refuse a request that the user typed, or null. The refine box and
 * the referral edit call this before any task or model call. It uses the same signals
 * as `checkForInjection`.
 */
export function refuseUserRequest(text: string): string | null {
  return checkForInjection(text).why;
}

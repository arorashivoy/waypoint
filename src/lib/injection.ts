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

const SIGNALS: { re: RegExp; why: string }[] = [
  { re: /\b(ignore|disregard|forget|override)\b[^.!?\n]{0,40}\b(previous|prior|above|earlier|all|any|these|those|your)\b[^.!?\n]{0,30}\b(instruction|prompt|rule|direction|message|context|system)/i,
    why: 'it tries to override the assistant’s instructions' },
  { re: /\b(system|developer)\s+(prompt|message|instruction)/i, why: 'it refers to the system prompt' },
  { re: /\byou are (now )?(an?|the)\b[^.!?\n]{0,40}\b(assistant|ai|model|bot|agent)\b/i, why: 'it tries to reassign the assistant’s role' },
  { re: /\b(mark|set|treat|consider|flag)\b[^.!?\n]{0,30}\b(this|it|the reply|the message)\b[^.!?\n]{0,30}\b(certain|safe|verified|approved|auto)/i,
    why: 'it asks for the reply to be marked safe to send' },
  { re: /\b(send|reply)\b[^.!?\n]{0,30}\b(automatically|without|no need for)\b[^.!?\n]{0,30}\b(review|checking|approval|confirmation|reading)/i,
    why: 'it asks for the reply to be sent without review' },
  { re: /<\/?(untrusted|system|assistant|human|user|instructions?)[^>]*>/i, why: 'it contains prompt-fence markup' },
  { re: /\{\{[^}]*\}\}|\[\[[^\]]*\]\]/, why: 'it contains template markup aimed at a model' },
  { re: /\b(as|this is)\b[^.!?\n]{0,20}\b(anthropic|openai|your (developer|creator|administrator))\b/i,
    why: 'it falsely claims to speak for the assistant’s developer' },
  { re: /\b(api[_ -]?key|password|credential|token|\.env\b|ssh key)\b/i, why: 'it asks about credentials' },
  // Tag/private-use codepoints (E0000-E007F) carry no glyph and are the classic
  // way to smuggle a payload past a human reader. Zero-width joiners, the BOM,
  // and word joiners can hide word boundaries the signal patterns above rely
  // on. None of these belong in a LinkedIn message.
  { re: /[\u{E0000}-\u{E007F}]|[​-‏‪-‮⁠-⁤﻿]/u,
    why: 'it contains hidden invisible characters' },
];

export type InjectionCheck = { suspicious: boolean; why: string | null };

export function checkForInjection(text: string): InjectionCheck {
  // Detect the invisibles on the raw text — normalization would strip them —
  // then run the semantic patterns over an NFKC-folded copy so fullwidth,
  // compatibility, and homoglyph forms of "ignore previous instructions" are
  // caught alongside the plain ASCII spelling.
  const invisibles = SIGNALS[SIGNALS.length - 1];
  if (invisibles.re.test(text)) return { suspicious: true, why: invisibles.why };
  const folded = text.normalize('NFKC');
  for (const { re, why } of SIGNALS) {
    if (re === invisibles.re) continue;
    if (re.test(folded)) return { suspicious: true, why };
  }
  return { suspicious: false, why: null };
}

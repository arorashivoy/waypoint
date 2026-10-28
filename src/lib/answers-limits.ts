/** The limits of "Application questions". This file has no import, so the handler can read it while modules load. */

/** The longest list of questions that a user can paste. */
export const QUESTIONS_MAX = 4000;
/** The longest message of the chat. */
export const ANSWER_MESSAGE_MAX = 1000;
/** The longest text of the answers, as Claude writes it or as the user edits it. */
export const ANSWER_TEXT_MAX = 12000;
/** The most turns of the chat that Waypoint keeps. */
export const ANSWER_TURNS = 20;

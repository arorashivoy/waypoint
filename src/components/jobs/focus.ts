/** The widest screen that counts as a phone. The job is a full screen there. */
export const PHONE_QUERY = '(max-width: 639px)';

/**
 * The row that gets focus when a job closes. A closed job gives the row of that job back to the person, but only
 * when focus has nowhere else to be: if the person moved focus to a control, it stays there.
 * `focusIsLost` is true when the active element is the page body or is not on the page any more.
 */
export function rowToFocus(previous: string | null, now: string | null, focusIsLost: boolean): string | null {
  return previous !== null && now === null && focusIsLost ? previous : null;
}

/** A Gmail compose window with the recipient, subject and text filled in. The user presses Send there. */
export function gmailCompose(v: { email: string; subject: string; body: string }): string {
  const q = new URLSearchParams({ view: 'cm', fs: '1', to: v.email, su: v.subject, body: v.body });
  return `https://mail.google.com/mail/?${q.toString().replace(/\+/g, '%20')}`;
}

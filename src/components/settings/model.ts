/**
 * The plain logic of the Settings screen, with no React, so the tests run it.
 * The sections, the section in the URL, and the lines of text that the sections show.
 */

export const SECTIONS = [
  { id: 'account', label: 'Account', admin: false },
  { id: 'claude', label: 'Claude', admin: false },
  { id: 'job-search', label: 'Job search', admin: false },
  { id: 'integrations', label: 'Integrations', admin: false },
  { id: 'data', label: 'Data', admin: false },
  { id: 'admin', label: 'Admin', admin: true },
] as const;

export type SettingsSection = (typeof SECTIONS)[number]['id'];

export const DEFAULT_SECTION: SettingsSection = 'account';

/** The sections that a user sees. Only the admin sees Admin. */
export const visibleSections = (isAdmin: boolean) => SECTIONS.filter((s) => isAdmin || !s.admin);

/** The section that a query string names. A missing name, an unknown name, or Admin for a member gives the first section. */
export function readSection(search: string, isAdmin: boolean): SettingsSection {
  const raw = new URLSearchParams(search).get('section');
  return visibleSections(isAdmin).find((s) => s.id === raw)?.id ?? DEFAULT_SECTION;
}

/** The query string of the Settings place with a section. The first section has no `section` part. */
export const sectionQuery = (section: SettingsSection): string => (section === DEFAULT_SECTION ? '?view=settings' : `?view=settings&section=${section}`);

export const CLI_OFF_LINE = 'Claude CLI is off: it failed its self-test. The reason is on the admin health page.';

type CapInput = { sharedAvailable: boolean; capUsd: number; sharedSpentUsd: number; resetsAt: string };

/** The use of the shared key against the monthly cap, with the reset date. Null when there is no shared key. */
export function capLine(c: CapInput): string | null {
  if (!c.sharedAvailable) return null;
  const reset = new Date(c.resetsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `Shared key this month: $${c.sharedSpentUsd.toFixed(2)} of $${c.capUsd.toFixed(2)}. It resets on ${reset}.`;
}

/** The status text names Settings. This screen is Settings, so the text points to the Claude section. */
export const claudeDetail = (detail: string) => detail.replace(' in Settings', ' here');

export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

export function device(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return ua.slice(0, 40);
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

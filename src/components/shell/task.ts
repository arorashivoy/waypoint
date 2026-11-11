export interface Analysing {
  running: boolean;
  done: number;
  total: number;
}

/** The line for background work: "Checking 12 jobs". Null when nothing runs. */
export function taskLine(analysing: Analysing | null | undefined): string | null {
  if (!analysing?.running) return null;
  const left = Math.max(analysing.total - analysing.done, 1);
  return `Checking ${left} ${left === 1 ? 'job' : 'jobs'}`;
}

/**
 * The banner for an admin whose Claude CLI failed its self-test. Null when Claude works, or when
 * the CLI is not what serves this user. `cliRetest` means that the worker tests again without help.
 */
export function claudeOffNote(claude: { cliOff?: boolean; cliRetest?: boolean } | null | undefined): { what: string; fix: string } | null {
  if (!claude?.cliOff) return null;
  return {
    what: 'Claude is off.',
    fix: claude.cliRetest
      ? 'The Claude CLI failed its self-test. Waypoint tests it again in 10 minutes or less. Until then, new jobs get no analysis from Claude.'
      : 'The Claude CLI failed its self-test. Read the reason on the admin health page, then restart the worker.',
  };
}

/** The Claude line of the sidebar, in plain words. */
export function claudeLine(mode: string): string {
  if (mode === 'cli') return 'Claude: the admin subscription';
  if (mode === 'own') return 'Claude: your API key';
  if (mode === 'shared') return 'Claude: the shared key';
  return 'Claude: not connected';
}

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

/** The Claude line of the sidebar, in plain words. */
export function claudeLine(mode: string): string {
  if (mode === 'cli') return 'Claude: the admin subscription';
  if (mode === 'own') return 'Claude: your API key';
  if (mode === 'shared') return 'Claude: the shared key';
  return 'Claude: not connected';
}

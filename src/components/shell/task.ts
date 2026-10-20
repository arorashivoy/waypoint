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

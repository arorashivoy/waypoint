export type RefreshResult = { added: number; total: number; report: { source: string; error?: unknown }[]; analysing?: { total: number } | null; note?: string };

const SHOWN = 4;

/** The one line that tells what a refresh did. A source that fails in many countries shows once. */
export function refreshLine(res: RefreshResult): string {
  const failed = [...new Set((res.report || []).filter((r) => r.error).map((r) => r.source))];
  const queued = res.analysing?.total || 0;
  const names = failed.length > SHOWN ? `${failed.slice(0, SHOWN).join(', ')} and ${failed.length - SHOWN} more` : failed.join(', ');
  return (
    res.note ??
    `${res.added} new, ${res.total} live in your countries.` +
      (queued ? ` Claude is reading the top ${queued}.` : '') +
      (failed.length ? ` ${failed.length} source${failed.length > 1 ? 's' : ''} failed: ${names}.` : '')
  );
}

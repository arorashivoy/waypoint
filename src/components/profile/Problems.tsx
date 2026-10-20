/** A list of problems. Set `live` for the one list that appears after an action: screen readers then read it. */
export default function Problems({ list, live }: { list?: string[]; live?: boolean }) {
  if (!list?.length) return null;
  return (
    <div className="ui-error pf-problems" role={live ? 'alert' : undefined}>
      <ul>{list.map((e) => <li key={e}>{e}</li>)}</ul>
    </div>
  );
}

/** The problems of one form field. The field shows them next to it, so they are not a live region. */
export function fieldProblem(list?: string[]): string | undefined {
  return list?.length ? list.join(' ') : undefined;
}

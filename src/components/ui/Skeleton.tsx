/** Placeholder rows with the layout of a list row: title, line, pill. */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="ui-skels" aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ui-skel" aria-hidden="true">
          <span className="t" />
          <span className="n" />
          <span className="r" />
        </div>
      ))}
    </div>
  );
}

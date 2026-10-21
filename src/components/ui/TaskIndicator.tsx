/** `silent` drops the live region. The shell has 3 copies of this text, and one always-mounted region (`TaskAnnouncer`) says it. */
export function TaskIndicator({ text, silent }: { text: string | null; silent?: boolean }) {
  if (!text) return null;
  return (
    <div className="ui-task" role={silent ? undefined : 'status'}>
      <span className="ui-task-dot" aria-hidden="true" />
      {text}
    </div>
  );
}

/** The one live region for the running task. It stays in the page, so a screen reader hears each new text. */
export function TaskAnnouncer({ text }: { text: string | null }) {
  return <div className="sr-only" role="status" aria-live="polite">{text}</div>;
}

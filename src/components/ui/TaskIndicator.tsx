export function TaskIndicator({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="ui-task" role="status">
      <span className="ui-task-dot" aria-hidden="true" />
      {text}
    </div>
  );
}

/** The "‹ Back" row of a part that opens as its own screen. CSS shows it under 640 px only, and only for the open part. */
export function PartBack({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="jd-back">
      <button type="button" className="sh-back" onClick={onBack}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back
      </button>
      <h2 tabIndex={-1}>{label}</h2>
    </div>
  );
}

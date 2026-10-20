'use client';

import { useEffect, useRef } from 'react';
import { ApplyBar } from './ApplyBar';
import { CvSection } from './CvSection';
import { FitSection } from './FitSection';
import { JobHeader } from './JobHeader';
import type { JobDetailState, Part } from './types';
import { WayInSection } from './WayInSection';

/**
 * The detail of one job, in this order: header, fit, your way in, your CV, the apply bar.
 * Under 640 px a `part` shows one section on its own screen. CSS does this with `data-part`,
 * so the markup is the same on every device.
 */
export function JobBody({ d, part, onPart, onClose }: { d: JobDetailState; part: Part | null; onPart: (p: Part | null) => void; onClose: () => void }) {
  const back = () => onPart(null);
  const root = useRef<HTMLDivElement>(null);
  const last = useRef<Part | null>(null);

  // A part is its own screen on a phone. The fold head that had focus is hidden then, so focus moves with the screen:
  // to the heading of the part when it opens, and back to the fold head that opened it when it closes.
  useEffect(() => {
    const el = root.current;
    const was = last.current;
    last.current = part;
    if (!el || part === was) return;
    if (part) el.querySelector<HTMLElement>(`.jd-${part} .jd-back h2`)?.focus();
    else if (was) el.querySelector<HTMLElement>(`.jd-${was} .ui-fold-head`)?.focus();
  }, [part]);
  return (
    <div className="jd" data-part={part ?? undefined} ref={root}>
      <div className="jd-scroll">
        <JobHeader job={d.job} onBack={onClose} />
        <div className="jd-main">
          <FitSection job={d.job} />
          <WayInSection d={d} onPart={onPart} onBack={back} />
          <CvSection d={d} onPart={onPart} onBack={back} />
        </div>
      </div>
      <ApplyBar url={d.job.url} applied={d.job.isApplied} error={d.applyError} onApply={d.markApplied} />
    </div>
  );
}

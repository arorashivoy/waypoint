'use client';

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
  return (
    <div className="jd" data-part={part ?? undefined}>
      <div className="jd-scroll">
        <JobHeader job={d.job} onBack={onClose} />
        <div className="jd-main">
          <FitSection job={d.job} />
          <WayInSection d={d} onPart={onPart} onBack={back} />
          <CvSection d={d} onPart={onPart} onBack={back} />
        </div>
      </div>
      <ApplyBar url={d.job.url} applied={d.job.isApplied} onApply={d.markApplied} />
    </div>
  );
}

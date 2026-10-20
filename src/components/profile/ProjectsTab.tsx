'use client';

import type { ClaimsDoc } from '@/lib/profile/doc';
import ItemList from './ItemList';
import type { ProfileTab } from './model';

type Props = { doc: ClaimsDoc; onSaved: (reply: any) => void; setToast: (s: string) => void; onGoto?: (tab: ProfileTab) => void };

export default function ProjectsTab({ doc, onSaved, setToast, onGoto }: Props) {
  return (
    <div className="pf-stack">
      <ItemList
        kind="project"
        title="Projects"
        noun="project"
        primary
        empty={{ cause: 'No projects yet.', detail: 'Add one, or let Waypoint draft projects from your GitHub repositories.', alt: onGoto && { label: 'Import from GitHub', onClick: () => onGoto('imports') } }}
        items={doc.targets.projects}
        doc={doc}
        onSaved={onSaved}
        setToast={setToast}
      />
    </div>
  );
}

'use client';

import type { ClaimsDoc } from '@/lib/profile/doc';
import ItemList from './ItemList';

export default function ProjectsTab({ doc, onSaved, setToast }: { doc: ClaimsDoc; onSaved: (reply: any) => void; setToast: (s: string) => void }) {
  return <ItemList kind="project" title="Projects" empty="No projects yet. Add one, or import your GitHub repositories in the Imports tab." items={doc.targets.projects} doc={doc} onSaved={onSaved} setToast={setToast} />;
}

import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth/guard';
import { handle } from '@/lib/auth/http';
import { checkDoc, emptyDoc } from '@/lib/profile/doc';
import { jsonWithEtag } from '@/lib/etag';
import { loadProfileDoc, profileVersion } from '@/lib/profile/store';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const [doc, version, pendingDrafts] = await Promise.all([
    loadProfileDoc(user.id),
    profileVersion(user.id),
    db.profileDraft.count({ where: { userId: user.id, status: 'pending' } }),
  ]);
  const shown = doc ?? emptyDoc(user.name);
  return jsonWithEtag(req, { doc: shown, warnings: checkDoc(shown).warnings, version, pendingDrafts });
});

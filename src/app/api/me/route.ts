import { handle } from '@/lib/auth/http';
import { requireUser } from '@/lib/auth/guard';
import { jsonWithEtag } from '@/lib/etag';
import { buildMe } from '@/lib/state';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return jsonWithEtag(req, await buildMe(user.id));
});

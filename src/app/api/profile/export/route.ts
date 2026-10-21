import { requireUser } from '@/lib/auth/guard';
import { handle } from '@/lib/auth/http';
import { emptyDoc, toYaml } from '@/lib/profile/doc';
import { loadProfileDoc } from '@/lib/profile/store';

export const dynamic = 'force-dynamic';

/** The profile of the signed-in user as claims.yml (spec 3.3, YAML export). */
export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const doc = (await loadProfileDoc(user.id)) ?? emptyDoc(user.name);
  return new Response(toYaml(doc), {
    headers: {
      'content-type': 'application/yaml; charset=utf-8',
      'content-disposition': 'attachment; filename="claims.yml"',
      'cache-control': 'no-store',
    },
  });
});

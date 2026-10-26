import TokenForm from '@/components/TokenForm';
import { turnstileSiteKey } from '@/lib/auth/turnstile';

export const dynamic = 'force-dynamic';

export default function InvitePage({ params }: { params: { token: string } }) {
  return <TokenForm token={params.token} siteKey={turnstileSiteKey()} />;
}

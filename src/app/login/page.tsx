import LoginForm from '@/components/LoginForm';
import { safeNext } from '@/lib/auth/safe-next';
import { turnstileSiteKey } from '@/lib/auth/turnstile';

export const dynamic = 'force-dynamic';

export default function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  return <LoginForm next={safeNext(searchParams.next)} siteKey={turnstileSiteKey()} />;
}

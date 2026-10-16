import LoginForm from '@/components/LoginForm';

export const dynamic = 'force-dynamic';

/** Only a local path is a safe place to go after sign-in. */
function safeNext(v: unknown): string {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : '/';
}

export default function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  return <LoginForm next={safeNext(searchParams.next)} />;
}

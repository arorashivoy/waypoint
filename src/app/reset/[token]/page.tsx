import TokenForm from '@/components/TokenForm';

export const dynamic = 'force-dynamic';

export default function ResetPage({ params }: { params: { token: string } }) {
  return <TokenForm token={params.token} />;
}

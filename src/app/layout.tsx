import type { Metadata, Viewport } from 'next';
import { Onest, Syne } from 'next/font/google';
import './globals.css';

const syne = Syne({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-syne', display: 'swap' });
const onest = Onest({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-onest', display: 'swap' });

export const metadata: Metadata = {
  title: 'Waypoint',
  description: 'Jobs in your countries, a referral route through people you already know, and a CV tuned to each posting.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#121019',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${syne.variable} ${onest.variable}`}>
      <body>{children}</body>
    </html>
  );
}

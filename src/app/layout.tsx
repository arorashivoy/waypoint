import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';

// The fonts are files in the repository (src/app/fonts), so a build needs no network. Each file is a variable font, latin subset.
const syne = localFont({ src: './fonts/Syne-latin-variable.woff2', weight: '600 700', variable: '--font-syne', display: 'swap' });
const onest = localFont({ src: './fonts/Onest-latin-variable.woff2', weight: '400 600', variable: '--font-onest', display: 'swap' });

export const metadata: Metadata = {
  title: 'Waypoint',
  description: 'Jobs in your countries, a referral route through people you already know, and a CV tuned to each posting.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent' },
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

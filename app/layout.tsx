import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, Plus_Jakarta_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import 'leaflet/dist/leaflet.css';

// Display font — Space Grotesk (variable font: wght 300-700)
const spaceGrotesk = Space_Grotesk({
  variable: '--font-display',
  subsets: ['latin'],
  display: 'swap',
});

// Body font — Plus Jakarta Sans (variable font: wght 200-800)
// Aliased to --font-dm-sans for backwards compatibility with existing components
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: '--font-dm-sans',
  subsets: ['latin'],
  display: 'swap',
});

// Mono font — IBM Plex Mono; aliased to --font-jb-mono for back-compat
const ibmPlexMono = IBM_Plex_Mono({
  variable: '--font-jb-mono',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'BirdRadar',
  description: 'Live birding map with eBird data and life list tracking',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${plusJakartaSans.variable} ${ibmPlexMono.variable} h-full`}
    >
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}

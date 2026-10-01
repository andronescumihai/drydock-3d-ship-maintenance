import type { Metadata, Viewport } from 'next';

/*
 * Fonts are self-hosted through Fontsource rather than next/font/google.
 * The build then needs no network access to fonts.googleapis.com, and the
 * deployed app makes no third-party request at runtime.
 */
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'DryDock — Vessel Maintenance Digital Twin',
  description:
    'Interactive 3D decision support for shipboard maintenance, running a real graph engine over a modeled sample vessel.',
};

export const viewport: Viewport = {
  themeColor: '#070a11',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html lang="en">
      <body className="bg-abyss text-ink antialiased">{children}</body>
    </html>
  );
}

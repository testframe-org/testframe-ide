import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'TestFrame IDE',
  description: 'Visual authoring of TestFrame projects: frames, cards, sources and environments.'
};

/** The editor shell. The i18n provider (editor/i18n.tsx) keeps <html lang> in sync with the UI language. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#F5F5F7] text-slate-800 antialiased">{children}</body>
    </html>
  );
}

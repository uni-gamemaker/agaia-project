import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ajaia Collaborative Editor',
  description: 'Lightweight collaborative document editor',
};

/**
 * App shell — **ChatGPT owns this file** (per docs/AGENT_CONTRACT.md §8).
 *
 * DeepSeek stripped the scaffold's Google Fonts import so that `next build` does not
 * depend on an external font download. Kimi/ChatGPT own the visual shell and are free
 * to restore a font setup of their choice.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

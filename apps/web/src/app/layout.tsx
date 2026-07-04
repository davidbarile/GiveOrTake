import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Give or Take',
  description: 'A social experiment game',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

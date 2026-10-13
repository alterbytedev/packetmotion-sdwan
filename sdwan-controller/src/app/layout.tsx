import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RuntimeErrorGuard } from '@/components/runtime-error-guard';
import './globals.css';

export const metadata: Metadata = {
  title: 'SD-WAN Controller',
  description: 'Manage branches, provisioning, and network configuration.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RuntimeErrorGuard>{children}</RuntimeErrorGuard>
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';

export const metadata: Metadata = {
  title: 'DexFiat | Stellar',
  description: 'AI-powered XLM-to-fiat conversion on the Stellar network',
  manifest: '/manifest.webmanifest',
  themeColor: '#2563eb',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html suppressHydrationWarning>
      <body className="antialiased">
        <Providers>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

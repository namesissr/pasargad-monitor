import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'پنل مانیتورینگ — پاسارگاد میزبان',
  description: 'مدیریت، مانیتورینگ و گزارش مصرف سرورهای اختصاصی',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0A0D12',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="bg-rack text-[--text] min-h-screen">{children}</body>
    </html>
  );
}

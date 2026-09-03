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
      <head>
        {/*
          فقط دو وزنی که واقعاً روی هر صفحه رندر می‌شوند پیش‌بارگذاری می‌شوند.
          بدون این، متن اول با Tahoma ظاهر می‌شود و بعد می‌پرد — روی پنلی که
          کل روز باز است، آن پرش هر بار دیده می‌شود.
          Light و SemiBold عمداً اینجا نیستند تا پهنای باند اول صفحه هدر نرود.
        */}
        <link
          rel="preload"
          href="/fonts/YekanBakh-Regular.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/YekanBakh-Bold.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />
      </head>
      <body className="bg-rack text-[--text] min-h-screen">{children}</body>
    </html>
  );
}

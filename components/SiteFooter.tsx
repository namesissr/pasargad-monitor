import Link from 'next/link';

/**
 * پاورقی سایت.
 *
 * سال از تاریخ ساخت صفحه می‌آید نه از یک عدد ثابت — عدد ثابت هر ژانویه
 * کهنه می‌شود و کسی یادش نمی‌افتد عوضش کند.
 *
 * کامپوننت سروری است: هیچ حالتی ندارد و بردنش به مرورگر فقط جاوااسکریپت
 * اضافه می‌کند.
 *
 * کلاس no-print دارد چون در چاپ فاکتور، پاورقی سایت جای پاورقی خود
 * فاکتور را می‌گیرد.
 */
export function SiteFooter({ compact = false }: { compact?: boolean }) {
  const year = new Date().getFullYear();

  return (
    <footer className={`no-print border-t border-line ${compact ? 'mt-8' : 'mt-12'}`}>
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-6 space-y-3">
        <p className="text-[11px] text-muted leading-relaxed text-center">
          تمامی حقوق برای شرکت میزبان داده‌پردازی پاسارگاد محفوظ است. هرگونه کپی‌برداری پیگرد
          قانونی دارد.
        </p>

        <div className="flex items-center justify-center gap-4 text-[11px] text-muted/70">
          <Link href="/store" className="hover:text-cyan">
            فروشگاه
          </Link>
          <Link href="/portal" className="hover:text-cyan">
            پنل کاربری
          </Link>
          <span className="ltr">{year}</span>
        </div>
      </div>
    </footer>
  );
}

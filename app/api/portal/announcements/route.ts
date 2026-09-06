import { query } from '@/lib/db';
import { requireCustomer } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * اطلاعیه‌های خوانده‌نشده مشتری.
 *
 * ── فیلتر بازه، سمت دیتابیس ────────────────────────────────
 *
 * شرط فعال‌بودن و بازه تاریخ در همان کوئری است، نه در رابط. اگر رابط
 * فیلتر می‌کرد، اطلاعیه منقضی هم به مرورگر می‌رفت و یک اشتباه کوچک در
 * جاوااسکریپت آن را دوباره نشان می‌داد.
 *
 * ── خوانده‌شدن برای هر مشتری جداست ─────────────────────────
 *
 * اطلاعیه برای همه است ولی هرکس باید خودش ببنددش. با یک ستون روی خود
 * اطلاعیه، اولین کسی که «متوجه شدم» را می‌زد آن را برای همه می‌بست.
 */
export async function GET() {
  return handle(async () => {
    const { customerId } = await requireCustomer();

    const announcements = await query(
      `SELECT a.id, a.title, a.body, a.severity, a.created_at
         FROM announcements a
         LEFT JOIN announcement_reads r
           ON r.announcement_id = a.id AND r.customer_id = $1
        WHERE a.is_active
          AND r.customer_id IS NULL
          AND (a.starts_at IS NULL OR a.starts_at <= now())
          AND (a.ends_at   IS NULL OR a.ends_at   >  now())
        ORDER BY
          -- مهم‌ترین اول: اگر چند اطلاعیه باز است، اولی که دیده می‌شود
          -- باید آنی باشد که بیشتر اهمیت دارد
          CASE a.severity WHEN 'danger' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END,
          a.created_at DESC
        LIMIT 20`,
      [customerId],
    );

    return ok({ announcements });
  });
}

/** ثبت «متوجه شدم» */
export async function POST(req: Request) {
  return handle(async () => {
    const { customerId } = await requireCustomer();
    const body = await readJson<{ id?: unknown }>(req);

    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return fail('شناسه اطلاعیه نامعتبر است', 400);

    // ON CONFLICT یعنی زدن دوباره دکمه خطا نمی‌دهد. کاربری که دو بار
    // کلیک کند نباید پیام خطا ببیند.
    await query(
      `INSERT INTO announcement_reads (announcement_id, customer_id)
       VALUES ($1, $2)
       ON CONFLICT (announcement_id, customer_id) DO NOTHING`,
      [id, customerId],
    );

    return ok({ ok: true });
  });
}

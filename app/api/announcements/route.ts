import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * اطلاعیه‌ها — از دید پنل.
 *
 * ── اطلاعیه حذف نمی‌شود، غیرفعال می‌شود ────────────────────
 *
 * حذفش ردیف‌های announcement_reads را هم می‌برد، یعنی سابقه «چه کسی چه
 * چیزی را دید» از دست می‌رود. آن سابقه دقیقا همان چیزی است که وقتی
 * مشتری می‌گوید «به من اطلاع ندادید» لازم می‌شود.
 *
 * حذف واقعی فقط برای اطلاعیه‌ای که هیچ‌کس ندیده مجاز است.
 */

const SEVERITY = ['info', 'warn', 'danger'];

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);
    const id = idParam(url, 'id');

    // شمار خوانده‌ها کنار هر اطلاعیه: بدون آن معلوم نیست اطلاعیه به
    // دست کسی رسیده یا نه
    const rows = await query(
      `SELECT a.id, a.title, a.body, a.severity, a.is_active,
              a.starts_at, a.ends_at, a.created_at,
              u.username AS created_by_name,
              COALESCE(r.seen, 0)::int AS seen
         FROM announcements a
         LEFT JOIN users u ON u.id = a.created_by
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS seen FROM announcement_reads x
            WHERE x.announcement_id = a.id
         ) r ON TRUE
        ${id !== null ? 'WHERE a.id = $1' : ''}
        ORDER BY a.created_at DESC
        LIMIT 100`,
      id !== null ? [id] : [],
    );

    // تعداد مشتری‌های فعال، تا «۳ از ۲۰ دیدند» معنی داشته باشد
    const total = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM customers WHERE is_active`,
    );

    return ok({ announcements: rows, customers: total?.n ?? 0 });
  });
}

function validate(body: Record<string, unknown>) {
  const title = String(body.title ?? '').trim().slice(0, 200);
  if (title.length < 3) return { error: 'عنوان اطلاعیه را بنویسید' };

  const text = String(body.body ?? '').trim().slice(0, 5000);
  if (text.length < 5) return { error: 'متن اطلاعیه را بنویسید' };

  const severity = SEVERITY.includes(String(body.severity)) ? String(body.severity) : 'info';

  const starts = String(body.starts_at ?? '').trim();
  const ends = String(body.ends_at ?? '').trim();

  // بازه وارونه یعنی اطلاعیه‌ای که هرگز نشان داده نمی‌شود — و هیچ
  // خطایی هم نمی‌دهد، فقط ساکت غایب است
  if (starts && ends && new Date(starts) >= new Date(ends)) {
    return { error: 'تاریخ پایان باید بعد از تاریخ شروع باشد' };
  }

  return {
    value: {
      title,
      text,
      severity,
      starts,
      ends,
      is_active: body.is_active !== false && body.is_active !== 'false',
    },
  };
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = await requireUser();
    const body = await readJson<Record<string, unknown>>(req);

    const parsed = validate(body);
    if (parsed.error) return fail(parsed.error, 400);
    const v = parsed.value!;

    const row = await queryOne<{ id: number }>(
      `INSERT INTO announcements (title, body, severity, is_active, starts_at, ends_at, created_by)
       VALUES ($1, $2, $3, $4, NULLIF($5,'')::timestamptz, NULLIF($6,'')::timestamptz, $7)
       RETURNING id`,
      [v.title, v.text, v.severity, v.is_active, v.starts, v.ends, session.uid],
    );

    return ok({ id: row?.id }, { status: 201 });
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    await requireUser();
    const body = await readJson<Record<string, unknown>>(req);

    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return fail('شناسه اطلاعیه نامعتبر است', 400);

    // خاموش و روشن کردن سریع، بدون بازفرستادن کل فرم
    if (body.action === 'toggle') {
      const rows = await query<{ is_active: boolean }>(
        `UPDATE announcements SET is_active = NOT is_active, updated_at = now()
          WHERE id = $1 RETURNING is_active`,
        [id],
      );
      if (!rows.length) return fail('اطلاعیه پیدا نشد', 404);
      return ok({ is_active: rows[0].is_active });
    }

    const parsed = validate(body);
    if (parsed.error) return fail(parsed.error, 400);
    const v = parsed.value!;

    const rows = await query<{ id: number }>(
      `UPDATE announcements
          SET title = $2, body = $3, severity = $4, is_active = $5,
              starts_at = NULLIF($6,'')::timestamptz,
              ends_at   = NULLIF($7,'')::timestamptz,
              updated_at = now()
        WHERE id = $1 RETURNING id`,
      [id, v.title, v.text, v.severity, v.is_active, v.starts, v.ends],
    );
    if (!rows.length) return fail('اطلاعیه پیدا نشد', 404);

    return ok({ ok: true });
  });
}

/**
 * حذف، فقط اگر هیچ‌کس ندیده باشد.
 *
 * وگرنه سابقه «چه کسی چه چیزی را دید» از بین می‌رود — همان چیزی که
 * وقتی مشتری می‌گوید «به من اطلاع ندادید» لازم می‌شود.
 */
export async function DELETE(req: Request) {
  return handle(async () => {
    await requireUser();
    const id = idParam(new URL(req.url), 'id');
    if (id === null) return fail('شناسه اطلاعیه نامعتبر است', 400);

    const seen = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM announcement_reads WHERE announcement_id = $1`,
      [id],
    );
    if (Number(seen?.n) > 0) {
      return fail('این اطلاعیه را مشتری‌ها دیده‌اند و حذف نمی‌شود. غیرفعالش کنید.', 400);
    }

    const rows = await query<{ id: number }>(
      `DELETE FROM announcements WHERE id = $1 RETURNING id`,
      [id],
    );
    if (!rows.length) return fail('اطلاعیه پیدا نشد', 404);

    return ok({ ok: true });
  });
}

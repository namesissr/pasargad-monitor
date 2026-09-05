import { query, queryOne } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, handle, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ترافیک پیش‌خرید سرور اختصاصی.
 *
 * سرور اختصاصی سهمیه ماهانه ندارد. مشترک از همان اول ترافیک می‌خرد و هر
 * وقت تمام شد دوباره می‌خرد. ترافیک خریداری‌شده انقضا ندارد.
 *
 *   موجودی = مجموع خریدها − مصرف از تاریخ شروع شمارش
 *
 * servers.traffic_counted_from تاریخ شروع شمارش است و با اولین خرید هر
 * سرور گذاشته می‌شود. بدون آن، سروری که ماه‌ها پیش از شروع فروش
 * پیش‌خرید کار می‌کرده از روز اول بدهکار به دنیا می‌آمد.
 */

const BALANCE_SQL = `
  SELECT COALESCE((SELECT SUM(gb) FROM traffic_topups WHERE server_id = s.id), 0)::float8
           AS purchased,
         COALESCE((SELECT SUM(d.rx_bytes) FROM server_metrics_daily d
                    WHERE d.server_id = s.id
                      AND s.traffic_counted_from IS NOT NULL
                      AND d.day >= s.traffic_counted_from), 0)::float8 / 1073741824
           AS used
    FROM servers s WHERE s.id = $1`;

/** موجودی یک سرور؛ برای پاسخ‌ها و برای تصمیم مسلح‌کردن دوباره هشدارها */
async function balanceOf(serverId: number) {
  const r = await queryOne<{ purchased: number; used: number }>(BALANCE_SQL, [serverId]);
  const purchased = Number(r?.purchased || 0);
  const used = Number(r?.used || 0);
  return { purchased, used, balance: purchased - used };
}

/** فهرست خریدها؛ با server_id فقط همان سرور */
export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const url = new URL(req.url);

    const serverId = Number(url.searchParams.get('server_id'));
    const one = Number.isInteger(serverId);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);

    const params: unknown[] = [];
    let where = '';
    if (one) {
      params.push(serverId);
      where = `WHERE t.server_id = $${params.length}`;
    }
    params.push(limit);

    const rows = await query(
      `SELECT t.id, t.server_id, t.gb::float8 AS gb,
              t.price_toman::float8 AS price_toman, t.note, t.created_at,
              s.name AS server_name,
              c.name AS customer_name,
              u.username AS created_by_name
         FROM traffic_topups t
         JOIN servers s ON s.id = t.server_id
         LEFT JOIN customers c ON c.id = s.customer_id
         LEFT JOIN users u ON u.id = t.created_by
         ${where}
        ORDER BY t.created_at DESC
        LIMIT $${params.length}`,
      params,
    );

    // برای یک سرور، موجودی واقعی؛ برای نمای کلی فقط مجموع خرید — جمع
    // موجودی چند سرور عدد بی‌معنایی است، چون هر سرور دفتر خودش را دارد.
    const totals = one
      ? await balanceOf(serverId)
      : await queryOne<{ purchased: number }>(
          `SELECT COALESCE(SUM(gb), 0)::float8 AS purchased FROM traffic_topups`,
        );

    return ok({ topups: rows, totals });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = await requireUser();
    const body = await readJson<Record<string, unknown>>(req);

    const serverId = Number(body.server_id);
    if (!Number.isInteger(serverId)) return fail('سرور را انتخاب کنید', 400);

    const gb = Number(body.gb);
    if (!Number.isFinite(gb) || gb === 0) return fail('مقدار ترافیک را وارد کنید', 400);
    if (Math.abs(gb) > 1_000_000) return fail('مقدار ترافیک بیش از حد بزرگ است', 400);

    const price =
      body.price_toman === '' || body.price_toman === undefined || body.price_toman === null
        ? null
        : Number(body.price_toman);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return fail('مبلغ نامعتبر است', 400);
    }

    const server = await queryOne<{ id: number }>(`SELECT id FROM servers WHERE id = $1`, [
      serverId,
    ]);
    if (!server) return fail('سرور پیدا نشد', 404);

    await query(
      `INSERT INTO traffic_topups (server_id, gb, price_toman, note, created_by)
       VALUES ($1, $2, $3, NULLIF($4,''), $5)`,
      [serverId, gb, price, String(body.note ?? '').trim(), session.uid],
    );

    // شروع شمارش مصرف، با اولین خرید. مصرف پیش از این تاریخ به حساب
    // مشتری نوشته نمی‌شود — وگرنه سروری که ماه‌ها کار کرده از همان لحظه
    // خرید، بدهکار می‌شد.
    await query(
      `UPDATE servers SET traffic_counted_from = CURRENT_DATE
        WHERE id = $1 AND traffic_counted_from IS NULL`,
      [serverId],
    );

    // هشدارهای اتمام ترافیک پاک می‌شوند تا دوباره مسلح شوند.
    //
    // بدون این، مشتری‌ای که ترافیکش تمام شده و دوباره خریده، وقتی خرید
    // تازه هم تمام شود هیچ خبری نمی‌گرفت — چون ردیف هشدار از بار قبل
    // باقی مانده بود. سکوت، نه خطا.
    if (gb > 0) {
      await query(
        `DELETE FROM customer_notices
          WHERE server_id = $1 AND kind IN ('quota_90', 'quota_100')`,
        [serverId],
      );
    }

    const totals = await balanceOf(serverId);
    return ok({ ok: true, totals }, { status: 201 });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    await requireUser();
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isInteger(id)) return fail('شناسه نامعتبر است', 400);

    // برای اصلاح اشتباه بهتر است ترافیک منفی ثبت شود تا هر دو ردیف در
    // تاریخچه بمانند؛ ولی حذف هم ممکن است، برای ردیفی که اشتباهی ثبت شده.
    await query('DELETE FROM traffic_topups WHERE id = $1', [id]);
    return ok({ ok: true });
  });
}

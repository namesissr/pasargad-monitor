import { query, queryOne } from '@/lib/db';
import { requireAdmin, requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * فهرست و پیکربندی سوییچ‌ها.
 *
 * گذرواژه سوییچ مثل کلید ویژالیزور یک‌طرفه است: نوشتنی، هرگز خواندنی.
 * افزودن و ویرایش فقط از حساب مدیر، چون همین گذرواژه اجازه shut کردن
 * پورت‌ها را می‌دهد.
 *
 * خود اتصال به سوییچ اینجا انجام نمی‌شود. ورکر در چرخه بعدی (حداکثر نیم
 * دقیقه) می‌خواند و نتیجه — یا خطای قابل فهم — در همین فهرست دیده می‌شود.
 */

const SELECT = `
  SELECT w.id, w.name, w.url, w.username, w.insecure_tls, w.datacenter_id, dc.name AS datacenter_name,
         w.location, w.notes, w.is_active, w.hostname, w.model, w.serial, w.os_version,
         w.uptime_sec::float8 AS uptime_sec, w.status, w.last_seen_at, w.last_poll_at, w.last_poll_ms,
         w.last_error, w.fail_streak, w.cpu_percent, w.mem_used_bytes::float8 AS mem_used_bytes,
         w.mem_total_bytes::float8 AS mem_total_bytes, w.load1, w.max_temp_c, w.env_ok,
         (w.password <> '') AS has_password,
         COALESCE(pc.total, 0)::int  AS ports_total,
         COALESCE(pc.up, 0)::int     AS ports_up,
         COALESCE(pc.down, 0)::int   AS ports_down,
         COALESCE(pc.shut, 0)::int   AS ports_shut,
         COALESCE(pc.linked, 0)::int AS ports_linked,
         COALESCE(pc.in_bps, 0)::float8  AS in_bps,
         COALESCE(pc.out_bps, 0)::float8 AS out_bps,
         (SELECT COUNT(*)::int FROM incidents i
           WHERE i.switch_id = w.id AND i.resolved_at IS NULL) AS open_incidents
    FROM switches w
    LEFT JOIN datacenters dc ON dc.id = w.datacenter_id
    LEFT JOIN LATERAL (
      -- فقط پورت فیزیکی. پورت‌چنل جمع عضوهایش است و شمردن هر دو، ترافیک را
      -- دو برابر نشان می‌داد.
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE p.oper_up) AS up,
             COUNT(*) FILTER (WHERE p.oper_up = FALSE AND p.admin_up IS NOT FALSE) AS down,
             COUNT(*) FILTER (WHERE p.admin_up = FALSE) AS shut,
             COUNT(*) FILTER (WHERE p.server_id IS NOT NULL) AS linked,
             SUM(p.in_bps) AS in_bps,
             SUM(p.out_bps) AS out_bps
        FROM switch_ports p
       WHERE p.switch_id = w.id AND p.is_present AND p.kind = 'ethernet'
    ) pc ON TRUE`;

export async function GET() {
  return handle(async () => {
    await requireUser();
    const switches = await query(`${SELECT} ORDER BY w.name`);
    const datacenters = await query(`SELECT id, name FROM datacenters ORDER BY name`);
    return ok({ switches, datacenters });
  });
}

type CleanResult =
  | { ok: false; error: string }
  | {
      ok: true;
      value: {
        name: string;
        url: string;
        username: string;
        insecureTls: boolean;
        datacenterId: number | null;
        location: string | null;
        notes: string | null;
        isActive: boolean;
      };
    };

function clean(body: Record<string, unknown>): CleanResult {
  const name = String(body.name ?? '').trim();
  const url = String(body.url ?? '').trim().replace(/\/+$/, '').replace(/\/ins$/i, '');
  const username = String(body.username ?? '').trim();

  if (!name) return { ok: false, error: 'نام سوییچ را وارد کنید' };
  if (!/^https?:\/\/[^\s/]+$/i.test(url)) {
    return { ok: false, error: 'آدرس باید مثل https://10.0.0.5 یا https://10.0.0.5:8443 باشد' };
  }
  if (!username) return { ok: false, error: 'نام کاربری سوییچ را وارد کنید' };

  let datacenterId: number | null = null;
  if (body.datacenter_id !== null && body.datacenter_id !== undefined && body.datacenter_id !== '') {
    const n = Number(body.datacenter_id);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: 'دیتاسنتر نامعتبر است' };
    datacenterId = n;
  }

  const text = (v: unknown) => {
    const s = String(v ?? '').trim();
    return s ? s.slice(0, 2000) : null;
  };

  return {
    ok: true,
    value: {
      name: name.slice(0, 100),
      url,
      username,
      insecureTls: body.insecure_tls !== false,
      datacenterId,
      location: text(body.location),
      notes: text(body.notes),
      isActive: body.is_active !== false,
    },
  };
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const body = await readJson<Record<string, unknown>>(req);
    const parsed = clean(body);
    if (!parsed.ok) return fail(parsed.error, 400);
    const c = parsed.value;

    const password = String(body.password ?? '');
    if (!password) return fail('گذرواژه سوییچ را وارد کنید', 400);

    const dup = await queryOne(`SELECT 1 FROM switches WHERE name = $1`, [c.name]);
    if (dup) return fail('سوییچی با این نام از قبل هست', 409);

    const row = await queryOne<{ id: number }>(
      `INSERT INTO switches (name, url, username, password, insecure_tls, datacenter_id, location, notes, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [c.name, c.url, c.username, password, c.insecureTls, c.datacenterId, c.location, c.notes, c.isActive],
    );
    return ok({ id: row?.id }, { status: 201 });
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const body = await readJson<Record<string, unknown>>(req);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return fail('شناسه سوییچ نامعتبر است', 400);

    const parsed = clean(body);
    if (!parsed.ok) return fail(parsed.error, 400);
    const c = parsed.value;

    const dup = await queryOne(`SELECT 1 FROM switches WHERE name = $1 AND id <> $2`, [c.name, id]);
    if (dup) return fail('سوییچی با این نام از قبل هست', 409);

    // گذرواژه خالی یعنی «عوض نکن».
    //
    // ولی اگر آدرس عوض شده، گذرواژه قبلی دوباره خواسته می‌شود: وگرنه هر
    // کسی که فقط آدرس را عوض می‌کرد، گذرواژه ذخیره‌شده را برای سرور خودش
    // می‌فرستاد — ورکر در خواندن بعدی آن را با Basic Auth تحویل می‌داد.
    const password = String(body.password ?? '');
    const current = await queryOne<{ url: string; username: string }>(
      `SELECT url, username FROM switches WHERE id = $1`,
      [id],
    );
    if (!current) return fail('سوییچ پیدا نشد', 404);
    if (!password && (current.url !== c.url || current.username !== c.username)) {
      return fail('با تغییر آدرس یا نام کاربری، گذرواژه را هم دوباره وارد کنید', 400);
    }

    await query(
      `UPDATE switches
          SET name = $2, url = $3, username = $4, insecure_tls = $5, datacenter_id = $6,
              location = $7, notes = $8, is_active = $9,
              password = CASE WHEN $10 = '' THEN password ELSE $10 END,
              -- اتصال تازه باید از نو سنجیده شود
              fail_streak = CASE WHEN url <> $3 THEN 0 ELSE fail_streak END,
              updated_at = now()
        WHERE id = $1`,
      [id, c.name, c.url, c.username, c.insecureTls, c.datacenterId, c.location, c.notes, c.isActive, password],
    );
    return ok({ ok: true });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const id = idParam(new URL(req.url), 'id');
    if (id === null) return fail('شناسه سوییچ نامعتبر است', 400);

    // پیوند سرورهایی که ترافیکشان از این سوییچ بود هم می‌رود و از تجمیع
    // بعدی دوباره عدد ایجنت مبنا است. مصرف روزهای گذشته سرورها که از
    // سوییچ آمده بود دست نمی‌خورد.
    await query(`DELETE FROM switches WHERE id = $1`, [id]);
    return ok({ ok: true });
  });
}

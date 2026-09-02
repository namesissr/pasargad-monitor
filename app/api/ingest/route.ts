import { query } from '@/lib/db';
import { fail, ok, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * دریافت متریک از ایجنت‌ها.
 *
 * این اندپوینت هر ۱۰ ثانیه ضربدر تعداد سرورها صدا زده می‌شود. باید سبک بماند:
 *  • ترجمه توکن به شناسه سرور از کش حافظه می‌آید، نه از دیتابیس.
 *  • فقط یک رفت‌وبرگشت به دیتابیس دارد (درج نمونه + به‌روزرسانی وضعیت با CTE).
 *  • مشخصات ثابت سرور — نام میزبان، مدل پردازنده، حجم رم — فقط هنگام
 *    خطای کش نوشته می‌شوند، یعنی حداکثر یک بار در دقیقه.
 * هیچ کوئری سنگینی اینجا اضافه نکنید. تشخیص قطعی و هشدار کار ورکر است.
 */

interface AgentPayload {
  token?: string;
  hostname?: string;
  os?: string;
  agent_version?: string;
  cpu?: { percent?: number; cores?: number; model?: string };
  load?: number[];
  mem?: { used?: number; total?: number; swap_used?: number; swap_total?: number };
  disk?: { used?: number; total?: number };
  net?: { rx_bytes?: number; tx_bytes?: number; rx_bps?: number; tx_bps?: number; iface?: string };
  diskio?: { read_bps?: number; write_bps?: number };
  uptime?: number;
  procs?: number;
  conns?: number;
}

interface CachedServer {
  id: number;
  at: number;
}

const TOKEN_TTL_MS = 60_000;
const tokenCache = new Map<string, CachedServer>();

const n = (v: unknown): number | null => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
/** برای ستون‌های عددی صحیح — مقدار اعشاری از ایجنت نباید درج را بشکند */
const int = (v: unknown): number | null => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x) : null;
};
const nz = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? Math.round(x) : 0;
};

export async function POST(req: Request) {
  try {
    return await ingest(req);
  } catch (err) {
    // پاسخ خطا باید جیسون با پیام روشن باشد. ایجنت همین متن را در لاگ
    // سیستم چاپ می‌کند و اولین چیزی است که هنگام عیب‌یابی دیده می‌شود.
    const message = err instanceof Error ? err.message : 'خطای ناشناخته';
    console.error('[ingest]', message);
    return fail(`ثبت متریک انجام نشد: ${message}`, 500);
  }
}

async function ingest(req: Request) {
  let body: AgentPayload;
  try {
    body = await readJson<AgentPayload>(req);
  } catch {
    return fail('بدنه درخواست جیسون معتبر نیست', 400);
  }

  const token = (body.token || req.headers.get('x-agent-token') || '').trim();
  if (!token) return fail('توکن ایجنت ارسال نشده است', 401);

  const cached = tokenCache.get(token);
  let serverId: number;

  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) {
    serverId = cached.id;
  } else {
    // خطای کش: اینجا مشخصات ثابت سرور را هم تازه می‌کنیم — حداکثر یک بار در دقیقه
    const rows = await query<{ id: number }>(
      `UPDATE servers SET
         hostname         = COALESCE(NULLIF($2, ''), hostname),
         os               = COALESCE(NULLIF($3, ''), os),
         agent_version    = COALESCE(NULLIF($4, ''), agent_version),
         cpu_model        = COALESCE(NULLIF($5, ''), cpu_model),
         net_iface        = COALESCE(NULLIF($10, ''), net_iface),
         cpu_cores        = COALESCE($6::int, cpu_cores),
         ram_total_bytes  = COALESCE($7::bigint, ram_total_bytes),
         disk_total_bytes = COALESCE($8::bigint, disk_total_bytes),
         boot_time        = CASE WHEN $9::BIGINT IS NULL THEN boot_time
                                 ELSE now() - ($9::BIGINT || ' seconds')::INTERVAL END,
         updated_at       = now()
       WHERE agent_token = $1 AND is_active
       RETURNING id`,
      [
        token,
        body.hostname ?? '',
        body.os ?? '',
        body.agent_version ?? '',
        body.cpu?.model ?? '',
        int(body.cpu?.cores),
        int(body.mem?.total),
        int(body.disk?.total),
        int(body.uptime),
        body.net?.iface ?? '',
      ],
    );

    if (!rows.length) return fail('توکن ایجنت نامعتبر است یا سرور غیرفعال شده', 403);
    serverId = rows[0].id;
    tokenCache.set(token, { id: serverId, at: Date.now() });
  }

  const cpu = n(body.cpu?.percent);
  const load = Array.isArray(body.load) ? body.load : [];

  await query(
    `WITH ins AS (
       INSERT INTO server_metrics (
         server_id, ts, cpu_percent,
         ram_used_bytes, ram_total_bytes, swap_used_bytes, swap_total_bytes,
         disk_used_bytes, disk_total_bytes,
         load1, load5, load15,
         rx_bytes, tx_bytes, rx_bps, tx_bps,
         disk_read_bps, disk_write_bps,
         uptime_sec, process_count, tcp_conn_count
       ) VALUES (
         $1, date_trunc('second', now()), $2,
         $3, $4, $5, $6,
         $7, $8,
         $9, $10, $11,
         $12, $13, $14, $15,
         $16, $17,
         $18, $19, $20
       )
       ON CONFLICT (server_id, ts) DO NOTHING
     )
     UPDATE servers
        SET last_seen_at = now(),
            status = CASE WHEN status = 'maintenance' THEN 'maintenance' ELSE 'up' END
      WHERE id = $1`,
    [
      serverId,
      cpu,
      int(body.mem?.used),
      int(body.mem?.total),
      int(body.mem?.swap_used),
      int(body.mem?.swap_total),
      int(body.disk?.used),
      int(body.disk?.total),
      n(load[0]),
      n(load[1]),
      n(load[2]),
      nz(body.net?.rx_bytes),
      nz(body.net?.tx_bytes),
      nz(body.net?.rx_bps),
      nz(body.net?.tx_bps),
      nz(body.diskio?.read_bps),
      nz(body.diskio?.write_bps),
      int(body.uptime),
      int(body.procs),
      int(body.conns),
    ],
  );

  return ok({ ok: true, interval: Number(process.env.AGENT_INTERVAL_SEC || 10) });
}

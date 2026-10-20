import { query, queryOne } from '@/lib/db';
import { requireAdmin, requireUser } from '@/lib/auth';
import { fail, handle, idParam, ok, readJson } from '@/lib/http';
import { SWITCH_PUBLIC_COLUMNS } from '@/lib/switches';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * فهرست و پیکربندی سوییچ‌ها — NX-API، SNMP v2c و SNMP v3.
 *
 * رازها (گذرواژه NX-API، کامیونیتی، گذرواژه‌های v3) مثل کلید ویژالیزور
 * یک‌طرفه‌اند: نوشتنی، هرگز خواندنی. خالی فرستادنشان یعنی «عوض نکن».
 * افزودن و ویرایش فقط از حساب مدیر، چون همین رازها اجازه shut کردن
 * پورت‌ها را می‌دهند.
 *
 * خود اتصال به سوییچ اینجا انجام نمی‌شود. ورکر در چرخه بعدی (حداکثر نیم
 * دقیقه) می‌خواند و نتیجه — یا خطای قابل فهم — در همین فهرست دیده می‌شود.
 */

const SELECT = `
  SELECT ${SWITCH_PUBLIC_COLUMNS},
         w.datacenter_id, dc.name AS datacenter_name,
         w.location, w.notes, w.is_active, w.hostname, w.model, w.serial, w.os_version,
         w.uptime_sec::float8 AS uptime_sec, w.status, w.last_seen_at, w.last_poll_at, w.last_poll_ms,
         w.last_error, w.fail_streak, w.cpu_percent, w.mem_used_bytes::float8 AS mem_used_bytes,
         w.mem_total_bytes::float8 AS mem_total_bytes, w.load1, w.max_temp_c, w.env_ok,
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

const AUTH_PROTOS = ['none', 'md5', 'sha', 'sha224', 'sha256', 'sha384', 'sha512'];
const PRIV_PROTOS = ['none', 'des', 'aes', 'aes256b', 'aes256r'];

interface Common {
  name: string;
  datacenterId: number | null;
  location: string | null;
  notes: string | null;
  isActive: boolean;
}

interface Nxapi {
  protocol: 'nxapi';
  url: string;
  username: string;
  insecureTls: boolean;
}

interface Snmp {
  protocol: 'snmp';
  version: '2c' | '3';
  host: string;
  port: number;
  user: string | null;
  authProto: string;
  privProto: string;
  write: boolean;
  /** روش انتقال فایل برای CISCO-CONFIG-COPY-MIB (پشتیبان و محدودیت سرعت) */
  transfer: 'none' | 'sftp' | 'tftp';
}

type CleanResult = { ok: false; error: string } | { ok: true; common: Common; conn: Nxapi | Snmp };

function clean(body: Record<string, unknown>): CleanResult {
  const name = String(body.name ?? '').trim();
  if (!name) return { ok: false, error: 'نام سوییچ را وارد کنید' };

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

  const common: Common = {
    name: name.slice(0, 100),
    datacenterId,
    location: text(body.location),
    notes: text(body.notes),
    isActive: body.is_active !== false,
  };

  if (body.protocol === 'snmp') {
    const version = body.snmp_version === '3' ? '3' : body.snmp_version === '2c' ? '2c' : null;
    if (!version) return { ok: false, error: 'نسخه SNMP باید 2c یا 3 باشد' };
    const host = String(body.snmp_host ?? '').trim();
    if (!/^[A-Za-z0-9.:-]{1,253}$/.test(host)) return { ok: false, error: 'آی‌پی یا نام میزبان سوییچ نامعتبر است' };
    const port = body.snmp_port === undefined || body.snmp_port === '' ? 161 : Number(body.snmp_port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'پورت SNMP نامعتبر است' };

    let user: string | null = null;
    let authProto = 'sha';
    let privProto = 'aes';
    if (version === '3') {
      user = String(body.snmp_user ?? '').trim();
      if (!user || user.length > 32) return { ok: false, error: 'نام کاربر SNMPv3 را وارد کنید (حداکثر ۳۲ نویسه)' };
      authProto = String(body.snmp_auth_proto ?? 'sha');
      privProto = String(body.snmp_priv_proto ?? 'aes');
      if (!AUTH_PROTOS.includes(authProto)) return { ok: false, error: 'نوع احراز هویت نامعتبر است' };
      if (!PRIV_PROTOS.includes(privProto)) return { ok: false, error: 'نوع رمزنگاری نامعتبر است' };
      if (authProto === 'none' && privProto !== 'none') {
        return { ok: false, error: 'رمزنگاری بدون احراز هویت در SNMPv3 ممکن نیست' };
      }
    }
    const transfer = body.config_transfer === 'sftp' || body.config_transfer === 'tftp' ? body.config_transfer : 'none';
    return {
      ok: true,
      common,
      conn: { protocol: 'snmp', version, host, port, user, authProto, privProto, write: body.snmp_write === true, transfer },
    };
  }

  const url = String(body.url ?? '').trim().replace(/\/+$/, '').replace(/\/ins$/i, '');
  const username = String(body.username ?? '').trim();
  if (!/^https?:\/\/[^\s/]+$/i.test(url)) {
    return { ok: false, error: 'آدرس باید مثل https://10.0.0.5 یا https://10.0.0.5:8443 باشد' };
  }
  if (!username) return { ok: false, error: 'نام کاربری سوییچ را وارد کنید' };
  return { ok: true, common, conn: { protocol: 'nxapi', url, username, insecureTls: body.insecure_tls !== false } };
}

interface Secrets {
  password: string;
  community: string;
  writeCommunity: string;
  authPass: string;
  privPass: string;
}

function secretsOf(body: Record<string, unknown>): Secrets {
  const s = (v: unknown) => String(v ?? '');
  return {
    password: s(body.password),
    community: s(body.snmp_community).trim(),
    writeCommunity: s(body.snmp_write_community).trim(),
    authPass: s(body.snmp_auth_pass),
    privPass: s(body.snmp_priv_pass),
  };
}

/**
 * کدام رازها برای این اتصال لازم‌اند. در v3، گذرواژه کمتر از ۸ نویسه را
 * خود USM نمی‌پذیرد (RFC 3414)؛ بهتر است همین‌جا گفته شود تا در ورکر
 * به‌شکل «Wrong Digest» مبهم برگردد.
 */
interface Stored {
  password: boolean;
  community: boolean;
  authPass: boolean;
  privPass: boolean;
}

const NOTHING_STORED: Stored = { password: false, community: false, authPass: false, privPass: false };

/**
 * «stored» یعنی کدام راز از قبل ذخیره است و خالی‌گذاشتنش «عوض نکن» معنی
 * می‌دهد. جدا برای هر راز: اگر نوع احراز هویت از none به sha برود و
 * گذرواژه‌ای از قبل نباشد، خالی‌گذاشتن نباید بی‌صدا اتصال بی‌احراز بسازد.
 */
function checkSecrets(conn: Nxapi | Snmp, s: Secrets, stored: Stored): string | null {
  if (conn.protocol === 'nxapi') {
    if (!s.password && !stored.password) return 'گذرواژه سوییچ را وارد کنید';
    return null;
  }
  if (conn.version === '2c') {
    if (!s.community && !stored.community) return 'کامیونیتی خواندنی را وارد کنید';
    if (s.writeCommunity && s.writeCommunity === s.community) {
      return 'کامیونیتی نوشتنی باید با کامیونیتی خواندنی فرق داشته باشد';
    }
    return null;
  }
  if (conn.authProto !== 'none') {
    if (!s.authPass && !stored.authPass) return 'گذرواژه احراز هویت SNMPv3 را وارد کنید';
    if (s.authPass && s.authPass.length < 8) return 'گذرواژه احراز هویت SNMPv3 باید دست‌کم ۸ نویسه باشد';
  }
  if (conn.privProto !== 'none') {
    if (!s.privPass && !stored.privPass) return 'گذرواژه رمزنگاری SNMPv3 را وارد کنید';
    if (s.privPass && s.privPass.length < 8) return 'گذرواژه رمزنگاری SNMPv3 باید دست‌کم ۸ نویسه باشد';
  }
  return null;
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const body = await readJson<Record<string, unknown>>(req);
    const parsed = clean(body);
    if (!parsed.ok) return fail(parsed.error, 400);
    const { common: c, conn } = parsed;
    const sec = secretsOf(body);
    const secErr = checkSecrets(conn, sec, NOTHING_STORED);
    if (secErr) return fail(secErr, 400);

    const dup = await queryOne(`SELECT 1 FROM switches WHERE name = $1`, [c.name]);
    if (dup) return fail('سوییچی با این نام از قبل هست', 409);

    const nx = conn.protocol === 'nxapi' ? conn : null;
    const sn = conn.protocol === 'snmp' ? conn : null;
    const row = await queryOne<{ id: number }>(
      `INSERT INTO switches (
         name, protocol, url, username, password, insecure_tls,
         snmp_version, snmp_host, snmp_port, snmp_community, snmp_write_community,
         snmp_user, snmp_auth_proto, snmp_auth_pass, snmp_priv_proto, snmp_priv_pass, snmp_write,
         datacenter_id, location, notes, is_active, config_transfer
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING id`,
      [
        c.name,
        conn.protocol,
        nx?.url ?? null,
        nx?.username ?? null,
        nx ? sec.password : null,
        nx?.insecureTls ?? true,
        sn?.version ?? null,
        sn?.host ?? null,
        sn?.port ?? 161,
        sn?.version === '2c' ? sec.community : null,
        sn?.version === '2c' ? sec.writeCommunity || null : null,
        sn?.user ?? null,
        sn?.authProto ?? 'sha',
        sn?.version === '3' && sn.authProto !== 'none' ? sec.authPass : null,
        sn?.privProto ?? 'aes',
        sn?.version === '3' && sn.privProto !== 'none' ? sec.privPass : null,
        sn?.version === '3' ? sn.write : false,
        c.datacenterId,
        c.location,
        c.notes,
        c.isActive,
        sn?.transfer ?? 'none',
      ],
    );
    return ok({ id: row?.id }, { status: 201 });
  });
}

type CurrentRow = {
  protocol: string;
  has_password: boolean;
  has_community: boolean;
  has_auth_pass: boolean;
  has_priv_pass: boolean;
  url: string | null;
  username: string | null;
  snmp_version: string | null;
  snmp_host: string | null;
  snmp_port: number;
  snmp_user: string | null;
};

export async function PATCH(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const body = await readJson<Record<string, unknown>>(req);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return fail('شناسه سوییچ نامعتبر است', 400);

    const parsed = clean(body);
    if (!parsed.ok) return fail(parsed.error, 400);
    const { common: c, conn } = parsed;
    const sec = secretsOf(body);

    const dup = await queryOne(`SELECT 1 FROM switches WHERE name = $1 AND id <> $2`, [c.name, id]);
    if (dup) return fail('سوییچی با این نام از قبل هست', 409);

    const current = await queryOne<CurrentRow>(
      `SELECT protocol, url, username, snmp_version, snmp_host, snmp_port, snmp_user,
              COALESCE(password, '') <> ''       AS has_password,
              COALESCE(snmp_community, '') <> '' AS has_community,
              COALESCE(snmp_auth_pass, '') <> '' AS has_auth_pass,
              COALESCE(snmp_priv_pass, '') <> '' AS has_priv_pass
         FROM switches WHERE id = $1`,
      [id],
    );
    if (!current) return fail('سوییچ پیدا نشد', 404);

    // راز خالی یعنی «عوض نکن» — ولی نه وقتی مقصد عوض شده.
    //
    // اگر آدرس، پروتکل یا کاربر عوض شود و رازها دوباره داده نشوند، هر
    // کسی که فقط آدرس را به سرور خودش تغییر می‌داد، راز ذخیره‌شده را از
    // ورکر تحویل می‌گرفت (Basic Auth در NX-API، کامیونیتی در هر بسته SNMP).
    const target = conn.protocol === 'nxapi' ? [conn.protocol, conn.url, conn.username] : [conn.protocol, conn.version, conn.host, conn.port, conn.user];
    const before =
      current.protocol === 'nxapi'
        ? [current.protocol, current.url, current.username]
        : [current.protocol, current.snmp_version, current.snmp_host, current.snmp_port, current.snmp_user];
    const targetChanged = JSON.stringify(target) !== JSON.stringify(before);
    const stored: Stored = targetChanged
      ? NOTHING_STORED
      : {
          password: current.has_password,
          community: current.has_community,
          authPass: current.has_auth_pass,
          privPass: current.has_priv_pass,
        };
    const secErr = checkSecrets(conn, sec, stored);
    if (secErr) {
      return fail(targetChanged ? `${secErr} — با تغییر آدرس، پروتکل یا کاربر، رازها باید دوباره وارد شوند` : secErr, 400);
    }

    if (conn.protocol === 'nxapi') {
      await query(
        `UPDATE switches
            SET name = $2, protocol = 'nxapi', url = $3, username = $4, insecure_tls = $5,
                datacenter_id = $6, location = $7, notes = $8, is_active = $9,
                password = CASE WHEN $10 = '' THEN password ELSE $10 END,
                -- اتصال تازه باید از نو سنجیده شود
                fail_streak = CASE WHEN $11 THEN 0 ELSE fail_streak END,
                updated_at = now()
          WHERE id = $1`,
        [id, c.name, conn.url, conn.username, conn.insecureTls, c.datacenterId, c.location, c.notes, c.isActive, sec.password, targetChanged],
      );
      return ok({ ok: true });
    }

    const v2 = conn.version === '2c';
    // کامیونیتی نوشتنی: تیک «حذف اجازه نوشتن» پاکش می‌کند. با تغییر مقصد هم
    // اگر دوباره داده نشده باشد پاک می‌شود، به همان دلیل بالا.
    const clearWrite = body.clear_write_community === true || (targetChanged && !sec.writeCommunity);
    await query(
      `UPDATE switches
          SET name = $2, protocol = 'snmp', snmp_version = $3, snmp_host = $4, snmp_port = $5,
              snmp_user = $6, snmp_auth_proto = $7, snmp_priv_proto = $8, snmp_write = $9,
              datacenter_id = $10, location = $11, notes = $12, is_active = $13,
              snmp_community       = CASE WHEN NOT $14 THEN NULL WHEN $15 = '' THEN snmp_community ELSE $15 END,
              snmp_write_community = CASE WHEN NOT $14 OR $16 THEN NULL
                                          WHEN $17 = '' THEN snmp_write_community ELSE $17 END,
              snmp_auth_pass       = CASE WHEN $14 OR $7 = 'none' THEN NULL
                                          WHEN $18 = '' THEN snmp_auth_pass ELSE $18 END,
              snmp_priv_pass       = CASE WHEN $14 OR $8 = 'none' THEN NULL
                                          WHEN $19 = '' THEN snmp_priv_pass ELSE $19 END,
              fail_streak = CASE WHEN $20 THEN 0 ELSE fail_streak END,
              config_transfer = $21,
              updated_at = now()
        WHERE id = $1`,
      [
        id,
        c.name,
        conn.version,
        conn.host,
        conn.port,
        conn.user,
        conn.authProto,
        conn.privProto,
        !v2 && conn.write,
        c.datacenterId,
        c.location,
        c.notes,
        c.isActive,
        v2,
        sec.community,
        clearWrite,
        sec.writeCommunity,
        sec.authPass,
        sec.privPass,
        targetChanged,
        conn.transfer,
      ],
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

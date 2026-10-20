import https from 'node:https';
import http from 'node:http';

/**
 * کلاینت NX-API سوییچ‌های Cisco Nexus، و تبدیل خروجی‌اش به شکل پنل.
 *
 * قالب درخواست «ins_api» است نه JSON-RPC: از NX-OS 7 تا 10 یکسان مانده و
 * نوع فرمان (cli_show برای خواندن، cli_conf برای پیکربندی) صریح در خود
 * درخواست است. یعنی فرمان خواندنی هرگز به‌اشتباه در حالت پیکربندی اجرا
 * نمی‌شود.
 *
 * هر فرمان خواندنی یک درخواست جداست. NX-API چند فرمان را با « ;» در یک
 * درخواست می‌پذیرد، ولی اگر یکی از آن‌ها روی این مدل یا نسخه خروجی
 * ساخت‌یافته نداشته باشد (مثلا محیط روی برخی نسخه‌ها)، بقیه هم از دست
 * می‌روند. یک فرمان شکسته نباید شمارنده پورت‌ها را بی‌خبر بگذارد.
 *
 * تجزیه‌گرها عمدا نسبت به نام کلید بردبارند: نام فیلدها بین نسخه‌های
 * NX-OS عوض شده (sys_ver_str ← nxos_ver_str، ps_status ← psu_status) و
 * سوییچ واقعی در دسترس آزمون نیست. هر فیلد از فهرست نام‌های شناخته‌شده
 * خوانده می‌شود و نبودنش مقدار تهی است، نه خطا.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

// یک اتصال ماندگار برای هر سوییچ. دست‌دادن TLS هر سی ثانیه روی پردازنده
// کنترل‌پلین سوییچ هزینه‌ای بی‌دلیل است.
const agents = new Map();
// NX-API پس از اولین ورود کوکی nxapi_auth می‌دهد. با فرستادنش، هر درخواست
// دوباره از AAA (و اگر هست، تاکاکس) رد نمی‌شود.
const cookies = new Map();

function agentFor(sw, isHttps) {
  const key = `${sw.id}|${sw.url}|${sw.insecure_tls ? 1 : 0}`;
  let a = agents.get(key);
  if (!a) {
    a = isHttps
      ? new https.Agent({ keepAlive: true, maxSockets: 1, rejectUnauthorized: !sw.insecure_tls })
      : new http.Agent({ keepAlive: true, maxSockets: 1 });
    agents.set(key, a);
  }
  return a;
}

/** کلید کش اتصال و کوکی؛ با عوض‌شدن آدرس یا کاربر، کش قبلی کنار می‌رود */
function sessionKey(sw) {
  return `${sw.id}|${sw.url}|${sw.username}`;
}

export class NxapiError extends Error {
  /** @param {string} message @param {{ code?: string, status?: number, hint?: string }} [info] */
  constructor(message, info = {}) {
    super(message);
    this.code = info.code ?? null;
    this.status = info.status ?? null;
    this.hint = info.hint ?? null;
  }
}

/**
 * پیام خطای قابل اقدام. «ECONNREFUSED» به ادمین نمی‌گوید چه کند؛ «NX-API
 * روشن نیست» می‌گوید.
 */
export function explainError(err) {
  const code = err?.code || err?.cause?.code || '';
  const status = err?.status ?? null;
  if (status === 401) return 'نام کاربری یا گذرواژه سوییچ پذیرفته نشد (۴۰۱)';
  if (status === 403) return 'کاربر سوییچ اجازه این فرمان را ندارد (۴۰۳) — نقش کاربر را بررسی کنید';
  if (status === 404) return 'مسیر /ins پیدا نشد (۴۰۴) — آدرس درست است؟ NX-API روی این پورت است؟';
  if (code === 'ECONNREFUSED') {
    return 'اتصال رد شد — NX-API روی سوییچ روشن نیست (feature nxapi) یا پورت اشتباه است';
  }
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'TIMEOUT') {
    return 'پاسخی نیامد — سرور پنل به آی‌پی مدیریت سوییچ دسترسی ندارد، یا فایروال/ACL مسیر را بسته';
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return 'مسیری به سوییچ نیست — سرور پنل به شبکه مدیریت سوییچ راه ندارد';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'نام میزبان سوییچ پیدا نشد (DNS)';
  if (code === 'ECONNRESET') return 'سوییچ اتصال را بست — اگر آدرس http است، شاید NX-API فقط https را می‌پذیرد';
  if (
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID'
  ) {
    return 'گواهی سوییچ معتبر نیست — گزینه «پذیرش گواهی خودامضا» را روشن کنید';
  }
  return err?.hint || err?.message || 'خطای ناشناخته';
}

/** یک درخواست خام به /ins */
function post(sw, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(String(sw.url || '').replace(/\/+$/, '') + '/ins');
    } catch {
      reject(new NxapiError('آدرس سوییچ نامعتبر است', { hint: 'آدرس سوییچ نامعتبر است' }));
      return;
    }
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const body = Buffer.from(JSON.stringify(payload));
    const headers = {
      'content-type': 'application/json',
      'content-length': String(body.length),
      authorization: 'Basic ' + Buffer.from(`${sw.username}:${sw.password}`).toString('base64'),
    };
    const cookie = cookies.get(sessionKey(sw));
    if (cookie) headers.cookie = cookie;

    const req = lib.request(
      url,
      { method: 'POST', headers, agent: agentFor(sw, isHttps), timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'];
          if (Array.isArray(setCookie)) {
            const auth = setCookie.find((c) => c.startsWith('nxapi_auth='));
            if (auth) cookies.set(sessionKey(sw), auth.split(';')[0]);
          }
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode === 401) {
            // کوکی منقضی‌شده هم ۴۰۱ می‌دهد؛ بار بعد بدون کوکی تلاش شود
            cookies.delete(sessionKey(sw));
          }
          if (res.statusCode && res.statusCode >= 400) {
            const err = new NxapiError(`NX-API کد ${res.statusCode}`, { status: res.statusCode });
            err.hint = explainError(err);
            reject(err);
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            const err = new NxapiError('پاسخ NX-API جیسون نبود', {
              hint: 'پاسخ NX-API جیسون نبود — آدرس به NX-API اشاره نمی‌کند؟',
            });
            reject(err);
          }
        });
      },
    );
    req.on('timeout', () => {
      const err = new NxapiError('مهلت پاسخ سوییچ تمام شد', { code: 'TIMEOUT' });
      req.destroy(err);
    });
    req.on('error', (e) => {
      if (!(e instanceof NxapiError)) e.hint = explainError(e);
      else if (!e.hint) e.hint = explainError(e);
      reject(e);
    });
    req.end(body);
  });
}

/** خروجی‌های ins_api همیشه آرایه؛ NX-API برای یک فرمان شیء تنها می‌دهد */
function outputsOf(res) {
  const out = res?.ins_api?.outputs?.output;
  if (!out) return [];
  return Array.isArray(out) ? out : [out];
}

/** کد موفقیت NX-API رشته «200» است، گاهی عدد */
function isOk(o) {
  return String(o?.code ?? '') === '200';
}

/**
 * اجرای یک فرمان خواندنی و برگرداندن body ساخت‌یافته.
 * فرمان نباید « ;» داشته باشد — جداکننده فرمان‌های NX-API است.
 */
export async function show(sw, command, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (/;/.test(command)) throw new NxapiError('فرمان نامعتبر');
  const res = await post(
    sw,
    {
      ins_api: {
        version: '1.0',
        type: 'cli_show',
        chunk: '0',
        sid: '1',
        input: command,
        output_format: 'json',
      },
    },
    timeoutMs,
  );
  const [o] = outputsOf(res);
  if (!o) throw new NxapiError(`پاسخی برای «${command}» نیامد`);
  if (!isOk(o)) {
    const msg = o.clierror || o.msg || `کد ${o.code}`;
    throw new NxapiError(`«${command}»: ${String(msg).trim()}`, { hint: `«${command}»: ${String(msg).trim()}` });
  }
  return o.body ?? {};
}

/**
 * اجرای چند خط پیکربندی پشت‌سرهم، در یک نشست. NX-API خودش به حالت
 * پیکربندی می‌رود؛ «configure terminal» لازم نیست.
 *
 * اگر یکی از خط‌ها شکست بخورد، خط‌های بعدی اجرا نمی‌شوند و خطای همان خط
 * برگردانده می‌شود.
 */
export async function configure(sw, lines, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  for (const l of lines) {
    if (!l || /[;\r\n]/.test(l)) throw new NxapiError('خط پیکربندی نامعتبر');
  }
  const res = await post(
    sw,
    {
      ins_api: {
        version: '1.0',
        type: 'cli_conf',
        chunk: '0',
        sid: '1',
        input: lines.join(' ;'),
        output_format: 'json',
      },
    },
    timeoutMs,
  );
  const outs = outputsOf(res);
  if (!outs.length) throw new NxapiError('پاسخی از سوییچ نیامد');
  for (const o of outs) {
    if (!isOk(o)) {
      const msg = String(o.clierror || o.msg || `کد ${o.code}`).trim();
      throw new NxapiError(`«${o.input ?? ''}»: ${msg}`, { hint: `«${o.input ?? ''}»: ${msg}` });
    }
  }
  return outs;
}

/**
 * ذخیره پیکربندی. «copy running-config startup-config» فرمان اجرایی است
 * نه پیکربندی، و بعضی نسخه‌ها آن را فقط در یکی از دو نوع می‌پذیرند.
 */
export async function saveConfig(sw) {
  try {
    await configure(sw, ['copy running-config startup-config'], { timeoutMs: 120_000 });
    return;
  } catch (first) {
    const res = await post(
      sw,
      {
        ins_api: {
          version: '1.0',
          type: 'cli_show_ascii',
          chunk: '0',
          sid: '1',
          input: 'copy running-config startup-config',
          output_format: 'json',
        },
      },
      120_000,
    ).catch(() => null);
    const [o] = outputsOf(res);
    if (o && isOk(o)) return;
    throw first;
  }
}

// ── ابزار تجزیه ────────────────────────────────────────────

/** TABLE_x.ROW_x می‌تواند شیء تنها، آرایه یا نبود باشد */
export function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * جست‌وجوی کلید ROW_* در هر عمقی.
 *
 * محل جدول بین نسخه‌ها جابه‌جا شده: فن‌ها گاهی زیر fandetails اند و گاهی
 * مستقیم در ریشه. به‌جای حدس‌زدن مسیر، اولین جایی که آن نام هست پیدا
 * می‌شود.
 */
export function findRows(obj, rowKey, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return [];
  if (Object.prototype.hasOwnProperty.call(obj, rowKey)) return asArray(obj[rowKey]);
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = findRows(v, rowKey, depth + 1);
      if (found.length) return found;
    }
  }
  return [];
}

/** اولین مقدار تعریف‌شده از میان چند نام کلید */
function pick(row, ...keys) {
  for (const k of keys) {
    const v = row?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

/** عدد از رشته یا عدد؛ «32 W» و «-2.31 dBm» هم */
export function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = /-?\d+(?:\.\d+)?/.exec(String(v));
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** شمارنده بایت. ۶۴ بیتی است؛ عدد اعشاری جاوااسکریپت تا ۹ پتابایت دقیق است */
function counter(row, ...keys) {
  const v = pick(row, ...keys);
  if (v === null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const upish = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).toLowerCase();
  if (s === 'up' || s === 'connected') return true;
  if (s.startsWith('down') || s === 'notconnect' || s === 'disabled' || s.includes('err')) return false;
  return null;
};

/** «10 Gb/s»، «1000 Mb/s»، «auto-speed» */
export function parseSpeedMbps(speed, bwKbit) {
  const s = String(speed ?? '').toLowerCase();
  const m = /(\d+(?:\.\d+)?)\s*([gmk])b/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (m[2] === 'g') return Math.round(n * 1000);
    if (m[2] === 'm') return Math.round(n);
    return Math.round(n / 1000);
  }
  const bw = toNum(bwKbit);
  return bw && bw > 0 ? Math.round(bw / 1000) : null;
}

/** نوع پورت از روی نام */
export function portKind(name) {
  const n = String(name).toLowerCase();
  if (n.startsWith('eth')) return 'ethernet';
  if (n.startsWith('port-channel') || n.startsWith('po')) return 'port-channel';
  if (n.startsWith('mgmt')) return 'mgmt';
  if (n.startsWith('vlan')) return 'vlan';
  if (n.startsWith('loopback') || n.startsWith('lo')) return 'loopback';
  return 'other';
}

/**
 * نام کوتاه سوییچ (Eth1/1، Po10) به نام کامل (Ethernet1/1، port-channel10).
 * «show interface status» و فهرست عضوهای پورت‌چنل نام کوتاه می‌دهند.
 */
export function fullPortName(name) {
  const s = String(name ?? '').trim();
  let m = /^eth(?:ernet)?\s*(\d.*)$/i.exec(s);
  if (m) return `Ethernet${m[1]}`;
  m = /^po(?:rt-channel)?\s*(\d+)$/i.exec(s);
  if (m) return `port-channel${m[1]}`;
  return s;
}

/**
 * نام پورتی که فرمان پیکربندی رویش ساخته می‌شود. نام از خود سوییچ آمده،
 * ولی هر چیزی که وارد خط فرمان می‌شود باید الگوی سخت داشته باشد.
 */
export function isSafePortName(name) {
  return /^(Ethernet\d+(\/\d+){1,3}|port-channel\d+)$/.test(String(name ?? ''));
}

/**
 * «show interface» → فهرست پورت‌ها.
 *
 * شمارنده‌ها: پورت اترنت و پورت‌چنل eth_inbytes دارند؛ mgmt0 در برخی
 * نسخه‌ها vdc_lvl_in_bytes. اینترفیس ویلن و لوپ‌بک معمولا شمارنده بایت
 * ندارند و فقط وضعیتشان نشان داده می‌شود.
 */
export function parseInterfaces(body) {
  const rows = findRows(body, 'ROW_interface');
  const out = [];
  const membersOf = new Map(); // نام عضو ← پورت‌چنل

  for (const r of rows) {
    const name = String(pick(r, 'interface') ?? '').trim();
    if (!name) continue;
    const kind = portKind(name);

    const adminRaw = pick(r, 'admin_state', 'svi_admin_state');
    const operRaw = pick(r, 'state', 'svi_line_proto', 'svi_state');
    const reason = pick(r, 'state_rsn_desc', 'svi_rsn_desc', 'state_rsn');

    const operUp = upish(operRaw);
    let adminUp = upish(adminRaw);
    // بعضی اینترفیس‌ها فیلد وضعیت مدیریتی ندارند؛ «Administratively down»
    // در علت قطعی همان را می‌گوید، و پورتی که بالاست قطعا shut نیست
    if (adminUp === null) {
      if (reason && /admin/i.test(String(reason))) adminUp = false;
      else if (operUp === true) adminUp = true;
    }

    const port = {
      name,
      kind,
      description: pick(r, 'desc', 'svi_desc') ?? null,
      admin_up: adminUp,
      oper_up: operUp,
      oper_reason: reason === null ? null : String(reason),
      speed_mbps: parseSpeedMbps(pick(r, 'eth_speed', 'speed'), pick(r, 'eth_bw', 'svi_bw')),
      mtu: toNum(pick(r, 'eth_mtu', 'svi_mtu')),
      mode: pick(r, 'eth_mode') ?? null,
      mac: pick(r, 'eth_hw_addr', 'svi_mac') ?? null,
      hw_type: pick(r, 'eth_hw_desc') ?? null,
      last_flap: pick(r, 'eth_link_flapped') ?? null,
      member_of: null,
      in_bytes: counter(r, 'eth_inbytes', 'vdc_lvl_in_bytes', 'svi_ucast_bytes_in'),
      out_bytes: counter(r, 'eth_outbytes', 'vdc_lvl_out_bytes', 'svi_ucast_bytes_out'),
      in_errors: counter(r, 'eth_inerr'),
      out_errors: counter(r, 'eth_outerr'),
      in_discards: counter(r, 'eth_indiscard'),
      out_discards: counter(r, 'eth_outdiscard'),
      crc_errors: counter(r, 'eth_crc'),
      // سرعت محاسبه‌شده خود سوییچ، فقط برای اولین خواندن که دلتایی نیست
      in_rate_bps: counter(r, 'eth_inrate1_bits', 'vdc_lvl_in_avg_bits'),
      out_rate_bps: counter(r, 'eth_outrate1_bits', 'vdc_lvl_out_avg_bits'),
    };

    // عضو پورت‌چنل: یا خود عضو eth_bundle دارد، یا پورت‌چنل فهرست عضوها را
    const bundle = pick(r, 'eth_bundle');
    if (bundle !== null && kind === 'ethernet' && /^\d+$/.test(String(bundle).trim())) {
      port.member_of = `port-channel${String(bundle).trim()}`;
    }
    if (kind === 'port-channel') {
      const members = pick(r, 'eth_members');
      if (members) {
        for (const m of String(members).split(/[\s,]+/).filter(Boolean)) {
          membersOf.set(fullPortName(m), name);
        }
      }
    }
    out.push(port);
  }

  for (const p of out) {
    if (!p.member_of && membersOf.has(p.name)) p.member_of = membersOf.get(p.name);
  }
  return out;
}

/**
 * «show interface status» → ویلن، نوع ماژول، و وضعیت دقیق‌تر.
 * err-disabled فقط اینجا به‌روشنی دیده می‌شود.
 */
export function parseInterfaceStatus(body) {
  const map = new Map();
  for (const r of findRows(body, 'ROW_interface')) {
    const name = fullPortName(pick(r, 'interface'));
    if (!name) continue;
    map.set(name, {
      vlan: pick(r, 'vlan') === null ? null : String(pick(r, 'vlan')),
      state: pick(r, 'state') === null ? null : String(pick(r, 'state')),
      xcvr_type: pick(r, 'type') === null ? null : String(pick(r, 'type')),
    });
  }
  return map;
}

/** «show system resources» → پردازنده، حافظه، بار */
export function parseResources(body) {
  const idle = toNum(pick(body, 'cpu_state_idle'));
  const user = toNum(pick(body, 'cpu_state_user'));
  const kernel = toNum(pick(body, 'cpu_state_kernel'));
  let cpu = null;
  if (idle !== null) cpu = Math.max(0, Math.min(100, 100 - idle));
  else if (user !== null || kernel !== null) cpu = (user ?? 0) + (kernel ?? 0);

  // NX-OS حافظه را به کیلوبایت می‌دهد
  const total = toNum(pick(body, 'memory_usage_total'));
  const used = toNum(pick(body, 'memory_usage_used'));
  return {
    cpu_percent: cpu,
    mem_total_bytes: total === null ? null : Math.round(total * 1024),
    mem_used_bytes: used === null ? null : Math.round(used * 1024),
    load1: toNum(pick(body, 'load_avg_1min')),
    mem_status: pick(body, 'current_memory_status'),
  };
}

/** «show version» → مدل، نسخه، سریال، آپ‌تایم */
export function parseVersion(body) {
  const chassis = String(pick(body, 'chassis_id') ?? '').trim();
  const model = chassis
    .replace(/\s*chassis\s*$/i, '')
    .replace(/^cisco\s+/i, '')
    .trim() || null;
  const days = toNum(pick(body, 'kern_uptm_days')) ?? 0;
  const hrs = toNum(pick(body, 'kern_uptm_hrs')) ?? 0;
  const mins = toNum(pick(body, 'kern_uptm_mins')) ?? 0;
  const secs = toNum(pick(body, 'kern_uptm_secs')) ?? 0;
  const uptime = days * 86400 + hrs * 3600 + mins * 60 + secs;
  return {
    hostname: pick(body, 'host_name') ?? null,
    model,
    serial: pick(body, 'proc_board_id') ?? null,
    os_version: pick(body, 'nxos_ver_str', 'kickstart_ver_str', 'sys_ver_str') ?? null,
    uptime_sec: uptime > 0 ? Math.round(uptime) : null,
  };
}

const OK_STATUS = new Set(['ok', 'okay', 'normal', 'good', 'powered-up', 'on']);
const ABSENT_STATUS = new Set(['absent', 'not present', 'none', '--', 'n/a', 'notpresent']);

function statusClass(s) {
  const v = String(s ?? '').trim().toLowerCase();
  if (!v) return 'unknown';
  if (OK_STATUS.has(v)) return 'ok';
  if (ABSENT_STATUS.has(v)) return 'absent';
  return 'bad';
}

/**
 * دما، فن و منبع تغذیه → فهرست‌ها و فهرست مشکلات.
 *
 * «absent» مشکل حساب نمی‌شود: اسلات خالی روی خیلی از مدل‌ها عادی است.
 * منبع تغذیه‌ای که برق ندارد ولی هست («Shutdown»، «Fail/Shutdown»)
 * مشکل است — همان حالتی که یکی از دو فید برق قطع شده و دیگر افزونگی
 * نیست.
 */
export function parseEnvironment({ temperature, fan, power }) {
  const temps = findRows(temperature, 'ROW_tempinfo').map((r) => {
    const cur = toNum(pick(r, 'curtemp'));
    const major = toNum(pick(r, 'majthres'));
    const minor = toNum(pick(r, 'minthres'));
    const alarm = String(pick(r, 'alarmstatus') ?? '').trim();
    const alarmClass = alarm ? statusClass(alarm) : 'ok';
    const bad = alarmClass === 'bad' || (cur !== null && major !== null && major > 0 && cur >= major);
    return {
      name: [pick(r, 'tempmod'), pick(r, 'sensor')].filter((x) => x !== null).join(' '),
      current: cur,
      minor,
      major,
      alarm: alarm || null,
      ok: !bad,
    };
  });

  const fans = findRows(fan, 'ROW_faninfo').map((r) => {
    const status = pick(r, 'fanstatus', 'fan_status', 'status');
    const cls = statusClass(status);
    return {
      name: String(pick(r, 'fanname', 'fan_name') ?? ''),
      model: pick(r, 'fanmodel') ?? null,
      direction: pick(r, 'fandir') ?? null,
      status: status === null ? null : String(status),
      ok: cls !== 'bad',
      absent: cls === 'absent',
    };
  });

  const psus = findRows(power, 'ROW_psinfo').map((r) => {
    const status = pick(r, 'ps_status', 'psu_status', 'status');
    const cls = statusClass(status);
    return {
      name: `PS${pick(r, 'psnum', 'ps_num') ?? ''}`,
      model: pick(r, 'psmodel', 'ps_model') ?? null,
      output_w: toNum(pick(r, 'actual_out', 'actual_output')),
      input_w: toNum(pick(r, 'actual_input', 'actual_inp')),
      capacity_w: toNum(pick(r, 'tot_capa', 'total_capacity')),
      status: status === null ? null : String(status),
      ok: cls !== 'bad',
      absent: cls === 'absent',
    };
  });

  const problems = [];
  for (const t of temps) {
    if (!t.ok) problems.push(`دمای ${t.name}: ${t.current ?? '?'}°C${t.alarm ? ` (${t.alarm})` : ''}`);
  }
  for (const f of fans) if (!f.ok) problems.push(`فن ${f.name}: ${f.status}`);
  for (const p of psus) if (!p.ok) problems.push(`منبع تغذیه ${p.name}: ${p.status}`);

  const temps_c = temps.map((t) => t.current).filter((x) => x !== null);
  return {
    temps,
    fans,
    psus,
    problems,
    max_temp_c: temps_c.length ? Math.max(...temps_c) : null,
  };
}

/**
 * «show interface transceiver details» → توان نوری و دمای هر ماژول.
 *
 * ماژول چندخطی (۴۰ و ۱۰۰ گیگ) چند lane دارد؛ کمترین توان دریافتی
 * گزارش می‌شود چون همان lane ضعیف است که لینک را می‌اندازد.
 */
export function parseTransceivers(body) {
  const map = new Map();
  for (const r of findRows(body, 'ROW_interface')) {
    const name = fullPortName(pick(r, 'interface'));
    if (!name) continue;
    const present = String(pick(r, 'sfp') ?? '').toLowerCase();
    if (present && present !== 'present') continue;

    const lanes = findRows(r, 'ROW_lane');
    const src = lanes.length ? lanes : [r];
    const rx = src.map((l) => toNum(pick(l, 'rx_pwr'))).filter((x) => x !== null);
    const tx = src.map((l) => toNum(pick(l, 'tx_pwr'))).filter((x) => x !== null);
    const first = src[0] ?? {};
    const rxLow = toNum(pick(first, 'rx_pwr_warn_lo'));
    const temp = toNum(pick(first, 'temperature'));
    const rxMin = rx.length ? Math.min(...rx) : null;

    map.set(name, {
      type: pick(r, 'type') ?? null,
      vendor: pick(r, 'name') ?? null,
      part: pick(r, 'partnum') ?? null,
      serial: pick(r, 'serialnum') ?? null,
      temp_c: temp,
      tx_dbm: tx.length ? Math.min(...tx) : null,
      rx_dbm: rxMin,
      rx_warn_lo: rxLow,
      rx_low: rxMin !== null && rxLow !== null && rxMin < rxLow,
    });
  }
  return map;
}

/**
 * دلتای شمارنده. شمارنده کوچک‌تر از قبل یعنی سوییچ ری‌استارت شده یا
 * «clear counters» زده‌اند؛ آن بازه صفر حساب می‌شود نه عدد منفی یا
 * نجومی — همان قاعده ایجنت.
 */
export function counterDelta(prev, cur) {
  if (prev === null || prev === undefined || cur === null || cur === undefined) return null;
  const p = Number(prev);
  const c = Number(cur);
  if (!Number.isFinite(p) || !Number.isFinite(c)) return null;
  return c >= p ? c - p : 0;
}

import { shortHostName } from './nxapi.mjs';

/**
 * پیشنهاد «این پورت مال کدام سرور است».
 *
 * سه نشانه، به ترتیب اعتبار:
 *   lldp  نام همسایه LLDP/CDP همان نام میزبان سرور است (سرورهایی که
 *         lldpd دارند خودشان را معرفی می‌کنند)
 *   arp   MAC دیده‌شده روی پورت، در جدول ARP یکی از سوییچ‌ها، به آی‌پی‌ای
 *         می‌رسد که در پنل مال سرور است
 *   desc  توضیح پورت نام یا آی‌پی اصلی سرور را دارد
 *
 * دو نشانه اول «قوی»اند. توضیح پورت دستی نوشته شده و ممکن است کهنه باشد،
 * پس فقط وقتی به کار می‌رود که هیچ نشانه قوی‌ای نباشد.
 *
 * فقط وقتی پیشنهاد داده می‌شود که دقیقا یک سرور بماند. دو سرور یعنی
 * ابهام، و پیشنهاد مبهم بدتر از نبودنش است — ادمین به آن اعتماد می‌کند.
 *
 * پورت محافظت‌شده و عضو پورت‌چنل اصلا بررسی نمی‌شود. نام LLDP خودش کافی
 * است — نود مجازی‌سازی با ده‌ها MAC ماشین مجازی هم با نامش پیدا می‌شود.
 * ولی نشانه‌های MAC و توضیح فقط وقتی به کار می‌روند که پورت شبیه آپلینک
 * نباشد: بیش از چند MAC، یا همسایه‌ای که سوییچ/روتر است و سرور شناخته‌شده‌ای
 * نیست.
 *
 * تابع خالص است — بدون دیتابیس — تا بدون سوییچ آزموده شود.
 */

const MAX_SERVER_MACS = 8;

// قابلیت‌هایی که یعنی «همسایه سوییچ یا روتر است». در LLDP حرف S یعنی
// Station (همان سرور)، نه Switch — پس فقط B و R. CDP را سرورها نمی‌فرستند و
// هر همسایه CDP شبکه‌ای است.
const SWITCH_CAPS = ['bridge', 'router', 'switch', 'b', 'r'];

/**
 * ports:   [{id, name, kind, server_id, is_protected, member_of, description,
 *            mac_count, macs: [{mac}], neighbors: [{sys_name, caps}],
 *            suggest_dismissed_server_id}]
 * servers: [{id, name, hostname, main_ip, ips: [string]}]
 * arp:     [{ip, mac}]
 *
 * خروجی: Map(port_id ← {server_id, reason}) — فقط پورت‌هایی که پیشنهاد دارند.
 */
export function suggestLinks({ ports, servers, arp }) {
  const ipToServer = new Map();
  const nameToServer = new Map();
  for (const s of servers) {
    for (const ip of [s.main_ip, ...(s.ips ?? [])]) if (ip) ipToServer.set(String(ip), s.id);
    for (const n of [s.hostname, s.name]) {
      const k = shortHostName(n);
      // نام تکراری بین دو سرور نشانه نیست
      if (k) nameToServer.set(k, nameToServer.has(k) && nameToServer.get(k) !== s.id ? null : s.id);
    }
  }
  const macToIps = new Map();
  for (const a of arp) {
    if (!macToIps.has(a.mac)) macToIps.set(a.mac, new Set());
    macToIps.get(a.mac).add(String(a.ip));
  }
  const serverName = new Map(servers.map((s) => [s.id, s.name]));

  const out = new Map();
  for (const p of ports) {
    if (p.server_id || p.is_protected || p.member_of) continue;
    if (!['ethernet', 'port-channel'].includes(p.kind)) continue;

    const strong = new Map(); // server_id ← دلیل
    const weak = new Map();
    let unknownSwitchNeighbor = false;

    for (const n of p.neighbors ?? []) {
      const sid = nameToServer.get(shortHostName(n.sys_name));
      if (sid) strong.set(sid, `همسایه ${n.proto?.toUpperCase() ?? 'LLDP'} خودش را «${n.sys_name}» معرفی می‌کند`);
      else if (n.proto === 'cdp' || (n.caps ?? []).some((c) => SWITCH_CAPS.includes(c))) unknownSwitchNeighbor = true;
    }
    const uplinkLike = unknownSwitchNeighbor || (p.mac_count ?? 0) > MAX_SERVER_MACS;
    if (uplinkLike && !strong.size) continue;

    for (const m of uplinkLike ? [] : p.macs ?? []) {
      for (const ip of macToIps.get(m.mac) ?? []) {
        const sid = ipToServer.get(ip);
        if (sid && !strong.has(sid)) strong.set(sid, `آی‌پی ${ip} (MAC ${m.mac}) روی این پورت دیده شد`);
      }
    }

    if (!strong.size && p.description) {
      const d = ` ${String(p.description).toLowerCase()} `;
      for (const s of servers) {
        const tokens = [s.name, s.hostname && shortHostName(s.hostname), s.main_ip].filter(Boolean).map((t) => String(t).toLowerCase());
        // مرز کلمه دستی: «web-1» نباید با «web-10» جور شود
        if (tokens.some((t) => t.length >= 3 && new RegExp(`[^a-z0-9.]${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9.]`).test(d))) {
          weak.set(s.id, `توضیح پورت «${p.description}» نام یا آی‌پی سرور را دارد`);
        }
      }
    }

    const pick = strong.size ? strong : weak;
    if (pick.size !== 1) continue;
    const [[sid, reason]] = [...pick];
    if (sid === p.suggest_dismissed_server_id) continue;
    out.set(p.id, { server_id: sid, reason, server_name: serverName.get(sid) ?? null });
  }
  return out;
}

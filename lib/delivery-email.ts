import { esc } from '@/worker/mail-template.mjs';

/**
 * متن ایمیل تحویل سرور.
 *
 * ── رمز عبور ذخیره نمی‌شود ─────────────────────────────────
 *
 * ادمین رمز را در فرم تحویل می‌نویسد و همان لحظه در ایمیل می‌رود.
 * **هیچ‌جا در دیتابیس نوشته نمی‌شود.** نگهداری‌اش یعنی یک دامپ
 * دیتابیس، رمز همه سرورهای تحویل‌شده را لو می‌دهد.
 *
 * عوارضش این است که اگر ایمیل نرسد، رمز از دست رفته و باید عوض شود.
 * آن هزینه به‌مراتب کمتر از نگهداری رمز است.
 *
 * ── چرا متن و نه فقط قالب ──────────────────────────────────
 *
 * ایمیل دو نسخه دارد: متنی و اچ‌تی‌ام‌ال. نسخه متنی برای کلاینت متنی و
 * فیلتر هرزنامه لازم است، و مشخصات سرور در آن هم باید خوانا بماند.
 */

export interface DeliveryInput {
  orderNumber: string;
  productName: string;
  customerName: string;
  server?: {
    name: string;
    main_ip: string | null;
    hostname: string | null;
    os: string | null;
    cpu_model: string | null;
    cpu_cores: number | null;
    ram_total_bytes: number | null;
    disk_total_bytes: number | null;
    location: string | null;
  } | null;
  username?: string;
  password?: string;
  sshPort?: number | string | null;
  extraNote?: string;
  panelUrl?: string;
}

/** بایت به شکل خوانا؛ برای متن ایمیل، بدون وابستگی به قالب‌بند رابط */
function bytes(value: number | null | undefined): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const units = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** ردیف‌های مشخصات، فقط آن‌هایی که مقدار دارند */
export function deliveryRows(input: DeliveryInput): [string, string][] {
  const s = input.server;
  const rows: [string, string][] = [];

  if (s) {
    if (s.main_ip) rows.push(['آی‌پی', s.main_ip]);
    if (s.hostname) rows.push(['نام میزبان', s.hostname]);
    if (s.os) rows.push(['سیستم عامل', s.os]);
    if (s.cpu_model) rows.push(['پردازنده', s.cpu_model]);
    if (s.cpu_cores) rows.push(['تعداد هسته', String(s.cpu_cores)]);

    const ram = bytes(s.ram_total_bytes);
    if (ram) rows.push(['حافظه', ram]);

    const disk = bytes(s.disk_total_bytes);
    if (disk) rows.push(['دیسک', disk]);

    if (s.location) rows.push(['موقعیت', s.location]);
  }

  if (input.sshPort) rows.push(['پورت SSH', String(input.sshPort)]);
  if (input.username) rows.push(['نام کاربری', input.username]);
  if (input.password) rows.push(['گذرواژه', input.password]);

  return rows;
}

/** نسخه متنی */
export function deliveryText(input: DeliveryInput): string {
  const rows = deliveryRows(input);
  const base = String(input.panelUrl || '').replace(/\/+$/, '');

  const lines = [
    `سلام ${input.customerName} عزیز،`,
    '',
    `سفارش ${input.orderNumber} — ${input.productName} آماده و تحویل شد.`,
  ];

  if (rows.length) {
    lines.push('', 'مشخصات سرور:', '');
    // پهنای برچسب یکسان می‌شود تا در قلم تک‌عرض خوانا بماند
    const width = Math.max(...rows.map(([k]) => k.length));
    for (const [k, v] of rows) lines.push(`  ${k.padEnd(width, ' ')}  ${v}`);
  }

  if (input.extraNote) lines.push('', input.extraNote);

  lines.push(
    '',
    'لطفا پس از اولین ورود، گذرواژه را عوض کنید.',
    'این ایمیل حاوی اطلاعات ورود است؛ آن را در جای امن نگه دارید.',
  );

  if (base) lines.push('', `مصرف و وضعیت سرور در پرتال:`, `${base}/portal`);

  lines.push('', 'از همراهی شما سپاسگزاریم.');

  return lines.join('\n');
}

/**
 * جدول مشخصات به شکل اچ‌تی‌ام‌ال، برای جاگذاری در قالب ایمیل.
 *
 * چیدمان با جدول است نه flex — اوت‌لوک دسکتاپ موتور رندر ورد دارد.
 * مقادیر خنثی می‌شوند: نام میزبان و سیستم عامل از دیتابیس می‌آیند و
 * یک علامت کوچک‌تر در آن‌ها کل قالب را از هم می‌پاشد.
 */
export function deliveryHtmlBlock(input: DeliveryInput): string {
  const rows = deliveryRows(input);
  if (!rows.length) return '';

  const body = rows
    .map(
      ([k, v]) =>
        `<tr>` +
        `<td style="padding:6px 0;color:#6b7a90;white-space:nowrap;">${esc(k)}</td>` +
        `<td style="padding:6px 0 6px 12px;direction:ltr;text-align:left;font-family:monospace;">${esc(v)}</td>` +
        `</tr>`,
    )
    .join('');

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="margin:6px 0 14px;font-size:13px;border-top:1px solid #e7ebf1;">${body}</table>`
  );
}

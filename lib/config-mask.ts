/**
 * پوشاندن رازهای پیکربندی سوییچ پیش از نمایش.
 *
 * running-config هش گذرواژه کاربران، کامیونیتی SNMP، کلید TACACS/RADIUS و
 * کلید احراز هویت مسیریابی را دارد. هش هم راز است: با شکستن آفلاین
 * گذرواژه به دست می‌آید. نسخه کامل در دیتابیس می‌ماند (برای بازگرداندن
 * لازم است) و فقط با درخواست صریح مدیر نشان داده می‌شود.
 *
 * قاعده‌ها عمدا گشادند: پوشاندن یک کلمه بی‌خطر بهتر از نشان دادن یک راز
 * است. نوع رمز (عدد تک‌رقمی پیش از راز، مثل 5 یا 7) دیده می‌ماند.
 */

export const MASK = '••••••';

const RULES: RegExp[] = [
  // username admin password 5 $5$…   /   enable secret 5 …   /   neighbor … password 3 …
  /\b(?:password|secret)\s+(?!strength-check\b)(?:\d\s+)?("[^"]*"|\S+)/gi,
  // snmp-server user u network-admin auth md5 0x… priv aes-128 0x… localizedkey
  /\bauth\s+(?:md5|sha\S*)\s+("[^"]*"|\S+)/gi,
  /\bpriv(?:\s+(?:aes-?\d+|3?des))?\s+("[^"]*"|\S+)/gi,
  // snmp-server community public group network-operator
  /\bcommunity\s+("[^"]*"|\S+)/gi,
  // snmp-server host 10.0.0.1 traps version 2c public
  /\bversion\s+(?:1|2c)\s+("[^"]*"|\S+)/gi,
  // tacacs-server key 7 "…"  /  key-string 7 …  /  ip ospf message-digest-key 1 md5 3 …
  // ntp authentication-key 1 md5 … 7  /  pre-shared-key …
  /\bkey(?!\s+chain\b)(?:-string)?\s+(?:\d+\s+)?(?:(?:md5|sha\S*)\s+)?(?:\d\s+)?("[^"]*"|\S+)/gi,
  // hsrp/vrrp: authentication text …
  /\bauthentication\s+text\s+("[^"]*"|\S+)/gi,
];

/** یک خط؛ برای تفاوت دو نسخه که روی متن کامل حساب و سپس خط‌به‌خط پوشانده می‌شود */
export function maskLine(line: string): { text: string; masked: number } {
  // توضیح‌های «!» راز ندارند و ممکن است کلمه password داشته باشند
  if (/^\s*!/.test(line)) return { text: line, masked: 0 };
  let masked = 0;
  let out = line;
  for (const re of RULES) {
    out = out.replace(re, (whole: string, secret: string) => {
      if (secret === MASK) return whole;
      masked++;
      return whole.slice(0, whole.length - secret.length) + MASK;
    });
  }
  return { text: out, masked };
}

export function maskConfig(text: string): { text: string; masked: number } {
  let masked = 0;
  const lines = text.split('\n').map((line) => {
    const r = maskLine(line);
    masked += r.masked;
    return r.text;
  });
  return { text: lines.join('\n'), masked };
}

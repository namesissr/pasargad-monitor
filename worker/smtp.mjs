import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import crypto from 'node:crypto';

/**
 * کلاینت SMTP، فقط با ماژول‌های داخلی نود.
 *
 * چرا پکیج نصب نشد: کل پروژه چهار وابستگی دارد و همین باعث شده بیلد روی
 * سرور داخل ایران قابل اعتماد بماند. SMTP هم پروتکل کوچکی است.
 *
 * **این فایل در worker/ است ولی هر دو طرف از آن استفاده می‌کنند** — ورکر
 * مستقیم، و اپ وب با ایمپورت از @/worker/smtp.mjs. برخلاف پیامک و تلگرام
 * که عمداً دو نسخه دارند، اینجا یک نسخه است: پروتکلی با این تعداد جزئیات
 * اگر دو جا نوشته شود، دیر یا زود دو رفتار متفاوت می‌دهد.
 *
 * ایمیج ورکر فقط پوشه worker را کپی می‌کند، پس جای فایل همین‌جاست.
 *
 * نکته درباره فارسی: هم موضوع و هم بدنه یونیکدند. سرآیند با «کلمه
 * رمزشده» RFC 2047 می‌رود و بدنه با base64. اگر خام فرستاده شوند، بیشتر
 * سرورها یا رد می‌کنند یا گیرنده متن درهم می‌بیند — و درهم‌دیدن بدترین
 * حالت است چون هیچ خطایی هم نمی‌آید.
 */

const CRLF = '\r\n';

export class SmtpError extends Error {}

/** آیا این رشته فقط اسکی چاپی است؟ سرآیند اسکی نیازی به رمزگذاری ندارد */
export function isAscii(text) {
  return /^[\x20-\x7E]*$/.test(String(text ?? ''));
}

/**
 * سرآیند غیراسکی به شکل «کلمه رمزشده» RFC 2047.
 *
 * هر کلمه رمزشده حداکثر ۷۵ کاراکتر است. دوازده کاراکترش را خود قالب
 * =?UTF-8?B??= می‌گیرد، پس base64 هر تکه باید زیر ۶۳ بماند و تکه‌ها با
 * شکست خط و یک فاصله به هم وصل می‌شوند.
 *
 * تکه‌کردن روی مرز **کاراکتر** انجام می‌شود نه بایت. اگر وسط یک کاراکتر
 * چندبایتی بریده شود، گیرنده به‌جای حرف فارسی علامت سؤال می‌بیند.
 */
export function encodeHeader(text) {
  const value = String(text ?? '');
  if (isAscii(value)) return value;

  const words = [];
  let chunk = '';
  for (const ch of value) {
    const next = chunk + ch;
    if (Buffer.from(next, 'utf8').toString('base64').length > 63) {
      words.push(chunk);
      chunk = ch;
    } else {
      chunk = next;
    }
  }
  if (chunk) words.push(chunk);

  return words
    .map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`)
    .join(CRLF + ' ');
}

/** بدنه base64 با خطوط حداکثر ۷۶ کاراکتری، همان‌طور که RFC می‌خواهد */
export function encodeBody(text) {
  const b64 = Buffer.from(String(text ?? ''), 'utf8').toString('base64');
  const lines = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join(CRLF);
}

/**
 * نشانی به شکل قابل استفاده در MAIL FROM و RCPT TO.
 *
 * ورودی ممکن است «نام <a@b>» باشد؛ فقط بخش داخل کروشه لازم است.
 */
export function bareAddress(input) {
  const value = String(input ?? '').trim();
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim();
}

/**
 * ساخت پیام کامل.
 *
 * بدنه base64 است و الفبای base64 نقطه ندارد، پس هیچ خطی با نقطه شروع
 * نمی‌شود و «دات‌استافینگ» موضوعیت پیدا نمی‌کند. اگر روزی بدنه را به متن
 * خام تغییر دادید، آن قاعده را باید اضافه کنید — وگرنه پیامی که خطی با
 * نقطه دارد وسط راه بریده می‌شود.
 */
export function buildMessage({ from, fromName, to, subject, text, messageId }) {
  const address = bareAddress(from);
  const fromHeader = fromName ? `${encodeHeader(fromName)} <${address}>` : address;
  const id = messageId || `<${crypto.randomUUID()}@${address.split('@')[1] || 'localhost'}>`;

  const headers = [
    `From: ${fromHeader}`,
    `To: ${bareAddress(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${id}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];

  return headers.join(CRLF) + CRLF + CRLF + encodeBody(text) + CRLF;
}

/**
 * گفتگوی SMTP روی یک سوکت.
 *
 * پاسخ چندخطی است: خطی که بعد از کد سه‌رقمی خط تیره دارد ادامه دارد، و
 * خطی که فاصله دارد آخرین است. بدون این تفکیک، فهرست قابلیت‌های EHLO
 * به‌شکل چند پاسخ جدا خوانده می‌شود و کل گفتگو یک قدم عقب می‌افتد.
 */
class Session {
  constructor(socket, timeout) {
    this.socket = socket;
    this.timeout = timeout;
    this.buffer = '';
    this.waiters = [];
    this.closed = null;

    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      this._drain();
    });
    socket.on('error', (e) => this._fail(new SmtpError(`خطای اتصال: ${e.message}`)));
    socket.on('close', () => this._fail(new SmtpError('اتصال بسته شد')));
  }

  _fail(error) {
    this.closed = error;
    const pending = this.waiters.splice(0);
    for (const w of pending) w.reject(error);
  }

  _drain() {
    while (this.waiters.length) {
      const end = this._completeResponse();
      if (end < 0) return;
      const raw = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      const waiter = this.waiters.shift();
      clearTimeout(waiter.timer);

      const lines = raw.split(CRLF).filter(Boolean);
      const code = Number(lines[lines.length - 1].slice(0, 3));
      waiter.resolve({ code, lines, text: raw.trim() });
    }
  }

  /** جای پایان اولین پاسخ کامل در بافر، یا ۱- اگر هنوز کامل نشده */
  _completeResponse() {
    let index = 0;
    while (true) {
      const nl = this.buffer.indexOf(CRLF, index);
      if (nl < 0) return -1;
      const line = this.buffer.slice(index, nl);
      // کد سه‌رقمی و بعدش فاصله یعنی خط آخر؛ خط تیره یعنی ادامه دارد
      if (line.length >= 4 && line[3] === ' ') return nl + CRLF.length;
      if (line.length === 3) return nl + CRLF.length;
      index = nl + CRLF.length;
    }
  }

  read() {
    if (this.closed) return Promise.reject(this.closed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          const i = this.waiters.findIndex((w) => w.timer === timer);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new SmtpError('سرور ایمیل در مهلت مقرر پاسخ نداد'));
        },
        this.timeout,
      );
      this.waiters.push({ resolve, reject, timer });
      this._drain();
    });
  }

  write(line) {
    this.socket.write(line + CRLF);
  }

  /** فرمان بفرست و پاسخ را بررسی کن؛ کد نامنتظر یعنی خطا */
  async cmd(line, expected, redact = false) {
    this.write(line);
    const res = await this.read();
    if (!expected.includes(res.code)) {
      const shown = redact ? '(محتوا نمایش داده نشد)' : line.slice(0, 60);
      throw new SmtpError(`سرور به «${shown}» پاسخ ${res.code} داد: ${res.text.slice(0, 200)}`);
    }
    return res;
  }
}

function connect(options) {
  return new Promise((resolve, reject) => {
    const socket = options.implicitTls
      ? tls.connect({
          host: options.host,
          port: options.port,
          servername: options.host,
          rejectUnauthorized: !options.insecure,
        })
      : net.connect({ host: options.host, port: options.port });

    const onReady = () => {
      socket.removeListener('error', onError);
      resolve(socket);
    };
    const onError = (e) => {
      socket.removeListener(options.implicitTls ? 'secureConnect' : 'connect', onReady);
      reject(new SmtpError(`اتصال به ${options.host}:${options.port} برقرار نشد: ${e.message}`));
    };
    socket.once(options.implicitTls ? 'secureConnect' : 'connect', onReady);
    socket.once('error', onError);
    socket.setTimeout(options.timeout, () => {
      socket.destroy();
      reject(new SmtpError(`اتصال به ${options.host}:${options.port} در مهلت مقرر برقرار نشد`));
    });
  });
}

function upgrade(socket, options) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect(
      {
        socket,
        servername: options.host,
        rejectUnauthorized: !options.insecure,
      },
      () => resolve(secure),
    );
    secure.once('error', (e) => reject(new SmtpError(`ارتقا به TLS نشد: ${e.message}`)));
  });
}

/**
 * ارسال یک ایمیل.
 *
 * config: { host, port, security: 'none'|'starttls'|'tls', user, pass,
 *           from, fromName, insecure, timeout }
 *
 * برمی‌گرداند { ok, error } — مثل sendSms و sendTelegram، تا کد فراخوان
 * یکسان بماند و خطا در لاگ اعلان‌ها ثبت شود.
 */
export async function sendMail(config, { to, subject, text }) {
  const host = String(config.host || '').trim();
  const from = bareAddress(config.from);
  if (!host) return { ok: false, error: 'آدرس سرور SMTP تنظیم نشده است' };
  if (!from) return { ok: false, error: 'نشانی فرستنده تنظیم نشده است' };

  const recipient = bareAddress(to);
  if (!recipient || !recipient.includes('@')) {
    return { ok: false, error: `نشانی گیرنده نامعتبر است: ${to}` };
  }

  const security = String(config.security || 'starttls');
  const port = Number(config.port) || (security === 'tls' ? 465 : 587);
  const timeout = Number(config.timeout) || 20_000;

  let socket;
  try {
    socket = await connect({
      host,
      port,
      implicitTls: security === 'tls',
      insecure: Boolean(config.insecure),
      timeout,
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }

  // مهلت اتصال دیگر لازم نیست؛ از اینجا به بعد مهلت هر پاسخ جداست
  socket.setTimeout(0);
  let session = new Session(socket, timeout);

  try {
    const greeting = await session.read();
    if (greeting.code !== 220) {
      throw new SmtpError(`سرور با کد ${greeting.code} شروع کرد: ${greeting.text.slice(0, 200)}`);
    }

    const me = os.hostname() || 'localhost';
    let ehlo = await session.cmd(`EHLO ${me}`, [250]);

    if (security === 'starttls') {
      const supported = ehlo.lines.some((l) => l.slice(4).toUpperCase().startsWith('STARTTLS'));
      if (!supported) {
        throw new SmtpError(
          'سرور STARTTLS را پشتیبانی نمی‌کند. اگر پورت ۴۶۵ است، امنیت را روی «TLS مستقیم» بگذارید.',
        );
      }
      await session.cmd('STARTTLS', [220]);
      const secure = await upgrade(socket, { host, insecure: Boolean(config.insecure) });
      session = new Session(secure, timeout);
      // بعد از ارتقا باید دوباره معرفی شود؛ قابلیت‌های قبلی دیگر معتبر نیستند
      ehlo = await session.cmd(`EHLO ${me}`, [250]);
    }

    const user = String(config.user || '');
    const pass = String(config.pass || '');
    if (user) {
      const authLine = ehlo.lines.find((l) => l.slice(4).toUpperCase().startsWith('AUTH')) || '';
      const methods = authLine.slice(4).toUpperCase();

      if (methods.includes('PLAIN')) {
        const token = Buffer.from(`\0${user}\0${pass}`, 'utf8').toString('base64');
        await session.cmd(`AUTH PLAIN ${token}`, [235], true);
      } else if (methods.includes('LOGIN')) {
        await session.cmd('AUTH LOGIN', [334]);
        await session.cmd(Buffer.from(user, 'utf8').toString('base64'), [334], true);
        await session.cmd(Buffer.from(pass, 'utf8').toString('base64'), [235], true);
      } else {
        throw new SmtpError('سرور روش ورود PLAIN یا LOGIN را اعلام نکرد');
      }
    }

    await session.cmd(`MAIL FROM:<${from}>`, [250]);
    await session.cmd(`RCPT TO:<${recipient}>`, [250, 251]);
    await session.cmd('DATA', [354]);

    session.socket.write(
      buildMessage({ from, fromName: config.fromName, to: recipient, subject, text }),
    );
    const done = await session.cmd('.', [250]);

    try {
      session.write('QUIT');
    } catch {
      // بسته‌شدن زودهنگام بعد از پذیرش، مشکلی نیست — پیام رفته است
    }
    session.socket.end();
    return { ok: true, detail: done.text.slice(0, 120) };
  } catch (e) {
    try {
      session.socket.destroy();
    } catch {
      // چیزی برای پاک‌کردن نمانده
    }
    return { ok: false, error: e instanceof SmtpError ? e.message : `خطای ناشناخته: ${e.message}` };
  }
}

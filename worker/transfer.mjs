import dgram from 'node:dgram';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * جابه‌جایی فایل میان سوییچ و پنل، برای CISCO-CONFIG-COPY-MIB.
 *
 * با SNMP راهی برای فرستادن متن پیکربندی به سوییچ یا خواندن running-config
 * نیست؛ پنل به سوییچ می‌گوید فایلی را از سرور پنل بردارد یا بفرستد. این
 * ماژول دو طرف کار را فراهم می‌کند:
 *
 *   tftp  سرور کوچک TFTP داخل ورکر (RFC 1350، UDP ۶۹). فقط وقتی کاری در
 *         جریان است گوش می‌دهد و چند دقیقه بیکاری که گذشت بسته می‌شود.
 *   sftp  sshd خود سرور پنل، با کاربری محدود به یک پوشه (chroot). همان
 *         پوشه به ورکر وصل است (SWITCH_SFTP_DIR)؛ ورکر فایل را آنجا
 *         می‌گذارد یا از آنجا برمی‌دارد. MIB ستون پورت ندارد و سوییچ همیشه
 *         به پورت ۲۲ وصل می‌شود؛ برای همین sshd خود سرور، نه سرور جدا.
 *
 * نام هر فایل تصادفی و یک‌بارمصرف است و پس از کار پاک می‌شود. کسی که نام
 * را نداند نه می‌تواند فایل را بخواند نه به‌جای سوییچ پیکربندی جعلی بفرستد.
 */

const TFTP_PORT = Number(process.env.SWITCH_TFTP_PORT || 69);
const SFTP_DIR = process.env.SWITCH_SFTP_DIR || '/transfer';
const SLOT_TTL_MS = 5 * 60_000;
const IDLE_CLOSE_MS = 3 * 60_000;
const MAX_UPLOAD = 32 * 1024 * 1024;
const BLOCK = 512;
const RETRY_MS = 2000;
const MAX_RETRIES = 5;

export class TransferError extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint ?? message;
  }
}

const newName = () => `pm-${randomBytes(12).toString('hex')}.cfg`;

// ── رابط بیرونی ────────────────────────────────────────────

/**
 * فایلی که سوییچ باید دانلود کند (مثلا تکه پیکربندی).
 * fileName همان چیزی است که در ccCopyFileName می‌رود.
 */
export async function offerFile(protocol, cfg, text) {
  const name = newName();
  if (protocol === 'tftp') {
    await ensureTftp();
    slots.set(name, { kind: 'read', data: Buffer.from(text, 'utf8'), expires: Date.now() + SLOT_TTL_MS });
    return { fileName: name, cleanup: async () => void slots.delete(name) };
  }
  if (protocol === 'sftp') {
    await assertSftpDir();
    const local = path.join(SFTP_DIR, name);
    await fs.writeFile(local, text, { mode: 0o644 });
    return { fileName: sftpPath(cfg, name), cleanup: () => fs.rm(local, { force: true }) };
  }
  throw new TransferError('روش انتقال نامعتبر', 'برای این سوییچ روش انتقال فایل (SFTP یا TFTP) انتخاب نشده');
}

/**
 * جایی که سوییچ فایلش را بفرستد (مثلا running-config). read() پس از تمام
 * شدن کپی در سوییچ صدا زده می‌شود.
 */
export async function expectFile(protocol, cfg) {
  const name = newName();
  if (protocol === 'tftp') {
    await ensureTftp();
    let resolve;
    let reject;
    const done = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    done.catch(() => {});
    slots.set(name, { kind: 'write', resolve, reject, expires: Date.now() + SLOT_TTL_MS });
    return {
      fileName: name,
      // سوییچ «موفق» را پس از آخرین بلوک اعلام می‌کند، ولی بسته‌ها ممکن است
      // کمی دیرتر برسند
      read: () => withTimeout(done, 15_000, 'فایل پیکربندی با TFTP کامل نرسید').then((b) => b.toString('utf8')),
      cleanup: async () => void slots.delete(name),
    };
  }
  if (protocol === 'sftp') {
    await assertSftpDir();
    const local = path.join(SFTP_DIR, name);
    return {
      fileName: sftpPath(cfg, name),
      read: async () => {
        for (let i = 0; i < 10; i++) {
          try {
            return await fs.readFile(local, 'utf8');
          } catch {
            await new Promise((r) => setTimeout(r, 500));
          }
        }
        throw new TransferError(
          'فایل نرسید',
          `سوییچ گفت کپی تمام شد ولی فایل در پوشه مشترک (${SFTP_DIR}) نیست — مسیر SFTP در تنظیمات با پوشه‌ای که به ورکر وصل است یکی نیست`,
        );
      },
      cleanup: () => fs.rm(local, { force: true }),
    };
  }
  throw new TransferError('روش انتقال نامعتبر', 'برای این سوییچ روش انتقال فایل (SFTP یا TFTP) انتخاب نشده');
}

function sftpPath(cfg, name) {
  const base = String(cfg?.path || '/').replace(/\/+$/, '');
  return `${base}/${name}`;
}

async function assertSftpDir() {
  try {
    await fs.access(SFTP_DIR, fs.constants.W_OK);
  } catch {
    throw new TransferError(
      'پوشه SFTP نیست',
      `پوشه مشترک SFTP (${SFTP_DIR}) در ورکر نیست یا نوشتنی نیست — volume آن را در docker-compose بررسی کنید (docs/switches.md)`,
    );
  }
}

function withTimeout(p, ms, message) {
  let t;
  return Promise.race([
    p,
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new TransferError(message)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

// ── سرور TFTP ──────────────────────────────────────────────

const slots = new Map(); // نام فایل ← {kind: read|write, …}
const sessions = new Map(); // address:port ← انتقال در جریان
let sock = null;
let starting = null;
let idleTimer = null;

const OP = { RRQ: 1, WRQ: 2, DATA: 3, ACK: 4, ERROR: 5 };

/** برای آزمون: پورت واقعی سوکت */
export function tftpAddress() {
  return sock ? sock.address() : null;
}

export async function ensureTftp(port = TFTP_PORT) {
  touch();
  if (sock) return;
  if (!starting) {
    starting = new Promise((resolve, reject) => {
      const s = dgram.createSocket('udp4');
      s.once('error', (err) => {
        starting = null;
        s.close();
        reject(
          new TransferError(
            'سرور TFTP بالا نیامد',
            err.code === 'EADDRINUSE'
              ? `پورت UDP ${port} روی ورکر گرفته است`
              : err.code === 'EACCES'
                ? `اجازه گوش دادن روی پورت UDP ${port} نیست`
                : `سرور TFTP بالا نیامد: ${err.message}`,
          ),
        );
      });
      s.on('message', (msg, rinfo) => {
        try {
          onMessage(msg, rinfo);
        } catch {
          // بسته خراب از هر کسی؛ نادیده
        }
      });
      s.bind(port, () => {
        s.removeAllListeners('error');
        s.on('error', () => {});
        sock = s;
        starting = null;
        resolve();
      });
    });
  }
  await starting;
}

export function closeTftp() {
  clearTimeout(idleTimer);
  for (const ses of sessions.values()) clearTimeout(ses.timer);
  sessions.clear();
  if (sock) sock.close();
  sock = null;
}

function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const now = Date.now();
    for (const [k, v] of slots) if (v.expires < now) slots.delete(k);
    if (!slots.size && !sessions.size) closeTftp();
    else touch();
  }, IDLE_CLOSE_MS);
  idleTimer.unref?.();
}

function send(rinfo, buf) {
  sock?.send(buf, rinfo.port, rinfo.address);
}

function errorPacket(code, message) {
  const m = Buffer.from(message, 'latin1');
  const b = Buffer.alloc(5 + m.length);
  b.writeUInt16BE(OP.ERROR, 0);
  b.writeUInt16BE(code, 2);
  m.copy(b, 4);
  return b;
}

function ackPacket(block) {
  const b = Buffer.alloc(4);
  b.writeUInt16BE(OP.ACK, 0);
  b.writeUInt16BE(block & 0xffff, 2);
  return b;
}

/** netascii: هر LF به CR LF، هر CR تنها به CR NUL */
export function toNetascii(buf) {
  return Buffer.from(buf.toString('latin1').replace(/\r/g, '\r\0').replace(/\n/g, '\r\n'), 'latin1');
}

export function fromNetascii(buf) {
  return Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n').replace(/\r\0/g, '\r'), 'latin1');
}

function arm(key, ses) {
  clearTimeout(ses.timer);
  ses.timer = setTimeout(() => {
    if (ses.retries++ >= MAX_RETRIES) {
      sessions.delete(key);
      ses.slot?.reject?.(new TransferError('انتقال TFTP قطع شد', 'سوییچ وسط انتقال TFTP جواب نداد'));
      return;
    }
    send(ses.rinfo, ses.last);
    arm(key, ses);
  }, RETRY_MS);
  ses.timer.unref?.();
}

function sendBlock(key, ses) {
  const start = (ses.block - 1) * BLOCK;
  const chunk = ses.data.subarray(start, start + BLOCK);
  const b = Buffer.alloc(4 + chunk.length);
  b.writeUInt16BE(OP.DATA, 0);
  b.writeUInt16BE(ses.block & 0xffff, 2);
  chunk.copy(b, 4);
  ses.last = b;
  ses.final = chunk.length < BLOCK;
  ses.retries = 0;
  send(ses.rinfo, b);
  arm(key, ses);
}

function onMessage(msg, rinfo) {
  if (msg.length < 4) return;
  touch();
  const op = msg.readUInt16BE(0);
  const key = `${rinfo.address}:${rinfo.port}`;

  if (op === OP.RRQ || op === OP.WRQ) {
    const [file = '', mode = ''] = msg.subarray(2).toString('latin1').split('\0');
    // سوییچ ممکن است مسیر بفرستد؛ فقط نام فایل معنا دارد
    const name = path.posix.basename(file.replace(/\\/g, '/'));
    const slot = slots.get(name);
    const want = op === OP.RRQ ? 'read' : 'write';
    if (!slot || slot.kind !== want || slot.expires < Date.now()) {
      send(rinfo, errorPacket(op === OP.RRQ ? 1 : 2, op === OP.RRQ ? 'File not found' : 'Access violation'));
      return;
    }
    const m = mode.toLowerCase();
    if (m !== 'octet' && m !== 'netascii') {
      send(rinfo, errorPacket(4, 'Unsupported mode'));
      return;
    }
    const old = sessions.get(key);
    if (old) clearTimeout(old.timer);
    if (op === OP.RRQ) {
      const ses = { type: 'read', rinfo, data: m === 'netascii' ? toNetascii(slot.data) : slot.data, block: 1, retries: 0 };
      sessions.set(key, ses);
      sendBlock(key, ses);
    } else {
      const ses = { type: 'write', rinfo, slot, netascii: m === 'netascii', chunks: [], size: 0, block: 0, retries: 0 };
      sessions.set(key, ses);
      ses.last = ackPacket(0);
      send(rinfo, ses.last);
      arm(key, ses);
    }
    return;
  }

  const ses = sessions.get(key);
  if (!ses) return;
  const block = msg.readUInt16BE(2);

  if (op === OP.ACK && ses.type === 'read') {
    if (block !== (ses.block & 0xffff)) return; // تکراری یا قدیمی
    if (ses.final) {
      clearTimeout(ses.timer);
      sessions.delete(key);
      return;
    }
    ses.block++;
    sendBlock(key, ses);
    return;
  }

  if (op === OP.DATA && ses.type === 'write') {
    const expected = (ses.block + 1) & 0xffff;
    if (block === (ses.block & 0xffff)) {
      // بلوک تکراری: ACK قبلی گم شده
      send(rinfo, ses.last);
      return;
    }
    if (block !== expected) return;
    const data = msg.subarray(4);
    ses.size += data.length;
    if (ses.size > MAX_UPLOAD) {
      send(rinfo, errorPacket(3, 'Disk full'));
      clearTimeout(ses.timer);
      sessions.delete(key);
      ses.slot.reject(new TransferError('فایل بزرگ است', 'فایل ارسالی سوییچ از سقف ۳۲ مگابایت بزرگ‌تر است'));
      return;
    }
    ses.chunks.push(Buffer.from(data));
    ses.block++;
    ses.last = ackPacket(ses.block);
    ses.retries = 0;
    send(rinfo, ses.last);
    if (data.length < BLOCK) {
      clearTimeout(ses.timer);
      sessions.delete(key);
      const all = Buffer.concat(ses.chunks);
      ses.slot.resolve(ses.netascii ? fromNetascii(all) : all);
    } else {
      arm(key, ses);
    }
    return;
  }

  if (op === OP.ERROR) {
    clearTimeout(ses.timer);
    sessions.delete(key);
    const text = msg.subarray(4).toString('latin1').replace(/\0.*$/, '');
    ses.slot?.reject?.(new TransferError('سوییچ انتقال را لغو کرد', `سوییچ انتقال TFTP را لغو کرد: ${text || 'بی‌علت'}`));
  }
}

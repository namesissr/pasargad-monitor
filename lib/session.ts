import { SignJWT, jwtVerify } from 'jose';

/**
 * نشست کاربر با توکن امضاشده در کوکی.
 *
 * این فایل عمداً فقط از jose استفاده می‌کند و به node:crypto دست نمی‌زند،
 * چون میان‌افزار نکست روی رانتایم Edge اجرا می‌شود و آنجا ماژول‌های نود
 * در دسترس نیستند. رمزنگاری گذرواژه در lib/auth.ts است که فقط در
 * مسیرهای API با رانتایم نود صدا زده می‌شود.
 */

export const SESSION_COOKIE = 'pm_session';
const SESSION_DAYS = 7;

export interface SessionPayload {
  uid: number;
  username: string;
  role: string;
}

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error('متغیر SESSION_SECRET تنظیم نشده یا کوتاه‌تر از ۱۶ کاراکتر است');
  }
  return new TextEncoder().encode(s);
}

/** ساخت توکن نشست */
export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

/** بررسی توکن نشست — در صورت نامعتبر بودن null برمی‌گرداند */
export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.uid !== 'number') return null;
    return {
      uid: payload.uid,
      username: String(payload.username ?? ''),
      role: String(payload.role ?? 'admin'),
    };
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 3600;

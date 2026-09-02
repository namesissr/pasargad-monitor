import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from './session';

/**
 * رمزنگاری گذرواژه با scrypt از کتابخانه استاندارد نود.
 * وابستگی بیرونی لازم نیست و مقاومتش در برابر حمله سخت‌افزاری از bcrypt بیشتر است.
 */

function scryptAsync(password: string, salt: Buffer, keylen = 64): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
}

/** ساخت هش گذرواژه به شکل salt:hash */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** بررسی گذرواژه در برابر هش ذخیره‌شده */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const derived = await scryptAsync(password, salt, expected.length);
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** توکن تصادفی برای ایجنت */
export function generateAgentToken(): string {
  return randomBytes(24).toString('base64url');
}

/** کاربر نشست جاری، یا null */
export async function currentUser(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

/**
 * کاربر نشست جاری؛ اگر نبود خطای ۴۰۱ می‌اندازد.
 * در هر مسیر API پنل اول این را صدا بزنید.
 */
export class UnauthorizedError extends Error {
  constructor() {
    super('برای این کار باید وارد شوید');
  }
}

export async function requireUser(): Promise<SessionPayload> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

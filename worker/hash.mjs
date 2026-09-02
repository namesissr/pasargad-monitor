import { randomBytes, scrypt } from 'node:crypto';

/** هش گذرواژه با scrypt — همان قالبی که lib/auth.ts می‌سازد: salt:hash */
export function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(`${salt.toString('hex')}:${derived.toString('hex')}`);
    });
  });
}

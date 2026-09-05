import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { q, q1 } from './db.mjs';
import { hashPassword } from './hash.mjs';

/**
 * ساخت یا تغییر گذرواژه کاربر پنل.
 *
 * اجرا روی سرور:
 *   docker compose exec worker node worker/create-user.mjs
 *
 * یا غیرتعاملی:
 *   docker compose exec worker node worker/create-user.mjs sajjad 'گذرواژه' 09121234567
 */

async function main() {
  let [username, password, phone, fullName, email] = process.argv.slice(2);

  if (!username || !password) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    username = username || (await rl.question('نام کاربری: ')).trim();
    password = password || (await rl.question('گذرواژه: ')).trim();
    phone = phone || (await rl.question('شماره موبایل برای هشدار (اختیاری): ')).trim();
    email = email || (await rl.question('ایمیل برای هشدار (اختیاری): ')).trim();
    fullName = fullName || (await rl.question('نام و نام خانوادگی (اختیاری): ')).trim();
    rl.close();
  }

  if (!username || !password) {
    console.error('نام کاربری و گذرواژه لازم است');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('گذرواژه باید حداقل ۸ کاراکتر باشد');
    process.exit(1);
  }

  const hash = await hashPassword(password);
  const existing = await q1('SELECT id FROM users WHERE lower(username) = lower($1)', [username]);

  if (existing) {
    await q(
      `UPDATE users SET password_hash = $2,
                        phone = COALESCE(NULLIF($3, ''), phone),
                        email = COALESCE(NULLIF($5, ''), email),
                        full_name = COALESCE(NULLIF($4, ''), full_name),
                        is_active = TRUE
        WHERE id = $1`,
      [existing.id, hash, phone || '', fullName || '', email || ''],
    );
    console.log(`گذرواژه کاربر «${username}» به‌روزرسانی شد`);
  } else {
    await q(
      `INSERT INTO users (username, password_hash, phone, full_name, email, role)
       VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''), 'admin')`,
      [username, hash, phone || '', fullName || '', email || ''],
    );
    console.log(`کاربر «${username}» ساخته شد`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('خطا:', err.message);
  process.exit(1);
});

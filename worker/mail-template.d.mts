/**
 * تایپ‌های worker/mail-template.mjs.
 *
 * مثل smtp.mjs، پیاده‌سازی جاوااسکریپت است تا ورکر بدون بیلد اجرا شود و
 * اپ وب هم همان فایل را ایمپورت کند — یک قالب، نه دو نسخه که از هم دور
 * می‌افتند.
 */

/** شدت پیام؛ رنگ نوار بالای قالب را تعیین می‌کند */
export type MailKind = 'info' | 'ok' | 'warn' | 'danger';

export interface RenderEmailInput {
  subject: string;
  text: string;
  kind?: MailKind;
  /** آدرس عمومی پنل؛ برای فایل قلم و دکمه «باز کردن پنل» */
  panelUrl?: string;
  brand?: string;
}

export declare function esc(value: unknown): string;
export declare function renderEmail(input: RenderEmailInput): string;

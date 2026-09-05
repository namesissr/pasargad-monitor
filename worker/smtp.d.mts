/**
 * تایپ‌های worker/smtp.mjs.
 *
 * خود پیاده‌سازی جاوااسکریپت است چون ورکر بدون بیلد اجرا می‌شود، ولی اپ
 * وب هم همان فایل را ایمپورت می‌کند و بدون این فایل، تایپ‌اسکریپت
 * ایمپورت را نمی‌شناسد و بیلد می‌شکند.
 */

export interface SmtpConfig {
  host: string;
  port?: number | string;
  /** none: بدون رمزنگاری · starttls: ارتقا روی همان پورت · tls: رمزنگاری از ابتدا */
  security?: 'none' | 'starttls' | 'tls' | string;
  user?: string;
  pass?: string;
  from: string;
  fromName?: string;
  /** گواهی نامعتبر پذیرفته شود — فقط برای سرور داخلی با گواهی خودامضا */
  insecure?: boolean;
  timeout?: number;
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
}

export interface SendResult {
  ok: boolean;
  error?: string;
  detail?: string;
}

export declare class SmtpError extends Error {}

export declare function isAscii(text: unknown): boolean;
export declare function encodeHeader(text: unknown): string;
export declare function encodeBody(text: unknown): string;
export declare function bareAddress(input: unknown): string;
export declare function buildMessage(input: {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  messageId?: string;
}): string;
export declare function sendMail(config: SmtpConfig, mail: MailInput): Promise<SendResult>;

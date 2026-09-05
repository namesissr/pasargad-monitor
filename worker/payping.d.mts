/** تایپ‌های worker/payping.mjs — پیاده‌سازی جاوااسکریپت است تا ورکر بدون بیلد اجرا شود */

export interface PayPingConfig {
  token: string;
  /** v2 یا v3؛ کدام برای حساب فعال است از بیرون معلوم نیست */
  version?: string;
  /** toman یا rial */
  unit?: string;
}

export interface CreatePaymentInput {
  amountToman: number;
  invoiceNumber: string;
  description: string;
  returnUrl: string;
  payerName?: string | null;
  payerIdentity?: string | null;
}

export interface CreatePaymentResult {
  code: string;
  url: string;
  version: string;
  /** مبلغ به واحدی که به درگاه رفت — برای پیگیری اختلاف */
  amount: number;
}

export interface VerifyInput {
  /** همیشه از دیتابیس، هرگز از آدرس بازگشت */
  amountToman: number;
  refId: string | null;
  paymentCode?: string | null;
}

export interface VerifyResult {
  ok: boolean;
  cardNumber: string | null;
  raw: unknown;
}

export interface CallbackParams {
  refId: string | null;
  paymentCode: string | null;
  clientRefId: string | null;
  cardNumber: string | null;
}

export declare class PayPingError extends Error {}

export declare function toGatewayAmount(toman: number, unit?: string): number;
export declare function readError(body: unknown, status: number): string;
export declare function createPayment(
  config: PayPingConfig,
  input: CreatePaymentInput,
): Promise<CreatePaymentResult>;
export declare function verifyPayment(
  config: PayPingConfig,
  input: VerifyInput,
): Promise<VerifyResult>;
export declare function readCallback(params: Iterable<[string, string]>): CallbackParams;

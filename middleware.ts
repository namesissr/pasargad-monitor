import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './lib/session';

/**
 * نگهبان مسیرها.
 *
 * مسیر /api/ingest عمداً باز است — ایجنت‌ها با توکن خودشان احراز می‌شوند،
 * نه با کوکی نشست. اگر آن را پشت این نگهبان ببرید، همه ایجنت‌ها ۴۰۱ می‌گیرند.
 */

// مسیر /agent فایل‌های نصب ایجنت است. باز بودنش لازم است، چون سرور تازه
// هیچ کوکی نشستی ندارد. توکن در آن فایل‌ها نیست؛ هنگام نصب آرگومان داده می‌شود.
// «probe» و «bind» هم مثل ingest با توکن خودشان احراز می‌شوند نه کوکی نشست
// /api/pay/return بازگشت از درگاه پرداخت است و باید عمومی بماند:
// درگاه با POST برمی‌گردد و کوکی sameSite=lax در POST بین‌سایتی
// فرستاده نمی‌شود. آن مسیر خودش هیچ داده‌ای نشان نمی‌دهد — فقط تأیید
// می‌کند و ریدایرکت می‌زند.
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/ingest', '/api/probe', '/api/bind', '/api/health', '/agent', '/api/pay/return'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  if (session) return NextResponse.next();

  // درخواست‌های API پاسخ جیسون می‌گیرند، نه ریدایرکت
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ message: 'برای این کار باید وارد شوید' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts/).*)'],
};

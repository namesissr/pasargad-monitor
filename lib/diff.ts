/**
 * تفاوت خط‌به‌خط دو متن، برای مقایسه دو نسخه پیکربندی سوییچ.
 *
 * الگوریتم مایرز (کوتاه‌ترین ویرایش). پیکربندی چند هزار خط است ولی
 * معمولا چند خطش عوض شده، و هزینه مایرز با تعداد تغییر بالا می‌رود نه با
 * طول متن. ابتدا و انتهای مشترک پیش از آن کنار گذاشته می‌شود.
 *
 * اگر تفاوت بیش از MAX_EDITS باشد (مثلا پیکربندی دستگاه دیگری) به‌جای
 * گرفتن حافظه زیاد، همه خطوط قدیم حذف و همه خطوط تازه اضافه نشان داده
 * می‌شوند — درست است، فقط کوتاه‌ترین نیست.
 */

export type DiffOp = '=' | '-' | '+';
export interface DiffLine {
  op: DiffOp;
  text: string;
  /** شماره خط در نسخه قدیم/تازه، از یک */
  a?: number;
  b?: number;
}

const MAX_EDITS = 4000;

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');

  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

  const out: DiffLine[] = [];
  for (let i = 0; i < pre; i++) out.push({ op: '=', text: a[i], a: i + 1, b: i + 1 });

  const mid = myers(a.slice(pre, a.length - suf), b.slice(pre, b.length - suf));
  let ai = pre;
  let bi = pre;
  for (const m of mid) {
    if (m.op === '=') out.push({ op: '=', text: m.text, a: ++ai, b: ++bi });
    else if (m.op === '-') out.push({ op: '-', text: m.text, a: ++ai });
    else out.push({ op: '+', text: m.text, b: ++bi });
  }

  for (let i = a.length - suf; i < a.length; i++) out.push({ op: '=', text: a[i], a: ++ai, b: ++bi });
  return out;
}

function myers(a: string[], b: string[]): { op: DiffOp; text: string }[] {
  const n = a.length;
  const m = b.length;
  if (!n) return b.map((text) => ({ op: '+', text }));
  if (!m) return a.map((text) => ({ op: '-', text }));

  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // برای برگشت فقط بازه -d..d هر گام نگه داشته می‌شود: حافظه O(D²)
  const trace: Int32Array[] = [];

  let found = -1;
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }

  if (found < 0) {
    return [...a.map((text) => ({ op: '-' as const, text })), ...b.map((text) => ({ op: '+' as const, text }))];
  }

  const ops: { op: DiffOp; text: string }[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d]; // v در ابتدای گام d، یعنی پایان گام d-1؛ اندیس k+d
    const at = (k: number) => prev[k + d];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const pk = down ? k + 1 : k - 1;
    const px = at(pk);
    const py = px - pk;
    while (x > px + (down ? 0 : 1) && y > py + (down ? 1 : 0)) {
      ops.push({ op: '=', text: a[--x] });
      y--;
    }
    if (down) ops.push({ op: '+', text: b[--y] });
    else ops.push({ op: '-', text: a[--x] });
  }
  while (x > 0 && y > 0) {
    ops.push({ op: '=', text: a[--x] });
    y--;
  }
  return ops.reverse();
}

export interface DiffHunk {
  lines: DiffLine[];
  /** تعداد خط بدون تغییری که پیش از این تکه پنهان شده */
  skippedBefore: number;
}

/**
 * فقط تکه‌های تغییرکرده با چند خط اطراف — پیکربندی چند هزار خطی با سه خط
 * تغییر نباید کل صفحه را بگیرد.
 */
export function diffHunks(lines: DiffLine[], context = 3): { hunks: DiffHunk[]; skippedAfter: number } {
  const keep = new Uint8Array(lines.length);
  lines.forEach((l, i) => {
    if (l.op === '=') return;
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep[j] = 1;
  });
  const hunks: DiffHunk[] = [];
  let skipped = 0;
  let cur: DiffHunk | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (!keep[i]) {
      skipped++;
      cur = null;
      continue;
    }
    if (!cur) {
      cur = { lines: [], skippedBefore: skipped };
      hunks.push(cur);
      skipped = 0;
    }
    cur.lines.push(lines[i]);
  }
  return { hunks, skippedAfter: skipped };
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.op === '+') added++;
    else if (l.op === '-') removed++;
  }
  return { added, removed };
}

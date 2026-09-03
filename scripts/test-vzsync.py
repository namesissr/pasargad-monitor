# -*- coding: utf-8 -*-
"""بررسی منطق تصمیم همگام‌سازی ویژالیزور — بدون تماس با پنل واقعی"""
import sys
sys.stdout.reconfigure(encoding="utf-8")

ANCHOR = "77"

def decide(vz_vpsid, locked, panel):
    """بازسازی حلقه lib/vz-sync.ts"""
    free = vz_vpsid in ("0", "")
    on_anchor = vz_vpsid == ANCHOR
    if locked:
        return "skip"
    if not free and not on_anchor:
        return "skip"
    if panel is None:
        return "import" if free else "none"
    if panel["status"] == "released":
        if on_anchor and panel["managed"]:
            return "detach"
        return "none"
    if free and panel["watch"]:
        return "attach"
    return "none"

W = {"status": "blocked", "watch": True, "managed": True}
R = {"status": "released", "watch": True, "managed": True}
RM = {"status": "released", "watch": True, "managed": False}

CASES = [
    ("0",   False, None, "import",  "آزاد و ناشناخته → وارد شود"),
    ("0",   False, W,    "attach",  "آزاد و اکسس‌شده → به لنگر بچسبد"),
    (ANCHOR,False, W,    "none",    "از قبل روی لنگر و اکسس‌شده → بماند"),
    (ANCHOR,False, R,    "detach",  "روی لنگر و آزاد شد → برداشته شود"),
    (ANCHOR,False, RM,   "none",    "آزاد شد ولی پنل نچسبانده → دست نزن"),
    ("99",  False, W,    "skip",    "روی وی‌پی‌اس دیگری → هرگز دست نزن"),
    ("99",  False, None, "skip",    "روی وی‌پی‌اس دیگری و ناشناخته → دست نزن"),
    ("0",   True,  None, "skip",    "قفل‌شده در ویژالیزور → دست نزن"),
    (ANCHOR,True,  R,    "skip",    "قفل‌شده حتی اگر آزاد شده → دست نزن"),
    ("0",   False, {"status":"blocked","watch":False,"managed":False}, "none",
     "آزاد ولی بدون تیک پایش → نچسبان"),
]

bad = 0
for vps, locked, panel, expected, name in CASES:
    got = decide(vps, locked, panel)
    tag = "گذشت" if got == expected else "شکست"
    if got != expected:
        bad += 1
    print("%s  %s → %s" % (tag, name, got))

print("")
print("همه گذشتند" if not bad else "%d شکست" % bad)
sys.exit(1 if bad else 0)

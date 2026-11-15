#!/usr/bin/env python3
"""Take the three token-radar screenshots with Playwright and size them to 300-350 KB JPEG.

Usage: python3 tools/shoot.py <out-dir> <dest-dir>
  out-dir  : a MAKEFUN_OUTPUT_DIR (has dashboard/index.html + data.js + board.json)
  dest-dir : where 1-board.jpg, 2-detail.jpg, 3-filtered.jpg are written
"""
import json
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

TARGET_LO, TARGET_HI = 300 * 1024, 350 * 1024
MAX_BYTES = 512 * 1024


def to_jpeg(png_path: Path, out_path: Path) -> int:
    img = Image.open(png_path).convert("RGB")
    for q in (95, 93, 91, 89, 87, 84, 80, 76, 72, 68, 64, 60):
        img.save(out_path, "JPEG", quality=q, optimize=True)
        n = out_path.stat().st_size
        if TARGET_LO <= n <= TARGET_HI:
            return n
        if n < TARGET_LO:
            # Largest quality already below target: keep the best (first) one.
            if q == 95:
                return n
            continue
    return out_path.stat().st_size


def main() -> int:
    out_dir, dest = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    dest.mkdir(parents=True, exist_ok=True)
    board = json.loads((out_dir / "board.json").read_text())
    top_slug = board["rows"][0]["slug"]
    base = (out_dir / "dashboard" / "index.html").as_uri()
    views = [
        ("1-board.jpg", "", 1440, 900),
        ("2-detail.jpg", f"#p={top_slug}", 1440, 1200),
        ("3-filtered.jpg", "#verdict=FARM", 1440, 900),
    ]
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for name, frag, vw, vh in views:
            # A fresh page per view: navigating the same document to a new hash does not reload it.
            page = browser.new_page(viewport={"width": vw, "height": vh})
            page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.goto(base + frag)
            page.wait_for_timeout(1200)
            rows = page.evaluate("document.querySelectorAll('tbody tr').length")
            dialog_open = page.evaluate("!!document.querySelector('dialog[open]')")
            tmp = dest / (name + ".png")
            page.screenshot(path=str(tmp))
            size = to_jpeg(tmp, dest / name)
            tmp.unlink()
            print(f"{name}: {rows} table rows rendered, dialog_open={dialog_open}, {size // 1024} KB")
            page.close()
        browser.close()
    if errors:
        print("PAGE ERRORS:")
        for e in errors[:10]:
            print("  " + e)
        return 1
    print("no page errors")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Capture showcase screenshots of live sites and real CLI output.

Usage:
    uv run --with playwright --with pillow scripts/capture_screenshots.py [target ...]

Web targets are loaded in headless Chrome. Terminal targets run a real command
locally and render its output as a terminal window. Images are written as WebP
into screenshots/<project>/. Review every image before committing it: this
site is public.
"""

from __future__ import annotations

import html
import io
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SRC = Path.home() / "src"

WEB = {
    "ffmi-calculator": dict(
        url="https://theontho.github.io/ffmi-calculator/",
        out="ffmi-calculator/calculator.webp",
        wait=3000,
    ),
    "dawnbreakers-menu": dict(
        url="https://theontho.github.io/dawnbreakers/",
        out="dawnbreakers/menu.webp",
        wait=8000,
        actions=[("press", "Space"), ("wait", 4000)],
    ),
    "wgsextract-site": dict(
        url="https://wgsextract.github.io/wgsextract-cli/",
        out="wgsextract-cli/docs-site.webp",
        wait=3000,
    ),
    "wgsextract-app-site": dict(
        url="https://wgsextract.github.io/wgsextract-cli/app/",
        out="wgsextract-cli/app-site.webp",
        wait=3000,
    ),
    "pi-browser": dict(
        url="https://portlandiator.github.io/PI_browser/",
        out="pi-browser/reading-room.webp",
        wait=6000,
    ),
    "herdr-site": dict(
        url="https://sheprd.org",
        out="herdr/site.webp",
        wait=3000,
    ),
}

TERMINAL = {
    "amaran-cli": dict(
        cmd=["node", "dist/cli.js", "--help"],
        shown="amaran-cli --help",
        cwd=SRC / "amaran-cli",
        out="amaran-cli/help.webp",
    ),
    "email-sort": dict(
        cmd=["email-sort", "--help"],
        shown="email-sort --help",
        cwd=SRC,
        out="email-sort/help.webp",
    ),
    "reddit-zst-to-parquet": dict(
        cmd=["uv", "run", "--quiet", "--python", "3.12", "reddit-zst-to-parquet", "--help"],
        shown="reddit-zst-to-parquet --help",
        cwd=SRC / "reddit-zst-to-parquet",
        out="reddit-zst-to-parquet/help.webp",
    ),
    "skill-dump": dict(
        cmd=["skill-dump", "--help"],
        shown="skill-dump --help",
        cwd=SRC,
        out="skill-dump/help.webp",
    ),
}

TERMINAL_PAGE = """<!doctype html><html><head><style>
body{{margin:0;padding:32px;background:#0b1020;font:15px/1.45 'SF Mono',Menlo,monospace}}
.win{{background:#11161f;border:1px solid #2a3140;border-radius:12px;overflow:hidden;
box-shadow:0 20px 50px rgba(0,0,0,.5);width:max-content;max-width:1100px}}
.bar{{height:34px;background:#1a2030;display:flex;align-items:center;gap:8px;padding:0 14px}}
.dot{{width:12px;height:12px;border-radius:50%}}
pre{{margin:0;padding:18px 22px 22px;color:#d5dbe6;white-space:pre-wrap}}
.p{{color:#7ee787}} .c{{color:#ffffff;font-weight:600}}
</style></head><body><div class="win" id="w"><div class="bar">
<span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span>
<span class="dot" style="background:#28c840"></span></div>
<pre><span class="p">$</span> <span class="c">{shown}</span>
{output}</pre></div></body></html>"""


def save_webp(png: bytes, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    img = Image.open(io.BytesIO(png)).convert("RGB")
    if img.width > 1600:
        img = img.resize((1600, round(img.height * 1600 / img.width)), Image.LANCZOS)
    img.save(out, "WEBP", quality=82, method=6)
    print(f"wrote {out.relative_to(ROOT)} {img.width}x{img.height}")


def redact(text: str) -> str:
    home = str(Path.home())
    return text.replace(home, "~").replace(os.uname().nodename, "host")


def run_terminal(page, spec: dict) -> None:
    proc = subprocess.run(
        spec["cmd"], cwd=spec["cwd"], capture_output=True, text=True, timeout=120
    )
    if proc.returncode != 0:
        raise RuntimeError(f"{spec['shown']} exited {proc.returncode}: {proc.stderr[-500:]}")
    output = redact((proc.stdout or proc.stderr).rstrip())
    lines = output.splitlines()
    if len(lines) > 45:
        output = "\n".join(lines[:44] + ["…"])
    page.set_viewport_size({"width": 1200, "height": 800})
    page.set_content(
        TERMINAL_PAGE.format(shown=html.escape(spec["shown"]), output=html.escape(output))
    )
    save_webp(page.locator("#w").screenshot(), ROOT / "screenshots" / spec["out"])


def run_web(page, spec: dict) -> None:
    page.set_viewport_size({"width": 1440, "height": 900})
    page.goto(spec["url"], wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(spec.get("wait", 2000))
    for action in spec.get("actions", []):
        kind, *args = action
        if kind == "press":
            page.keyboard.press(args[0])
        elif kind == "click":
            page.mouse.click(*args)
        elif kind == "wait":
            page.wait_for_timeout(args[0])
        elif kind == "js":
            page.evaluate(args[0])
    if spec.get("scroll"):
        page.mouse.wheel(0, spec["scroll"])
        page.wait_for_timeout(1000)
    save_webp(page.screenshot(), ROOT / "screenshots" / spec["out"])


def main(names: list[str]) -> int:
    wanted = names or [*WEB, *TERMINAL]
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(device_scale_factor=2, color_scheme="dark")
        for name in wanted:
            try:
                if name in WEB:
                    run_web(page, WEB[name])
                elif name in TERMINAL:
                    run_terminal(page, TERMINAL[name])
                else:
                    print(f"unknown target {name}", file=sys.stderr)
            except Exception as exc:  # keep going; report at the end
                print(f"FAILED {name}: {exc}", file=sys.stderr)
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""Render the 1200×630 social preview images (Open Graph / Twitter cards).

Usage:
    uv run --with playwright scripts/social_previews.py [site] [may] [nov]

With no arguments all three are rendered. Each card is an HTML template in
scripts/social/ filled from the site's data files and screenshotted in headless
Chrome or Chromium into assets/social/<name>.jpg. Look at the images before
committing them. Exits with status 3 when Playwright or a browser is missing,
so callers (the shootout publisher) can skip gracefully.
"""

from __future__ import annotations

import html
import json
import shutil
import sys
import tempfile
from pathlib import Path
from string import Template

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / "scripts" / "social"
OUT = ROOT / "assets" / "social"
WIDTH, HEIGHT = 1200, 630
MAX_BYTES = 300_000
CARDS = {"site": "site.jpg", "may": "gui-for-cli-may.jpg", "nov": "gui-for-cli-2026-11.jpg"}
SKIP = 3
SITE_MOSAIC = ["wgsextract-cli", "dawnbreakers", "apple-silicon-aligners", "ffmi-calculator", "sheprd", "pi-browser"]


def load(rel: str) -> dict:
    return json.loads((ROOT / rel).read_text())


def score_class(value: float) -> str:
    return f"s{min(5, max(1, round(value)))}"


def tile(src: str, label: str | None = None, score: float | None = None) -> str:
    caption = ""
    if label:
        badge = f'<span class="score {score_class(score)}">{score:g}</span>' if score is not None else ""
        caption = f"<figcaption>{badge}{html.escape(label)}</figcaption>"
    return f'<figure class="sc-tile"><img src="{html.escape(src)}" alt="">{caption}</figure>'


def site_card() -> dict:
    data = load("data/projects.json")
    first = {p["id"]: p["screenshots"][0]["src"] for p in data["projects"] if p.get("screenshots")}
    shots = [first[i] for i in SITE_MOSAIC if i in first]
    shots += [s for s in first.values() if s not in shots]
    return {
        "name": html.escape(data["profile"]["name"]),
        "subtitle": "Genomics tools, games, home-lab automation and local-AI pipelines.",
        "count": len(data["projects"]),
        "tiles": "".join(tile(s) for s in shots[:6]),
    }


def may_card() -> dict:
    surfaces = load("data/gui-for-cli-eval.json")["surfaces"]
    rated = sorted(
        (s for s in surfaces if isinstance(s.get("visual"), int) and s.get("screenshot")),
        key=lambda s: (-s["visual"], s["name"]),
    )
    # An even spread from best to worst, so the grid shows the range of ratings.
    picks = [rated[round(i * (len(rated) - 1) / 8)] for i in range(9)]
    return {
        "mean": "2.55",
        "rated": sum(1 for s in surfaces if s.get("screenshot")),
        "tiles": "".join(tile(s["screenshot"], s["name"], s["visual"]) for s in picks),
    }


def nov_card() -> dict:
    data = load("data/gui-for-cli-shootout-2026-11.json")
    stats = data["stats"]

    def best(t: dict) -> float | None:
        return next((t[k] for k in ("userVisual", "myVisual", "selfVisual") if t.get(k) is not None), None)

    done = sorted(
        (t for t in data["toolkits"] if t["status"] == "done" and t["shots"]),
        key=lambda t: (-(best(t) or 0), t["name"]),
    )
    key, label = next(
        (
            (k, lbl)
            for k, lbl in (
                ("userVisual", "owner rating"),
                ("myVisual", "supervisor visual"),
                ("selfVisual", "self-rated visual"),
            )
            if stats["vsMay"][k]["n"]
        ),
        ("selfVisual", "self-rated visual"),
    )
    compare = stats["vsMay"][key]
    fmt = lambda v: "–" if v is None else f"{v:.1f}"
    count = 12 if len(done) > 9 else 9 if len(done) > 4 else 4
    return {
        "done": stats["done"],
        "total": stats["total"],
        "done_pct": round(100 * stats["done"] / stats["total"], 1),
        "building_pct": round(100 * stats["building"] / stats["total"], 1),
        "now": fmt(compare["newMean"]),
        "now_label": label,
        "may": fmt(compare["mayMean"]),
        "columns": 4 if count == 12 else 3 if count == 9 else 2,
        "tiles": "".join(tile(t["shots"][0]["src"], t["name"], best(t)) for t in done[:count]),
    }


BUILDERS = {"site": site_card, "may": may_card, "nov": nov_card}


def launch(pw, error: type[Exception]):
    """Chrome if installed, else a system Chromium, else Playwright's own build."""
    paths = [p for name in ("chromium", "chromium-browser", "google-chrome") if (p := shutil.which(name))]
    options = [{"channel": "chrome"}, *({"executable_path": p} for p in paths), {}]
    for i, option in enumerate(options):
        try:
            return pw.chromium.launch(headless=True, **option)
        except error:
            if i == len(options) - 1:
                raise
    return None


def render(page, name: str) -> Path:
    body = Template((TEMPLATES / f"{name}.html").read_text()).substitute(BUILDERS[name]())
    body = body.replace("<head>", f'<head><base href="{ROOT.as_uri()}/">', 1)
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as f:
        f.write(body)
    try:
        page.goto(Path(f.name).as_uri(), wait_until="load")
        page.evaluate("document.fonts.ready")
    finally:
        Path(f.name).unlink()
    out = OUT / CARDS[name]
    out.parent.mkdir(parents=True, exist_ok=True)
    for quality in (90, 86, 82, 78, 74, 70):
        image = page.screenshot(type="jpeg", quality=quality)
        if len(image) <= MAX_BYTES:
            break
    out.write_bytes(image)
    print(f"{out.relative_to(ROOT)}: {len(image) // 1024} KB (quality {quality})")
    return out


def main() -> int:
    names = sys.argv[1:] or list(CARDS)
    if unknown := [n for n in names if n not in CARDS]:
        print(f"unknown card {unknown}; choose from {', '.join(CARDS)}", file=sys.stderr)
        return 2
    try:
        from playwright.sync_api import Error, sync_playwright
    except ImportError:
        print("playwright is not installed; skipping social previews", file=sys.stderr)
        return SKIP
    with sync_playwright() as pw:
        try:
            browser = launch(pw, Error)
        except Error as err:
            print(f"no headless browser available ({err}); skipping social previews", file=sys.stderr)
            return SKIP
        page = browser.new_page(viewport={"width": WIDTH, "height": HEIGHT}, color_scheme="dark")
        for name in names:
            render(page, name)
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

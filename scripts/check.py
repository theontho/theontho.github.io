#!/usr/bin/env python3
"""Validate data/projects.json and the screenshots it references."""

from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REQUIRED = ("id", "name", "category", "role", "status", "summary")
SOCIAL_TAGS = (
    "og:type", "og:site_name", "og:url", "og:title", "og:description",
    "og:image", "og:image:width", "og:image:height", "og:image:alt",
    "twitter:card", "twitter:title", "twitter:description", "twitter:image",
)


def main() -> int:
    data = json.loads((ROOT / "data" / "projects.json").read_text())
    errors: list[str] = []
    categories = {c["id"] for c in data["categories"]}
    statuses = set(data["statuses"])
    ids: set[str] = set()
    referenced: set[Path] = set()

    for p in data["projects"]:
        pid = p.get("id", "?")
        for key in REQUIRED:
            if not p.get(key):
                errors.append(f"{pid}: missing {key}")
        if pid in ids:
            errors.append(f"{pid}: duplicate id")
        ids.add(pid)
        if p.get("category") not in categories:
            errors.append(f"{pid}: unknown category {p.get('category')!r}")
        if p.get("status") not in statuses:
            errors.append(f"{pid}: unknown status {p.get('status')!r}")
        if p.get("role") not in ("author", "contributor"):
            errors.append(f"{pid}: role must be author or contributor")
        if p.get("private") or p.get("publish"):
            errors.append(f"{pid}: private projects belong in the local overlay, not the public data")
        for shot in p.get("screenshots", []):
            path = ROOT / shot["src"]
            referenced.add(path.resolve())
            if not shot.get("caption"):
                errors.append(f"{pid}: screenshot {shot['src']} needs a caption")
            if not path.is_file():
                errors.append(f"{pid}: missing screenshot file {shot['src']}")

    eval_path = ROOT / "data" / "gui-for-cli-eval.json"
    if eval_path.exists():
        for surface in json.loads(eval_path.read_text())["surfaces"]:
            if not surface.get("screenshot"):
                continue
            path = ROOT / surface["screenshot"]
            referenced.add(path.resolve())
            if not path.is_file():
                errors.append(f"gui-for-cli-eval: missing screenshot {surface['screenshot']}")

    shootout_path = ROOT / "data" / "gui-for-cli-shootout-2026-11.json"
    if shootout_path.exists():
        for toolkit in json.loads(shootout_path.read_text())["toolkits"]:
            for shot in toolkit.get("shots", []):
                path = ROOT / shot["src"]
                referenced.add(path.resolve())
                if not shot.get("caption"):
                    errors.append(f"shootout-2026-11 {toolkit['id']}: screenshot {shot['src']} needs a caption")
                if path.suffix != ".webp":
                    errors.append(f"shootout-2026-11 {toolkit['id']}: {shot['src']} is not WebP")
                if not path.is_file():
                    errors.append(f"shootout-2026-11 {toolkit['id']}: missing screenshot {shot['src']}")
            may_shot = (toolkit.get("may") or {}).get("screenshot")
            if may_shot:
                path = ROOT / may_shot
                referenced.add(path.resolve())
                if not path.is_file():
                    errors.append(f"shootout-2026-11 {toolkit['id']}: missing May screenshot {may_shot}")

    on_disk = {p.resolve() for p in (ROOT / "screenshots").rglob("*") if p.is_file()}
    for orphan in sorted(on_disk - referenced):
        errors.append(f"unused screenshot {orphan.relative_to(ROOT)}")

    # Social previews (Open Graph / Twitter cards), made by scripts/social_previews.py:
    # every page needs the full set of tags and a card that exists on the site.
    site_url = "https://theontho.github.io/"
    social_used: set[Path] = set()
    meta_re = re.compile(r'<meta (?:property|name)="((?:og|twitter):[a-z:_]+)" content="([^"]*)"')
    for page in sorted(ROOT.rglob("*.html")):
        rel = page.relative_to(ROOT)
        if rel.parts[0] in ("scripts", "node_modules") or rel.parts[0].startswith("."):
            continue
        meta = dict(meta_re.findall(page.read_text()))
        for tag in SOCIAL_TAGS:
            if not meta.get(tag):
                errors.append(f"{rel}: missing <meta> {tag}")
        if meta.get("twitter:card") not in (None, "summary_large_image"):
            errors.append(f"{rel}: twitter:card must be summary_large_image")
        for tag in ("og:url", "og:image", "twitter:image"):
            url = meta.get(tag)
            if url and not url.startswith(site_url):
                errors.append(f"{rel}: {tag} must be an absolute {site_url} URL")
        for tag in ("og:image", "twitter:image"):
            url = meta.get(tag)
            if not url or not url.startswith(site_url):
                continue
            path = (ROOT / url.removeprefix(site_url)).resolve()
            social_used.add(path)
            if not path.is_file():
                errors.append(f"{rel}: {tag} {url} does not exist")
    social_dir = ROOT / "assets" / "social"
    if social_dir.is_dir():
        cards = {p.resolve() for p in social_dir.rglob("*") if p.is_file()}
        for orphan in sorted(cards - social_used):
            errors.append(f"unused social preview {orphan.relative_to(ROOT)}")
        for card in sorted(cards):
            if card.stat().st_size > 300_000:
                errors.append(f"social preview {card.relative_to(ROOT)} is over 300 KB")

    # Share pages: crawlers don't run the front page's JavaScript, so /p/<id>/ carries each
    # project's card (scripts/social_previews.py projects writes them).
    share_dir = ROOT / "p"
    public = {p["id"]: p for p in data["projects"]}
    for pid, p in public.items():
        if p.get("page") and not (ROOT / p["page"]).is_file():
            errors.append(f"{pid}: page {p['page']} does not exist")
        index = share_dir / pid / "index.html"
        if not index.is_file():
            errors.append(f"{pid}: no share page p/{pid}/ (run scripts/social_previews.py projects)")
        elif dict(meta_re.findall(index.read_text())).get("og:title") != html.escape(p["name"], quote=True):
            errors.append(f"{pid}: p/{pid}/ is out of date (run scripts/social_previews.py projects)")
    if share_dir.is_dir():
        for d in sorted(x for x in share_dir.iterdir() if x.is_dir() and x.name not in public):
            errors.append(f"share page {d.relative_to(ROOT)} has no project")

    stats_path = ROOT / "data" / "stats.json"
    if stats_path.exists():
        stats = json.loads(stats_path.read_text()).get("projects", {})
        for missing in sorted(ids - set(stats)):
            errors.append(f"{missing}: no entry in data/stats.json (run scripts/update_stats.py)")

    for e in errors:
        print(f"error: {e}", file=sys.stderr)
    if not errors:
        print(f"ok: {len(ids)} projects, {len(referenced)} screenshots")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())

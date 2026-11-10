#!/usr/bin/env python3
"""Record the newest Apple Silicon aligner prerelease for the aligner report page.

    python3 scripts/update_aligner_release.py

Finds the newest `macos-aligners-*` release of WGSExtract/wgsextract-cli and
stores its tag, URL and date as `release` in data/apple-silicon-aligners.json,
so the page's download buttons and commands never point at an old build. Runs
daily in the stats workflow; writes nothing when the release hasn't changed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from update_stats import get  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "apple-silicon-aligners.json"
REPO = "WGSExtract/wgsextract-cli"
PREFIX = "macos-aligners-"


def newest() -> dict:
    releases = []
    for page in range(1, 6):
        batch = get(f"/repos/{REPO}/releases?per_page=100&page={page}") or []
        releases += [r for r in batch if r["tag_name"].startswith(PREFIX) and not r.get("draft")]
        if len(batch) < 100:
            break
    if not releases:
        raise SystemExit(f"no {PREFIX}* releases found in {REPO}")
    latest = max(releases, key=lambda r: r["published_at"] or "")
    return {"tag": latest["tag_name"], "url": latest["html_url"], "publishedAt": latest["published_at"]}


def main() -> int:
    data = json.loads(DATA.read_text())
    release = newest()
    if data.get("release") == release:
        print(f"release unchanged: {release['tag']}", file=sys.stderr)
        return 0
    # Keep `release` near the top of the file, after the title.
    out = {}
    for key, value in data.items():
        if key != "release":
            out[key] = value
        if key == "title":
            out["release"] = release
    DATA.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"release: {release['tag']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

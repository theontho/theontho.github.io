#!/usr/bin/env python3
"""Build a LOCAL-ONLY copy of the showcase that also includes private projects.

    python3 scripts/build_local.py [--private-dir ~/src/project-showcase-private] [--out DIR]

The private overlay directory holds `projects.json` ({"projects": [...]}, each
entry marked `"private": true`) and its `screenshots/`. The output (default
`<private-dir>/site`) is a complete static site; serve it locally, never
publish it. Nothing is written inside this public repository.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import update_stats  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--private-dir", default="~/src/project-showcase-private")
    parser.add_argument("--out", default=None)
    parser.add_argument("--skip-stats", action="store_true", help="reuse the previous private stats")
    args = parser.parse_args()

    private_dir = Path(args.private_dir).expanduser().resolve()
    out = Path(args.out).expanduser().resolve() if args.out else private_dir / "site"
    if ROOT == out or ROOT in out.parents:
        raise SystemExit("refusing to write the private build inside the public repository")

    public = json.loads((ROOT / "data" / "projects.json").read_text())
    overlay_path = private_dir / "projects.json"
    overlay = json.loads(overlay_path.read_text()) if overlay_path.exists() else {"projects": []}
    private = overlay["projects"]

    ids = {p["id"] for p in public["projects"]}
    categories = {c["id"] for c in public["categories"]}
    errors = []
    for p in private:
        if p["id"] in ids:
            errors.append(f"{p['id']}: id also used by a public project")
        ids.add(p["id"])
        p["private"] = True
        if p.get("category") not in categories:
            errors.append(f"{p['id']}: unknown category {p.get('category')!r}")
        if p.get("status") not in public["statuses"]:
            errors.append(f"{p['id']}: unknown status {p.get('status')!r}")
        for shot in p.get("screenshots", []):
            if not (private_dir / shot["src"]).is_file():
                errors.append(f"{p['id']}: missing {shot['src']}")
    if errors:
        print("\n".join(f"error: {e}" for e in errors), file=sys.stderr)
        return 1

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    shutil.copy2(ROOT / "index.html", out / "index.html")
    shutil.copytree(ROOT / "assets", out / "assets")
    shutil.copytree(ROOT / "screenshots", out / "screenshots")
    if (private_dir / "screenshots").is_dir():
        shutil.copytree(private_dir / "screenshots", out / "screenshots", dirs_exist_ok=True)

    merged = dict(public)
    merged["profile"] = {**public["profile"], "local": True}
    merged["projects"] = public["projects"] + private
    (out / "data").mkdir()
    (out / "data" / "projects.json").write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n")

    public_stats = json.loads((ROOT / "data" / "stats.json").read_text())
    cache = private_dir / "stats.json"
    if args.skip_stats and cache.exists():
        private_stats = json.loads(cache.read_text())["projects"]
    else:
        private_stats = update_stats.collect(private, public["profile"]["handle"], allow_private=True)
        update_stats.write(cache, private_stats)
    stats = {
        "generated_at": public_stats.get("generated_at"),
        "projects": {**public_stats["projects"], **private_stats},
    }
    (out / "data" / "stats.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False) + "\n")

    print(f"built {out} with {len(public['projects'])} public + {len(private)} private projects")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

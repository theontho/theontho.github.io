#!/usr/bin/env python3
"""Validate data/projects.json and the screenshots it references."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REQUIRED = ("id", "name", "category", "repo", "role", "status", "summary")


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
            path = ROOT / surface["screenshot"]
            referenced.add(path.resolve())
            if not path.is_file():
                errors.append(f"gui-for-cli-eval: missing screenshot {surface['screenshot']}")

    on_disk = {p.resolve() for p in (ROOT / "screenshots").rglob("*") if p.is_file()}
    for orphan in sorted(on_disk - referenced):
        errors.append(f"unused screenshot {orphan.relative_to(ROOT)}")

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

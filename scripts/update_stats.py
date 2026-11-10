#!/usr/bin/env python3
"""Refresh data/stats.json from the GitHub API.

Reads every project's `repo` from data/projects.json and records stars,
language, last push, open issues and the latest release. For contributions
(`role: contributor`) it also counts the owner's merged pull requests.

Uses GITHUB_TOKEN when set (GitHub Actions provides one); otherwise it falls
back to `gh auth token`, then to unauthenticated requests.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECTS = ROOT / "data" / "projects.json"
STATS = ROOT / "data" / "stats.json"
API = "https://api.github.com"


def token() -> str | None:
    if os.environ.get("GITHUB_TOKEN"):
        return os.environ["GITHUB_TOKEN"]
    try:
        out = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=10)
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


TOKEN = token()


def get(path: str):
    req = urllib.request.Request(API + path, headers={"Accept": "application/vnd.github+json"})
    if TOKEN:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def repo_stats(repo: str) -> dict:
    data = get(f"/repos/{repo}")
    if data is None:
        raise SystemExit(f"repository not found or not public: {repo}")
    if data.get("private"):
        raise SystemExit(f"refusing to publish stats for a private repository: {repo}")
    stats = {
        "stars": data["stargazers_count"],
        "forks": data["forks_count"],
        "language": data.get("language"),
        "pushed_at": data["pushed_at"],
        "created_at": data["created_at"],
        "open_issues": data["open_issues_count"],
        "archived": data["archived"],
        "url": data["html_url"],
    }
    release = get(f"/repos/{repo}/releases/latest")
    if release:
        stats["release"] = {"tag": release["tag_name"], "published_at": release["published_at"]}
    return stats


def merged_prs(author: str, repo: str) -> int:
    q = urllib.parse.quote(f"repo:{repo} author:{author} is:pr is:merged")
    data = get(f"/search/issues?q={q}&per_page=1")
    return data["total_count"] if data else 0


def main() -> int:
    config = json.loads(PROJECTS.read_text())
    owner = config["profile"]["handle"]
    repos: dict[str, dict] = {}
    for project in config["projects"]:
        stats = repo_stats(project["repo"])
        if project.get("role") == "contributor" and not project["repo"].startswith(owner + "/"):
            stats["merged_prs"] = merged_prs(owner, project["repo"])
        repos[project["id"]] = stats
        print(f"{project['id']}: {stats['stars']}★ pushed {stats['pushed_at'][:10]}", file=sys.stderr)

    previous = json.loads(STATS.read_text()) if STATS.exists() else {}
    if previous.get("projects") == repos:
        print("stats unchanged", file=sys.stderr)
        return 0
    out = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "projects": repos,
    }
    STATS.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {STATS.relative_to(ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

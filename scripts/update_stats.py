#!/usr/bin/env python3
"""Refresh project stats from GitHub (and local git checkouts).

Default (public site): reads data/projects.json, writes data/stats.json, and
refuses private repositories.

For each project with a `repo` it records stars, language, last push, open
issues and the latest release. For contributions (`role: contributor`) it
also lists the owner's merged and open pull requests. Projects with a local
`path` and no `repo` get last-commit and commit-count stats from git.

The local private build (scripts/build_local.py) calls collect() with
allow_private=True.

Uses GITHUB_TOKEN when set (GitHub Actions provides one); otherwise it falls
back to `gh auth token`, then to unauthenticated requests.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
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


def repo_stats(repo: str, allow_private: bool) -> dict:
    data = get(f"/repos/{repo}")
    if data is None:
        raise SystemExit(f"repository not found or not accessible: {repo}")
    if data.get("private") and not allow_private:
        raise SystemExit(f"refusing to publish stats for a private repository: {repo}")
    stats = {
        "stars": data["stargazers_count"],
        "forks": data["forks_count"],
        "language": data.get("language"),
        "pushed_at": data["pushed_at"],
        "created_at": data["created_at"],
        "open_issues": data["open_issues_count"],
        "archived": data["archived"],
        "private": data.get("private", False),
        "url": data["html_url"],
    }
    release = get(f"/repos/{repo}/releases/latest")
    if release:
        stats["release"] = {"tag": release["tag_name"], "published_at": release["published_at"]}
    return stats


def pull_requests(author: str, repo: str) -> list[dict]:
    """The author's merged and open pull requests in `repo`, newest first."""
    q = urllib.parse.quote(f"repo:{repo} author:{author} is:pr")
    prs = []
    page = 1
    while True:
        data = get(f"/search/issues?q={q}&per_page=100&page={page}&sort=created&order=desc")
        items = (data or {}).get("items", [])
        for item in items:
            merged_at = (item.get("pull_request") or {}).get("merged_at")
            state = "merged" if merged_at else item["state"]
            if state == "closed":
                continue
            prs.append({
                "number": item["number"],
                "title": item["title"],
                "url": item["html_url"],
                "state": state,
                "created_at": item["created_at"],
                "merged_at": merged_at,
            })
        if len(items) < 100:
            return prs
        page += 1


def git_stats(path: str) -> dict:
    repo = Path(path).expanduser()

    def git(*args: str) -> str:
        out = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=30)
        return out.stdout.strip() if out.returncode == 0 else ""

    last = git("log", "-1", "--format=%cI")
    if not last:
        return {}
    first = git("log", "--reverse", "--format=%cI", "--max-parents=0").splitlines()
    return {
        "pushed_at": last,
        "created_at": first[0] if first else None,
        "commits": int(git("rev-list", "--count", "HEAD") or 0),
        "local": True,
    }


def collect(projects: list[dict], owner: str, allow_private: bool = False) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for project in projects:
        if project.get("repo"):
            stats = repo_stats(project["repo"], allow_private)
            if project.get("role") == "contributor" and not project["repo"].startswith(owner + "/"):
                prs = pull_requests(owner, project["repo"])
                stats["merged_prs"] = sum(1 for p in prs if p["state"] == "merged")
                stats["open_prs"] = sum(1 for p in prs if p["state"] == "open")
                stats["pull_requests"] = prs
            if project.get("path"):
                stats["commits"] = git_stats(project["path"]).get("commits")
        elif project.get("path"):
            stats = git_stats(project["path"])
        else:
            stats = {}
        out[project["id"]] = stats
        print(f"{project['id']}: {stats.get('stars', '-')}★ updated {str(stats.get('pushed_at', '-'))[:10]}", file=sys.stderr)
    return out


def write(path: Path, projects: dict[str, dict]) -> bool:
    previous = json.loads(path.read_text()) if path.exists() else {}
    if previous.get("projects") == projects:
        print("stats unchanged", file=sys.stderr)
        return False
    out = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "projects": projects,
    }
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {path}", file=sys.stderr)
    return True


def main() -> int:
    config = json.loads(PROJECTS.read_text())
    for project in config["projects"]:
        if project.get("private"):
            raise SystemExit(f"{project['id']}: private projects don't belong in the public data")
    write(STATS, collect(config["projects"], config["profile"]["handle"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

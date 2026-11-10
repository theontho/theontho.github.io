# theontho.github.io

My project showcase: what I've been building, how each project is going, and
screenshots. Live at <https://theontho.github.io/>.

It is a plain static site with no build step. GitHub Pages serves this
repository's `main` branch as is.

## Layout

| Path | What it is |
| --- | --- |
| `index.html`, `assets/` | The page, styles and script |
| `data/projects.json` | **Hand-written** project list: categories, status, progress notes, highlights, links and screenshots |
| `data/stats.json` | **Generated** GitHub stats (stars, last update, releases, merged PRs). Don't edit it by hand |
| `screenshots/<project>/` | WebP screenshots used by the cards, dialogs and gallery |
| `scripts/update_stats.py` | Refreshes `data/stats.json` from the GitHub API |
| `scripts/capture_screenshots.py` | Captures live sites and real CLI output as WebP screenshots |
| `scripts/check.py` | Validates the data and checks every screenshot exists and is used |

A GitHub Action refreshes the stats every day and whenever `data/projects.json` changes.

## Add or update a project

1. Add an entry to `data/projects.json`. `category` must be a category id and
   `status` a key of `statuses`. Use `role: "contributor"` for other people's
   projects (the stats then count your merged PRs there).
2. Put screenshots in `screenshots/<id>/` as WebP, no wider than 1600 px, and
   list them with a caption and a `source` (where the image came from).
3. Run:

   ```sh
   python3 scripts/update_stats.py
   python3 scripts/check.py
   python3 -m http.server 8000   # then open http://localhost:8000
   ```

Only public repositories belong here; `update_stats.py` refuses private ones.
Check every screenshot for personal data before committing it.

## Screenshots

```sh
uv run --with playwright --with pillow scripts/capture_screenshots.py            # everything
uv run --with playwright --with pillow scripts/capture_screenshots.py ffmi-calculator
```

Web targets use the local Google Chrome. Terminal targets run real commands from
the local checkouts in `~/src` and replace the home directory and hostname in
their output.

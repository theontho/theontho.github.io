"use strict";

const FILTERS = ["visibility", "kind", "status", "tech", "has", "publish"];
const state = { category: "all", query: "", view: "projects", project: null,
  visibility: "all", kind: "all", status: "all", tech: "all", has: "all", publish: "all" };
let data, stats, categoryById, galleryList = [], lightboxIndex = 0;

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "style") el.style.cssText = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function timeAgo(iso) {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30.4);
  if (months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

function hue(text) {
  let n = 0;
  for (const c of text) n = (n * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${n} 70% 55%)`;
}

const repoUrl = (p) => (p.repo ? `https://github.com/${p.repo}` : null);
const statsFor = (p) => (p.noStats ? {} : (stats.projects || {})[p.id] || {});

const KINDS = {
  mine: { label: "My projects", test: (p) => p.role === "author" },
  contrib: { label: "Contributions", test: (p) => p.role === "contributor" },
  replaced: { label: "Replaced by a newer project", test: (p) => !!(p.superseded_by || p.superseded_note) },
  current: { label: "Not replaced", test: (p) => !(p.superseded_by || p.superseded_note) },
};
const HAS = {
  screenshots: { label: "Has screenshots", test: (p) => (p.screenshots || []).length > 0 },
  release: { label: "Has releases", test: (p) => !!statsFor(p).release && p.role !== "contributor" },
  prs: { label: "Has my pull requests", test: (p) => (statsFor(p).pull_requests || []).length > 0 },
  live: { label: "Has a live site or download", test: (p) => (p.links || []).some((l) => /play|use it|live|docs site|desktop app|npm|sheprd\.org/i.test(l.label)) },
};

function passesFilters(p, skip) {
  if (skip !== "category" && state.category !== "all" && p.category !== state.category) return false;
  if (state.visibility !== "all" && (state.visibility === "private") !== !!p.private) return false;
  if (state.kind !== "all" && !KINDS[state.kind]?.test(p)) return false;
  if (state.status !== "all" && p.status !== state.status) return false;
  if (state.tech !== "all" && !(p.tech || []).includes(state.tech)) return false;
  if (state.has !== "all" && !HAS[state.has]?.test(p)) return false;
  if (state.publish !== "all" && p.publish?.recommendation !== state.publish) return false;
  return true;
}

function matches(p, skip) {
  if (!passesFilters(p, skip)) return false;
  if (!state.query) return true;
  const hay = [p.name, p.summary, p.progress, p.repo, p.private ? "private" : "public", p.publish?.recommendation,
    ...(p.tech || []), ...(p.highlights || [])].join(" ").toLowerCase();
  return state.query.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function statusBadge(p) {
  const s = data.statuses[p.status] || { label: p.status };
  return h("span", { class: `status status-${p.status}`, title: s.description || "" }, s.label);
}

function thumb(p) {
  const shots = p.screenshots || [];
  if (shots.length) {
    return h("div", { class: "thumb" },
      h("img", { src: shots[0].src, alt: shots[0].caption, loading: "lazy" }),
      shots.length > 1 ? h("span", { class: "shots" }, `${shots.length} screenshots`) : null);
  }
  const lang = (p.tech || [])[0] || "";
  return h("div", { class: "thumb" },
    h("div", { class: "placeholder", style: `--hue:${hue(p.id)}`, "aria-hidden": "true" },
      h("div", {}, h("b", {}, p.name.replace(/\(.*?\)/g, "").split(/[\s-]+/).filter((w) => /^[\p{L}\p{N}]/u.test(w)).map((w) => w[0]).join("").slice(0, 3).toUpperCase()), lang)));
}

function metaRow(p) {
  const s = statsFor(p);
  const items = [];
  if (p.role === "contributor" && s.merged_prs) items.push(`${s.merged_prs} merged PR${s.merged_prs > 1 ? "s" : ""}`);
  if (p.role === "contributor" && s.open_prs) items.push(`${s.open_prs} open PR${s.open_prs > 1 ? "s" : ""}`);
  if (s.stars) items.push(`★ ${s.stars.toLocaleString()}${p.role === "contributor" ? " upstream" : ""}`);
  if (s.local && s.commits) items.push(`${s.commits.toLocaleString()} commits`);
  if (s.release && p.role !== "contributor") items.push(s.release.tag);
  if (s.pushed_at) items.push(`updated ${timeAgo(s.pushed_at)}`);
  return h("div", { class: "meta" }, items.map((t) => h("span", {}, t)));
}

const byId = (id) => data.projects.find((x) => x.id === id);

function replacedLine(p) {
  const next = p.superseded_by && byId(p.superseded_by);
  if (!next && !p.superseded_note) return null;
  return h("p", { class: "replaced" }, "↳ ",
    next ? ["Replaced by ", h("a", { href: `?project=${next.id}`, onclick: (e) => { e.preventDefault(); e.stopPropagation(); openProject(next.id); } }, next.name), next.private ? " (private)" : ""]
      : p.superseded_note);
}

function earlierVersions(p) {
  const older = data.projects.filter((x) => x.superseded_by === p.id);
  if (!older.length) return null;
  return h("div", { class: "earlier" }, h("h3", {}, "Earlier versions"),
    h("ul", {}, older.map((o) => h("li", {},
      h("a", { href: `?project=${o.id}`, onclick: (e) => { e.preventDefault(); openProject(o.id); } }, o.name),
      o.private ? " (private)" : "", `: ${o.summary}`))));
}

function card(p) {
  return h("article", {
    class: "card", tabindex: "0", role: "button", "aria-label": `${p.name}: details`,
    onclick: () => openProject(p.id),
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProject(p.id); } },
  },
  thumb(p),
  h("div", { class: "card-body" },
    h("div", { class: "badges" }, statusBadge(p), p.private ? h("span", { class: "private-badge" }, "Private") : null),
    h("h3", {}, p.name),
    h("p", { class: "summary" }, p.summary),
    p.progress ? h("p", { class: "progress" }, p.progress) : null,
    replacedLine(p),
    h("div", { class: "tags" }, (p.tech || []).map((t) => h("span", { class: "tag" }, t))),
    metaRow(p)));
}

function renderProfile() {
  const prof = data.profile;
  document.getElementById("name").textContent = prof.name;
  document.getElementById("tagline").textContent = prof.tagline;
  document.getElementById("profile-links").replaceChildren(
    ...prof.links.map((l) => h("li", {}, h("a", { href: l.url, rel: "me" }, l.label))));
  const own = data.projects.filter((p) => p.role === "author");
  const shots = data.projects.reduce((n, p) => n + (p.screenshots || []).length, 0);
  const merged = data.projects.reduce((n, p) => n + (statsFor(p).merged_prs || 0), 0);
  const releases = own.filter((p) => statsFor(p).release).length;
  const totals = [
    [own.length, "projects of my own"],
    [data.projects.length - own.length, "projects I contribute to"],
    [merged, "merged upstream PRs"],
    [releases, "with published releases"],
    [shots, "screenshots"],
  ];
  document.getElementById("totals").replaceChildren(
    ...totals.map(([n, label]) => h("div", {}, h("dt", {}, label), h("dd", {}, n))));
  if (prof.local) {
    document.body.classList.add("local-copy");
    document.querySelector(".hero .eyebrow").textContent = "Local copy · includes private projects · do not publish";
    document.title = `${document.title} (local)`;
  }
  if (stats.generated_at) {
    document.getElementById("generated").textContent = ` (last refresh ${new Date(stats.generated_at).toLocaleDateString()})`;
  }
}

function renderChips() {
  const counts = Object.fromEntries(data.categories.map((c) => [c.id, 0]));
  const visible = data.projects.filter((p) => matches(p, "category"));
  visible.forEach((p) => counts[p.category]++);
  const chip = (id, label, count) => h("button", {
    type: "button", class: "chip", "aria-pressed": String(state.category === id),
    onclick: () => { state.category = id; update(); },
  }, label, h("span", { class: "count" }, count));
  document.getElementById("chips").replaceChildren(
    chip("all", "All", visible.length),
    ...data.categories.filter((c) => counts[c.id] || state.category === c.id).map((c) => chip(c.id, c.title, counts[c.id])));
  renderFilters();
  document.querySelectorAll(".view-toggle button").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
}

function renderFilters() {
  const count = (fn) => data.projects.filter(fn).length;
  const select = (key, label, options) => {
    const opts = options.filter(([, , n]) => n > 0 || state[key] !== "all");
    if (opts.length < 2 && state[key] === "all") return null;
    return h("label", { class: "filter" + (state[key] !== "all" ? " active" : "") },
      h("span", {}, label),
      h("select", { onchange: (e) => { state[key] = e.target.value; update(); } },
        h("option", { value: "all" }, "Any"),
        opts.map(([value, text, n]) => h("option", { value, selected: state[key] === value }, `${text} (${n})`))));
  };
  const techCounts = {};
  data.projects.forEach((p) => (p.tech || []).forEach((t) => { techCounts[t] = (techCounts[t] || 0) + 1; }));
  const techs = Object.entries(techCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const recs = [...new Set(data.projects.map((p) => p.publish?.recommendation).filter(Boolean))];
  const controls = [
    select("visibility", "Visibility", [
      ["public", "Public", count((p) => !p.private)], ["private", "Private", count((p) => p.private)]]),
    select("kind", "Type", Object.entries(KINDS).map(([k, v]) => [k, v.label, count(v.test)])),
    select("status", "Status", Object.entries(data.statuses).map(([k, v]) => [k, v.label, count((p) => p.status === k)])),
    select("tech", "Tech", techs.map(([t, n]) => [t, t, n])),
    select("has", "Has", Object.entries(HAS).map(([k, v]) => [k, v.label, count(v.test)])),
    recs.length ? select("publish", "Going public", recs.map((r) => [r, r, count((p) => p.publish?.recommendation === r)])) : null,
  ].filter(Boolean);
  const active = FILTERS.some((k) => state[k] !== "all") || state.category !== "all" || state.query;
  document.getElementById("filters").replaceChildren(...controls, ...[
    active ? h("button", { type: "button", class: "clear", onclick: () => {
      FILTERS.forEach((k) => { state[k] = "all"; });
      state.category = "all"; state.query = ""; document.getElementById("search").value = ""; update();
    } }, "Clear filters") : null].filter(Boolean));
}

function renderFeatured() {
  const el = document.getElementById("featured");
  const show = state.view === "projects" && state.category === "all" && !state.query && FILTERS.every((k) => state[k] === "all");
  el.hidden = !show;
  if (!show) return;
  el.replaceChildren(...data.projects.filter((p) => p.featured).map((p) => {
    const img = (p.screenshots || [])[0];
    return h("article", {
      class: "feature", tabindex: "0", role: "button", "aria-label": `${p.name}: details`,
      style: img ? `background-image:url('${img.src}')` : "",
      onclick: () => openProject(p.id),
      onkeydown: (e) => { if (e.key === "Enter") openProject(p.id); },
    }, h("div", { class: "feature-text" }, statusBadge(p), h("h3", {}, p.name), h("p", {}, p.summary)));
  }));
}

function renderProjects() {
  const root = document.getElementById("projects");
  root.hidden = state.view !== "projects";
  const sections = data.categories.map((c) => {
    const items = data.projects.filter((p) => p.category === c.id && matches(p));
    if (!items.length) return null;
    return h("section", { class: "category", id: `cat-${c.id}` },
      h("h2", {}, c.title), h("p", { class: "section-blurb" }, c.blurb),
      h("div", { class: "grid" }, items.map(card)));
  }).filter(Boolean);
  root.replaceChildren(...sections);
  return sections.length;
}

function renderGallery() {
  const section = document.getElementById("gallery");
  section.hidden = state.view !== "gallery";
  galleryList = data.projects.filter(matches).flatMap((p) =>
    (p.screenshots || []).map((s) => ({ ...s, project: p })));
  document.getElementById("gallery-grid").replaceChildren(...galleryList.map((s, i) =>
    h("figure", { class: "shot", onclick: () => openLightbox(galleryList, i) },
      h("img", { src: s.src, alt: s.caption, loading: "lazy" }),
      h("figcaption", {}, h("b", {}, s.project.name), " · ", s.caption))));
  return galleryList.length;
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.category !== "all") params.set("category", state.category);
  if (state.view !== "projects") params.set("view", state.view);
  if (state.query) params.set("q", state.query);
  FILTERS.forEach((k) => { if (state[k] !== "all") params.set(k, state[k]); });
  if (state.project) params.set("project", state.project);
  const qs = params.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

function update() {
  renderChips();
  renderFeatured();
  const n = state.view === "projects" ? renderProjects() : renderGallery();
  if (state.view === "projects") document.getElementById("gallery").hidden = true;
  else document.getElementById("projects").hidden = true;
  document.getElementById("empty").hidden = n > 0;
  syncUrl();
}

function openProject(id) {
  const p = data.projects.find((x) => x.id === id);
  if (!p) return;
  state.project = id;
  syncUrl();
  const s = statsFor(p);
  const dialog = document.getElementById("project-dialog");
  const statItems = [
    p.role === "contributor" && s.merged_prs ? ["Merged PRs", s.merged_prs] : null,
    s.stars != null ? [p.role === "contributor" ? "Upstream stars" : "Stars", s.stars.toLocaleString()] : null,
    s.language ? ["Language", s.language] : null,
    s.release && p.role !== "contributor" ? ["Latest release", `${s.release.tag} · ${timeAgo(s.release.published_at)}`] : null,
    s.commits ? ["Commits", s.commits.toLocaleString()] : null,
    s.pushed_at ? ["Last update", timeAgo(s.pushed_at)] : null,
    s.created_at && p.role !== "contributor" ? ["Started", new Date(s.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short" })] : null,
  ].filter(Boolean);
  const links = [
    repoUrl(p) ? { label: p.role === "contributor" ? "Upstream repo" : "GitHub repo", url: repoUrl(p) } : null,
    p.fork ? { label: "My fork", url: `https://github.com/${p.fork}` } : null,
    ...(p.links || []),
  ].filter(Boolean).filter((l, i, arr) => arr.findIndex((x) => x.url === l.url) === i);
  const shots = (p.screenshots || []).map((x) => ({ ...x, project: p }));
  document.getElementById("dialog-body").replaceChildren(...[
    h("div", { class: "dialog-head" },
      h("div", {},
        h("span", { class: "category-label" }, categoryById[p.category].title), " ",
        statusBadge(p),
        h("h2", { id: "dialog-title" }, p.name)),
      h("button", { type: "button", class: "close", "aria-label": "Close", onclick: () => dialog.close() }, "×")),
    h("p", { class: "dialog-summary" }, p.summary),
    p.progress ? h("p", { class: "progress" }, h("strong", {}, "How it's going: "), p.progress) : null,
    replacedLine(p),
    h("div", { class: "stat-row" }, statItems.map(([k, v]) => h("div", { class: "stat" }, k, h("b", {}, v)))),
    h("div", { class: "dialog-cols" },
      h("div", {}, h("h3", {}, "Highlights"), h("ul", {}, (p.highlights || []).map((x) => h("li", {}, x)))),
      h("div", {},
        links.length ? h("h3", {}, "Links") : null,
        links.length ? h("ul", { class: "link-list" }, links.map((l) => h("li", {}, h("a", { href: l.url, class: l.primary ? "primary" : null }, l.label)))) : null,
        h("h3", {}, "Built with"), h("div", { class: "tags" }, (p.tech || []).map((t) => h("span", { class: "tag" }, t))))),
    prList(p, s),
    earlierVersions(p),
    p.publish ? h("div", { class: "publish" },
      h("h3", {}, "Going public"),
      h("p", {}, h("strong", {}, p.publish.recommendation), p.publish.effort ? ` · effort ${p.publish.effort}` : "", p.publish.notes ? `. ${p.publish.notes}` : "")) : null,
    shots.length ? h("div", { class: "dialog-shots" }, shots.map((x, i) =>
      h("button", { type: "button", onclick: () => openLightbox(shots, i) },
        h("img", { src: x.src, alt: x.caption, loading: "lazy" }), h("span", {}, x.caption)))) : null,
  ].filter(Boolean));
  if (!dialog.open) dialog.showModal();
}

function prList(p, s) {
  const prs = s.pull_requests || [];
  if (!prs.length) return null;
  const date = (iso) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return h("div", { class: "prs" },
    h("h3", {}, `My pull requests (${prs.length})`),
    h("ul", {}, prs.map((pr) => h("li", {},
      h("span", { class: `pr-state pr-${pr.state}` }, pr.state),
      h("a", { href: pr.url }, pr.title),
      h("span", { class: "pr-date" }, ` #${pr.number} · ${date(pr.merged_at || pr.created_at)}`)))));
}

function openLightbox(list, index) {
  galleryList = list;
  lightboxIndex = index;
  showLightbox();
  const lb = document.getElementById("lightbox");
  if (!lb.open) lb.showModal();
}

function showLightbox() {
  const s = galleryList[lightboxIndex];
  const img = document.getElementById("lightbox-img");
  img.src = s.src;
  img.alt = s.caption;
  document.getElementById("lightbox-caption").replaceChildren(
    h("span", {}, `${s.project.name}: ${s.caption}`),
    h("small", {}, `${s.source || ""} · ${lightboxIndex + 1} of ${galleryList.length}`));
}

function stepLightbox(delta) {
  lightboxIndex = (lightboxIndex + delta + galleryList.length) % galleryList.length;
  showLightbox();
}

function wire() {
  const search = document.getElementById("search");
  search.value = state.query;
  search.addEventListener("input", () => { state.query = search.value.trim(); update(); });
  document.querySelectorAll(".view-toggle button").forEach((b) =>
    b.addEventListener("click", () => { state.view = b.dataset.view; update(); }));
  const dialog = document.getElementById("project-dialog");
  dialog.addEventListener("close", () => { state.project = null; syncUrl(); });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  const lb = document.getElementById("lightbox");
  lb.querySelector(".lb-prev").addEventListener("click", () => stepLightbox(-1));
  lb.querySelector(".lb-next").addEventListener("click", () => stepLightbox(1));
  lb.querySelector(".lb-close").addEventListener("click", () => lb.close());
  lb.addEventListener("click", (e) => { if (e.target === lb || e.target.tagName === "FIGURE") lb.close(); });
  lb.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") stepLightbox(-1);
    if (e.key === "ArrowRight") stepLightbox(1);
  });
}

async function main() {
  const [projects, statsJson] = await Promise.all([
    fetch("data/projects.json").then((r) => r.json()),
    fetch("data/stats.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]);
  data = projects;
  stats = statsJson;
  categoryById = Object.fromEntries(data.categories.map((c) => [c.id, c]));
  const params = new URLSearchParams(location.search);
  if (categoryById[params.get("category")]) state.category = params.get("category");
  if (params.get("view") === "gallery") state.view = "gallery";
  state.query = params.get("q") || "";
  FILTERS.forEach((k) => { if (params.get(k)) state[k] = params.get(k); });
  renderProfile();
  wire();
  update();
  if (params.get("project")) openProject(params.get("project"));
}

main().catch((err) => {
  document.getElementById("projects").replaceChildren(
    h("p", { class: "empty" }, "Could not load the project list. ", String(err)));
});

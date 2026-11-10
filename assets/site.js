"use strict";

const state = { category: "all", query: "", view: "projects", project: null };
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

const repoUrl = (p) => `https://github.com/${p.repo}`;
const statsFor = (p) => (stats.projects || {})[p.id] || {};

function matches(p) {
  if (state.category !== "all" && p.category !== state.category) return false;
  if (!state.query) return true;
  const hay = [p.name, p.summary, p.progress, p.repo, ...(p.tech || []), ...(p.highlights || [])].join(" ").toLowerCase();
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
      h("div", {}, h("b", {}, p.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase()), lang)));
}

function metaRow(p) {
  const s = statsFor(p);
  const items = [];
  if (p.role === "contributor" && s.merged_prs) items.push(`${s.merged_prs} merged PR${s.merged_prs > 1 ? "s" : ""}`);
  if (s.stars) items.push(`★ ${s.stars.toLocaleString()}${p.role === "contributor" ? " upstream" : ""}`);
  if (s.release && p.role !== "contributor") items.push(s.release.tag);
  if (s.pushed_at) items.push(`updated ${timeAgo(s.pushed_at)}`);
  return h("div", { class: "meta" }, items.map((t) => h("span", {}, t)));
}

function card(p) {
  return h("article", {
    class: "card", tabindex: "0", role: "button", "aria-label": `${p.name}: details`,
    onclick: () => openProject(p.id),
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProject(p.id); } },
  },
  thumb(p),
  h("div", { class: "card-body" },
    statusBadge(p),
    h("h3", {}, p.name),
    h("p", { class: "summary" }, p.summary),
    p.progress ? h("p", { class: "progress" }, p.progress) : null,
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
  if (stats.generated_at) {
    document.getElementById("generated").textContent = ` (last refresh ${new Date(stats.generated_at).toLocaleDateString()})`;
  }
}

function renderChips() {
  const counts = Object.fromEntries(data.categories.map((c) => [c.id, 0]));
  data.projects.forEach((p) => counts[p.category]++);
  const chip = (id, label, count) => h("button", {
    type: "button", class: "chip", "aria-pressed": String(state.category === id),
    onclick: () => { state.category = id; update(); },
  }, label, h("span", { class: "count" }, count));
  document.getElementById("chips").replaceChildren(
    chip("all", "All", data.projects.length),
    ...data.categories.filter((c) => counts[c.id]).map((c) => chip(c.id, c.title, counts[c.id])));
  document.querySelectorAll(".view-toggle button").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
}

function renderFeatured() {
  const el = document.getElementById("featured");
  const show = state.view === "projects" && state.category === "all" && !state.query;
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
    s.pushed_at ? ["Last update", timeAgo(s.pushed_at)] : null,
    s.created_at ? ["Started", new Date(s.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short" })] : null,
  ].filter(Boolean);
  const links = [
    { label: p.role === "contributor" ? "Upstream repo" : "GitHub repo", url: repoUrl(p) },
    p.fork ? { label: "My fork", url: `https://github.com/${p.fork}` } : null,
    ...(p.links || []),
  ].filter(Boolean).filter((l, i, arr) => arr.findIndex((x) => x.url === l.url) === i);
  const shots = (p.screenshots || []).map((x) => ({ ...x, project: p }));
  document.getElementById("dialog-body").replaceChildren(
    h("div", { class: "dialog-head" },
      h("div", {},
        h("span", { class: "category-label" }, categoryById[p.category].title), " ",
        statusBadge(p),
        h("h2", { id: "dialog-title" }, p.name)),
      h("button", { type: "button", class: "close", "aria-label": "Close", onclick: () => dialog.close() }, "×")),
    h("p", { class: "dialog-summary" }, p.summary),
    p.progress ? h("p", { class: "progress" }, h("strong", {}, "How it's going: "), p.progress) : null,
    h("div", { class: "stat-row" }, statItems.map(([k, v]) => h("div", { class: "stat" }, k, h("b", {}, v)))),
    h("div", { class: "dialog-cols" },
      h("div", {}, h("h3", {}, "Highlights"), h("ul", {}, (p.highlights || []).map((x) => h("li", {}, x)))),
      h("div", {},
        h("h3", {}, "Links"), h("ul", { class: "link-list" }, links.map((l) => h("li", {}, h("a", { href: l.url }, l.label)))),
        h("h3", {}, "Built with"), h("div", { class: "tags" }, (p.tech || []).map((t) => h("span", { class: "tag" }, t))))),
    shots.length ? h("div", { class: "dialog-shots" }, shots.map((x, i) =>
      h("button", { type: "button", onclick: () => openLightbox(shots, i) },
        h("img", { src: x.src, alt: x.caption, loading: "lazy" }), h("span", {}, x.caption)))) : null);
  if (!dialog.open) dialog.showModal();
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
  renderProfile();
  wire();
  update();
  if (params.get("project")) openProject(params.get("project"));
}

main().catch((err) => {
  document.getElementById("projects").replaceChildren(
    h("p", { class: "empty" }, "Could not load the project list. ", String(err)));
});

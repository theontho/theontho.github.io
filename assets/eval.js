"use strict";

const BASE = "../";
let data, rows = [], shots = [], lbIndex = 0;
const sort = { key: "visual", dir: -1 };
const filters = { kind: "all", visual: "all" };

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const visualValue = (s) => (s.visual === "ref" ? 6 : s.visual);
const fmtMs = (ms) => (ms == null ? "" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`);
const fmtMb = (mb) => (mb == null ? "" : mb < 1 ? `${Math.round(mb * 1024)} KB` : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`);

function score(value, max = 5, cls = "") {
  if (value === "ref") return h("span", { class: "score ref", title: "Reference implementation" }, "Ref");
  if (value == null) return h("span", { class: "score none" }, "–");
  return h("span", { class: `score s${value} ${cls}`, title: `${value} of ${max}` }, String(value));
}

function sortValue(s, key) {
  switch (key) {
    case "visual": return visualValue(s);
    case "readyMs": case "rssMb": case "artifactMb": return s.macos?.[key] ?? null;
    default: return s[key] ?? null;
  }
}

function renderTable() {
  const tbody = document.querySelector("#eval-table tbody");
  rows = data.surfaces.filter((s) =>
    (filters.kind === "all" || s.kind === filters.kind) &&
    (filters.visual === "all" || String(s.visual) === filters.visual));
  rows.sort((a, b) => {
    const va = sortValue(a, sort.key), vb = sortValue(b, sort.key);
    if (va == null && vb == null) return a.name.localeCompare(b.name);
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return cmp * sort.dir || a.name.localeCompare(b.name);
  });
  tbody.replaceChildren(...rows.map((s) => h("tr", {
    tabindex: "0",
    onclick: () => openShot(shots.findIndex((x) => x.id === s.id)),
    onkeydown: (e) => { if (e.key === "Enter") openShot(shots.findIndex((x) => x.id === s.id)); },
  },
  h("td", {}, h("div", { class: "tk" },
    h("img", { src: BASE + s.screenshot, alt: "", loading: "lazy" }),
    h("span", {}, h("b", {}, s.name), h("small", {}, `${s.language} · ${s.kind}`)))),
  h("td", { class: "num" }, score(s.visual)),
  h("td", { class: "num" }, score(s.completeness)),
  h("td", { class: "num" }, s.batch && s.difficulty == null ? h("span", { class: "score none", title: "Built in the parallel renderer batch" }, "batch") : score(s.difficulty, 5, "diff")),
  h("td", { class: "num" }, s.activeHours ?? ""),
  h("td", { class: "num", title: s.macos?.metric || "" }, fmtMs(s.macos?.readyMs), s.macos ? h("small", {}, s.macos.metric) : null),
  h("td", { class: "num" }, s.macos ? `${Math.round(s.macos.rssMb)} MB` : ""),
  h("td", { class: "num" }, fmtMb(s.macos?.artifactMb)),
  h("td", { class: "verdict" }, s.verdict))));
  document.getElementById("eval-count").textContent = `${rows.length} of ${data.surfaces.length}`;
  document.querySelectorAll("#eval-table th[data-sort]").forEach((th) => {
    th.setAttribute("aria-sort", th.dataset.sort === sort.key ? (sort.dir < 0 ? "descending" : "ascending") : "none");
  });
}

function renderGallery() {
  shots = [...data.surfaces].sort((a, b) => visualValue(b) - visualValue(a) || a.name.localeCompare(b.name));
  document.getElementById("eval-gallery").replaceChildren(...shots.map((s, i) =>
    h("figure", { class: "shot", onclick: () => openShot(i) },
      h("img", { src: BASE + s.screenshot, alt: `${s.name} screenshot`, loading: "lazy" }),
      h("figcaption", {}, score(s.visual), " ", h("b", {}, s.name), ` · ${s.language}`))));
}

function openShot(i) {
  if (i < 0) return;
  lbIndex = i;
  const s = shots[i];
  const img = document.getElementById("lightbox-img");
  img.src = BASE + s.screenshot;
  img.alt = `${s.name} screenshot`;
  document.getElementById("lightbox-caption").replaceChildren(
    h("span", {}, `${s.name} (${s.language}): visual ${s.visual === "ref" ? "reference" : `${s.visual}/5`}`),
    h("small", {}, `${s.verdict} · ${i + 1} of ${shots.length}`));
  const lb = document.getElementById("lightbox");
  if (!lb.open) lb.showModal();
}

function renderStatic() {
  document.getElementById("era").replaceChildren(
    h("div", {}, h("dt", {}, "When"), h("dd", {}, data.period)),
    h("div", {}, h("dt", {}, "Models"), h("dd", {}, data.models)),
    h("div", {}, h("dt", {}, "Code"), h("dd", {}, h("a", { href: data.branch }, "old-experimental branch"))));
  const totals = [
    [data.surfaces.length, "screenshots rated"],
    [29, "comparable experimental surfaces"],
    ["2.55", "average visual score (of 5)"],
    [data.surfaces.filter((s) => s.macos).length, "benchmarked on macOS"],
    [2, "kept as products"],
  ];
  document.getElementById("eval-totals").replaceChildren(
    ...totals.map(([n, l]) => h("div", {}, h("dt", {}, l), h("dd", {}, n))));
  document.querySelector("#windows-table tbody").replaceChildren(...data.windows.map((w) =>
    h("tr", {}, h("td", {}, w.name), h("td", { class: "num" }, fmtMs(w.readyMs)), h("td", {}, w.metric), h("td", {}, w.memory), h("td", {}, w.size))));
  document.getElementById("eval-links").replaceChildren(
    ...data.links.map((l) => h("li", {}, h("a", { href: l.url }, l.label))));
  const kinds = [...new Set(data.surfaces.map((s) => s.kind))].sort();
  document.getElementById("kind-filter").append(...kinds.map((k) => h("option", { value: k }, k)));
}

function wire() {
  document.querySelectorAll("#eval-table th[data-sort]").forEach((th) => {
    th.tabIndex = 0;
    const go = () => {
      const key = th.dataset.sort;
      if (sort.key === key) sort.dir *= -1;
      else { sort.key = key; sort.dir = ["name", "kind", "readyMs", "rssMb", "artifactMb", "difficulty", "activeHours"].includes(key) ? 1 : -1; }
      renderTable();
    };
    th.addEventListener("click", go);
    th.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  });
  document.getElementById("kind-filter").addEventListener("change", (e) => { filters.kind = e.target.value; renderTable(); });
  document.getElementById("visual-filter").addEventListener("change", (e) => { filters.visual = e.target.value; renderTable(); });
  const lb = document.getElementById("lightbox");
  const step = (d) => openShot((lbIndex + d + shots.length) % shots.length);
  lb.querySelector(".lb-prev").addEventListener("click", () => step(-1));
  lb.querySelector(".lb-next").addEventListener("click", () => step(1));
  lb.querySelector(".lb-close").addEventListener("click", () => lb.close());
  lb.addEventListener("click", (e) => { if (e.target === lb || e.target.tagName === "FIGURE") lb.close(); });
  lb.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight") step(1); });
}

fetch(BASE + "data/gui-for-cli-eval.json").then((r) => r.json()).then((json) => {
  data = json;
  renderStatic();
  renderGallery();
  wire();
  renderTable();
}).catch((err) => {
  document.querySelector("main").prepend(h("p", { class: "empty" }, "Could not load the evaluation data. ", String(err)));
});

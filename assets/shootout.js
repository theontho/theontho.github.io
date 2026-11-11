"use strict";

const BASE = "../../";
const DATA_URL = BASE + "data/gui-for-cli-shootout-2026-11.json";
const REFRESH_MS = 60_000;
const STATUS_LABEL = { done: "Done", building: "Building", queued: "Queued", failed: "Failed", reference: "Reference" };
const STATUS_RANK = { reference: 0, done: 1, building: 2, queued: 3, failed: 4 };
const FEATURE_LABEL = { ok: "done", partial: "partial", no: "missing" };
const SOURCE_LABEL = { userVisual: "owner rating", myVisual: "supervisor rating", selfVisual: "self-rating" };
const ASCENDING = ["order", "name", "language", "status", "difficulty", "activeHours", "readyMs", "rssMb", "sizeMb", "windows"];

let data = null;
const sort = { key: "order", dir: 1 };
const filters = { kind: "all", status: "all" };
const expanded = new Set();
const lb = { list: [], index: 0 };
// Offer the slider only when both screenshots have (nearly) the same framing.
const SLIDER_TOLERANCE = 0.04;
const prefs = { slider: false };

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

const dash = () => h("span", { class: "missing", title: "Not available yet" }, "–");
const fmtMs = (ms) => (ms == null ? null : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);
const fmtMb = (mb) => (mb == null ? null : mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`);
const fmtNum = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const or = (value) => value ?? dash();

function bestRating(t) {
  for (const key of ["userVisual", "myVisual", "selfVisual"]) if (t[key] != null) return { value: t[key], key };
  return null;
}

function score(value, cls = "") {
  if (value === "failed") return h("span", { class: "score failed", title: "Never launched into the app" }, "No UI");
  if (value == null) return dash();
  return h("span", { class: `score s${Math.min(5, Math.max(1, Math.round(value)))} ${cls}`.trim(), title: `${fmtNum(value)} of 5` }, fmtNum(value));
}

function statusBadge(status) {
  return h("span", { class: `status status-${status}` }, STATUS_LABEL[status] || status);
}

function delta(t) {
  const best = bestRating(t);
  if (t.mayVisual == null || !best) return null;
  if (t.mayVisual === "failed") {
    return h("span", { class: `delta up${best.key === "selfVisual" ? " provisional" : ""}`, title: `May never showed a UI; now ${fmtNum(best.value)} (${SOURCE_LABEL[best.key]})` }, "↑");
  }
  const d = best.value - t.mayVisual;
  const arrow = d > 0 ? "↑" : d < 0 ? "↓" : "=";
  const text = d === 0 ? "=" : `${arrow}${fmtNum(Math.abs(d))}`;
  return h("span", {
    class: `delta ${d > 0 ? "up" : d < 0 ? "down" : "same"}${best.key === "selfVisual" ? " provisional" : ""}`,
    title: `${d > 0 ? "+" : ""}${fmtNum(d)} vs the ${SOURCE_LABEL[best.key]}`,
  }, text);
}

const mayNumber = (t) => (t.mayVisual === "failed" ? 0 : t.mayVisual);

function sortValue(t, key) {
  switch (key) {
    case "mayVisual": return t.mayVisual == null ? null : mayNumber(t);
    case "order": return t._order;
    case "status": return STATUS_RANK[t.status] ?? 9;
    case "readyMs": case "rssMb": case "sizeMb": return t.linux?.[key] ?? null;
    case "windows": return t.windows?.readyMs ?? null;
    default: return t[key] ?? null;
  }
}

function filtered() {
  return data.toolkits.filter((t) =>
    (filters.kind === "all" || t.kind === filters.kind) &&
    (filters.status === "all" || t.status === filters.status || (t.status === "reference" && filters.status === "done")));
}

function ordered(rows) {
  const compare = (a, b) => {
    const va = sortValue(a, sort.key), vb = sortValue(b, sort.key);
    if (va == null && vb == null) return a._order - b._order;
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return cmp * sort.dir || a._order - b._order;
  };
  const ref = rows.filter((t) => t.status === "reference");
  return [...ref, ...rows.filter((t) => t.status !== "reference").sort(compare)];
}

function shotList(t) {
  return t.shots.map((s, i) => ({
    src: s.src,
    title: t.name,
    caption: s.caption,
    meta: `${t.language} · ${i + 1} of ${t.shots.length}`,
  }));
}

function compareItem(t) {
  return { compare: t, title: t.name, caption: "May 2026 → November 2026", meta: `${t.language} · before and after` };
}

function lightboxList(t) {
  return [...shotList(t), ...(t.may ? [compareItem(t)] : [])];
}

function afterShot(t) {
  return t.status === "done" ? t.shots[0] ?? null : null;
}

function compareLabels(t) {
  const best = bestRating(t);
  const may = t.may.visual === "failed" ? "no UI" : typeof t.may.visual === "number" ? `visual ${t.may.visual}/5` : "not rated";
  const after = !afterShot(t) ? (t.status === "queued" ? "not started" : "in progress")
    : best ? `${SOURCE_LABEL[best.key]} ${fmtNum(best.value)}/5` : "not rated yet";
  return { before: `May 2026 · ${may}${t.may.note ? ` (${t.may.note})` : ""}`, after: `November 2026 · ${after}` };
}

function comparePane(src, alt, label, empty) {
  return h("figure", { class: "cmp-side" },
    src ? h("img", { src: BASE + src, alt, loading: "lazy" }) : h("div", { class: "cmp-empty" }, empty),
    h("figcaption", {}, label));
}

function sliderView(t, before, after, labels, ratio) {
  const wrap = h("div", { class: "cmp-slider", style: `--pos: 50%; --ratio: ${ratio}` },
    h("img", { class: "cmp-after", src: BASE + after.src, alt: `${t.name}, November 2026 build: ${after.caption}` }),
    h("img", { class: "cmp-before", src: BASE + before, alt: `${t.name}, May 2026 build` }),
    h("span", { class: "cmp-tag cmp-tag-before", "aria-hidden": "true" }, labels.before),
    h("span", { class: "cmp-tag cmp-tag-after", "aria-hidden": "true" }, labels.after),
    h("span", { class: "cmp-handle", "aria-hidden": "true" }));
  wrap.append(h("input", {
    type: "range", min: "0", max: "100", value: "50", class: "cmp-range",
    "aria-label": `Compare ${t.name}: May 2026 on the left of the divider, November 2026 on the right`,
    oninput: (e) => wrap.style.setProperty("--pos", `${e.target.value}%`),
    onkeydown: (e) => e.stopPropagation(),
    onclick: (e) => e.stopPropagation(),
  }));
  return wrap;
}

function loaded(img) {
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    img.addEventListener("load", resolve, { once: true });
    img.addEventListener("error", resolve, { once: true });
  });
}

// May 2026 next to November 2026, plus a slider when both are framed alike.
function compareView(t, lightbox = false) {
  const before = t.may?.screenshot ?? null;
  const after = afterShot(t);
  const labels = compareLabels(t);
  const empty = !after ? (t.status === "queued" ? "After: not started" : "After: in progress") : null;
  const pair = h("div", { class: "cmp-pair" },
    comparePane(before, `${t.name}, May 2026 build`, labels.before, "May: no UI"),
    comparePane(after?.src, after && `${t.name}, November 2026 build: ${after.caption}`, labels.after, empty));
  const root = h("div", { class: `cmp${lightbox ? " cmp-lb" : ""}`, role: "group", "aria-label": `${t.name}: May 2026 and November 2026` }, pair);
  if (!before || !after) return root;
  const imgs = [...pair.querySelectorAll("img")];
  Promise.all(imgs.map(loaded)).then(() => {
    const [a, b] = imgs.map((img) => img.naturalWidth / img.naturalHeight);
    if (!a || !b || Math.abs(a - b) / b > SLIDER_TOLERANCE) return;
    const slider = sliderView(t, before, after, labels, b);
    const buttons = {};
    const show = (useSlider) => {
      prefs.slider = useSlider;
      pair.hidden = useSlider;
      slider.hidden = !useSlider;
      buttons.side.setAttribute("aria-pressed", String(!useSlider));
      buttons.slider.setAttribute("aria-pressed", String(useSlider));
    };
    buttons.side = h("button", { type: "button", onclick: (e) => { e.stopPropagation(); show(false); } }, "Side by side");
    buttons.slider = h("button", { type: "button", onclick: (e) => { e.stopPropagation(); show(true); } }, "Slider");
    root.prepend(h("div", { class: "cmp-modes", role: "group", "aria-label": "Comparison view" }, buttons.side, buttons.slider));
    root.append(slider);
    show(prefs.slider);
  });
  return root;
}

function windowsFacts(w) {
  return [
    w.readyMs != null && `ready ${fmtMs(w.readyMs)}`,
    w.rssMb != null && `${fmtMb(w.rssMb)} working set`,
    w.sizeMb != null && `${fmtMb(w.sizeMb)} on disk`,
  ].filter(Boolean).join(", ");
}

function windowsCell(w) {
  if (!w?.status) return dash();
  const facts = windowsFacts(w);
  return h("span", { class: "win-cell", title: [facts, w.notes].filter(Boolean).join(". ") || null },
    statusBadge(w.status), w.readyMs != null ? h("small", {}, fmtMs(w.readyMs)) : null,
    w.rssMb != null ? h("small", {}, fmtMb(w.rssMb)) : null);
}

function detailRow(t) {
  const facts = [];
  if (t.summary) facts.push(h("p", {}, t.summary));
  if (t.lessons) facts.push(h("p", { class: "muted" }, h("b", {}, "Lessons: "), t.lessons));
  if (t.myNotes) facts.push(h("p", {}, h("b", {}, "Supervisor: "), t.myNotes));
  if (t.userNotes) facts.push(h("p", {}, h("b", {}, "Owner: "), t.userNotes));
  const build = [t.linux?.build && `Build: ${t.linux.build}.`, t.linux?.note].filter(Boolean).join(" ");
  if (build) facts.push(h("p", { class: "muted" }, build));
  const win = [t.windows?.status && t.windows.status !== "done" ? STATUS_LABEL[t.windows.status] : null,
    t.windows && windowsFacts(t.windows), t.windows?.notes].filter(Boolean);
  if (win.length) facts.push(h("p", { class: "muted" }, h("b", {}, "Windows: "), win.join(". ").replace(/\.\./g, ".")));
  if (!facts.length) facts.push(h("p", { class: "muted" }, t.status === "building" ? "Being built now." : t.status === "queued" ? "Not started yet." : "No details yet."));
  const features = t.features ? h("ul", { class: "features", "aria-label": "Feature checklist" },
    data.features.map((label, i) => h("li", { class: `feat feat-${t.features[i]}`, title: `${label}: ${FEATURE_LABEL[t.features[i]]}` },
      h("span", { class: "dot", "aria-hidden": "true" }), h("span", {}, label),
      h("span", { class: "visually-hidden" }, `: ${FEATURE_LABEL[t.features[i]]}`)))) : null;
  return h("tr", { class: "detail", id: `detail-${t.id}` },
    h("td", { colspan: "14" }, h("div", { class: "detail-body" }, features, h("div", { class: "detail-text" }, facts),
      t.may ? compareView(t) : null)));
}

function renderTable() {
  const rows = ordered(filtered());
  const body = [];
  for (const t of rows) {
    const main = t.shots[0];
    const list = lightboxList(t);
    const open = list.length ? () => openLightbox(lightboxList(t), 0) : null;
    const isOpen = expanded.has(t.id);
    body.push(h("tr", {
      class: [`row-${t.status}`, open ? "" : "no-shot"].join(" ").trim(),
      tabindex: open ? "0" : null,
      onclick: open,
      onkeydown: open ? (e) => { if (e.key === "Enter" && e.target === e.currentTarget) open(); } : null,
    },
    h("td", {}, h("div", { class: "tk" },
      h("button", {
        type: "button", class: "expand", "aria-expanded": String(isOpen), "aria-controls": `detail-${t.id}`,
        "aria-label": `${isOpen ? "Hide" : "Show"} details for ${t.name}`,
        onclick: (e) => {
          e.stopPropagation();
          isOpen ? expanded.delete(t.id) : expanded.add(t.id);
          renderTable();
          document.querySelector(`#shootout-table .expand[aria-controls="detail-${t.id}"]`)?.focus();
        },
      }, isOpen ? "▾" : "▸"),
      main ? h("img", { src: BASE + main.src, alt: "", loading: "lazy" }) : h("span", { class: `no-thumb thumb-${t.status}`, "aria-hidden": "true" }, STATUS_LABEL[t.status]),
      h("span", {}, h("b", {}, t.name), h("small", {}, t.kind)))),
    h("td", {}, t.language),
    h("td", {}, statusBadge(t.status)),
    h("td", { class: "num" }, score(t.myVisual)),
    h("td", { class: "num" }, score(t.userVisual)),
    h("td", { class: "num may" }, score(t.mayVisual), delta(t)),
    h("td", { class: "num" }, score(t.selfVisual)),
    h("td", { class: "num" }, score(t.completeness)),
    h("td", { class: "num" }, score(t.difficulty, "diff")),
    h("td", { class: "num" }, or(t.activeHours != null ? fmtNum(t.activeHours) : null)),
    h("td", { class: "num", title: t.linux?.note || null }, or(fmtMs(t.linux?.readyMs))),
    h("td", { class: "num" }, or(fmtMb(t.linux?.rssMb))),
    h("td", { class: "num", title: t.linux?.build || null }, or(fmtMb(t.linux?.sizeMb))),
    h("td", {}, windowsCell(t.windows))));
    if (isOpen) body.push(detailRow(t));
  }
  document.querySelector("#shootout-table tbody").replaceChildren(...body);
  const real = rows.filter((t) => t.status !== "reference").length;
  document.getElementById("eval-count").textContent = `${real} of ${data.stats.total} toolkits`;
  document.querySelectorAll("#shootout-table th[data-sort]").forEach((th) => {
    th.setAttribute("aria-sort", th.dataset.sort === sort.key ? (sort.dir < 0 ? "descending" : "ascending") : "none");
  });
}

function renderGallery() {
  const ref = data.toolkits.filter((t) => t.status === "reference" && t.shots.length);
  const rated = data.toolkits.filter((t) => t.status !== "reference" && t.shots.length)
    .sort((a, b) => (bestRating(b)?.value ?? 0) - (bestRating(a)?.value ?? 0) || a.name.localeCompare(b.name));
  document.getElementById("gallery").replaceChildren(...[...ref, ...rated].map((t) => {
    const best = bestRating(t);
    return h("figure", { class: "shot" },
      h("button", { type: "button", class: "shot-open", onclick: () => openLightbox(lightboxList(t), 0), "aria-label": `Open ${t.name} screenshots` },
        h("img", { src: BASE + t.shots[0].src, alt: `${t.name}: ${t.shots[0].caption}`, loading: "lazy" })),
      h("figcaption", {},
        t.status === "reference" ? h("span", { class: "score ref" }, "Ref") : best ? score(best.value, best.key === "selfVisual" ? "provisional" : "") : dash(),
        " ", h("b", {}, t.name), ` · ${t.language}`,
        best && t.status !== "reference" ? h("small", {}, ` ${SOURCE_LABEL[best.key]}`) : null));
  }));
}

function renderBeforeAfter() {
  const gain = (t) => {
    const best = bestRating(t);
    return afterShot(t) && best ? best.value - (t.may.visual === "failed" ? 0 : t.may.visual ?? 0) : null;
  };
  const cards = data.toolkits.filter((t) => t.may)
    .sort((a, b) => (gain(b) ?? -99) - (gain(a) ?? -99) || a.name.localeCompare(b.name));
  document.getElementById("before-after").replaceChildren(...cards.map((t) => {
    const after = afterShot(t);
    const best = bestRating(t);
    const thumb = (src, alt, empty) => (src ? h("img", { src: BASE + src, alt, loading: "lazy" }) : h("span", { class: "ba-empty" }, empty));
    const g = gain(t);
    return h("figure", { class: "ba-card" },
      h("button", { type: "button", class: "ba-open", onclick: () => openLightbox([compareItem(t)], 0), "aria-label": `Compare ${t.name}: May 2026 and November 2026` },
        h("span", { class: "ba-pair" },
          thumb(t.may.screenshot, `${t.name}, May 2026`, "May: no UI"),
          h("span", { class: "ba-arrow", "aria-hidden": "true" }, "→"),
          thumb(after?.src, after && `${t.name}, November 2026`, t.status === "queued" ? "After: not started" : "After: in progress"))),
      h("figcaption", {},
        h("b", {}, t.name),
        h("span", { class: "ba-scores" },
          score(t.may.visual ?? null), h("span", { "aria-hidden": "true" }, " → "),
          after && best ? score(best.value, best.key === "selfVisual" ? "provisional" : "") : h("span", { class: "missing" }, "in progress"),
          g != null ? h("span", { class: `delta ${g > 0 ? "up" : g < 0 ? "down" : "same"}` }, g > 0 ? `+${fmtNum(g)}` : g < 0 ? fmtNum(g) : "=") : null),
        after && best && best.key !== "myVisual" ? h("small", {}, SOURCE_LABEL[best.key]) : null,
        t.may.note ? h("small", {}, t.may.note) : null));
  }));
}

function renderVsMay() {
  const s = data.stats.vsMay;
  const cards = ["userVisual", "myVisual", "selfVisual"].map((key) => {
    const c = s[key];
    const label = { userVisual: "Owner rating", myVisual: "Supervisor rating", selfVisual: "Self-rating (provisional)" }[key];
    if (!c.n) return h("div", { class: "vs-card pending" }, h("h3", {}, label), h("p", {}, "Not rated yet."));
    return h("div", { class: "vs-card" }, h("h3", {}, label),
      h("p", { class: "vs-big" }, h("b", {}, fmtNum(c.newMean)), h("span", {}, " now vs "), h("b", {}, fmtNum(c.mayMean)), h("span", {}, " in May")),
      h("p", {}, `${c.n} toolkits: ${c.better} better, ${c.same} the same, ${c.worse} worse.`));
  });
  const rows = data.toolkits.filter((t) => t.mayVisual != null && bestRating(t))
    .sort((a, b) => (bestRating(b).value - mayNumber(b)) - (bestRating(a).value - mayNumber(a)) || a.name.localeCompare(b.name));
  const table = rows.length ? h("div", { class: "table-scroll" }, h("table", { class: "eval-table small-table" },
    h("thead", {}, h("tr", {}, h("th", {}, "Toolkit"), h("th", { class: "num" }, "May"), h("th", { class: "num" }, "Now"), h("th", {}, "Based on"), h("th", { class: "num" }, "Change"))),
    h("tbody", {}, rows.map((t) => {
      const best = bestRating(t);
      return h("tr", { class: "static" }, h("td", {}, t.name), h("td", { class: "num" }, score(t.mayVisual)),
        h("td", { class: "num" }, score(best.value)), h("td", {}, SOURCE_LABEL[best.key]), h("td", { class: "num" }, delta(t)));
    })))) : h("p", { class: "empty" }, "No finished toolkits with a May rating yet.");
  const newKits = data.toolkits.filter((t) => t.status !== "reference" && t.mayVisual == null).map((t) => t.name);
  // Toolkits whose May build never showed a UI but whose November build does.
  const revived = data.toolkits.filter((t) => t.mayVisual === "failed" && afterShot(t)).map((t) => {
    const best = bestRating(t);
    return h("p", { class: "vs-revived" }, h("b", {}, `${t.name} launches this time.`),
      ` In May it never showed its UI; now it runs the app${best ? `, rated ${fmtNum(best.value)}/5 (${SOURCE_LABEL[best.key]})` : ""}.`);
  });
  document.getElementById("vs-may").replaceChildren(...revived, h("div", { class: "vs-cards" }, cards), table,
    newKits.length ? h("p", { class: "footnote" }, `New since May, so not compared: ${newKits.join(", ")}. May's ratings were for macOS builds; May's Dioxus entry was a WebUI shell, while this run uses native Dioxus rendering.`) : null);
}

function renderHeader() {
  const s = data.stats;
  document.getElementById("era").replaceChildren(
    h("div", {}, h("dt", {}, "When"), h("dd", {}, `${data.period} (the first run was 7–26 May 2026)`)),
    h("div", {}, h("dt", {}, "Model"), h("dd", {}, data.model)),
    h("div", {}, h("dt", {}, "Targets"), h("dd", {}, "Linux desktop (X11 under Xvfb, 1280×800), then Windows on an Azure VM")));
  const bar = document.getElementById("progress-bar");
  bar.setAttribute("aria-valuemax", s.total);
  bar.setAttribute("aria-valuenow", s.done);
  bar.setAttribute("aria-valuetext", `${s.done} of ${s.total} done`);
  bar.querySelector(".run-progress-done").style.width = `${(100 * s.done) / s.total}%`;
  bar.querySelector(".run-progress-building").style.width = `${(100 * s.building) / s.total}%`;
  const win = data.toolkits.filter((t) => t.windows?.status);
  const winDone = win.filter((t) => t.windows.status === "done").length;
  const winBuilding = win.filter((t) => t.windows.status === "building").length;
  const windows = win.length
    ? ` · Windows: ${winDone} done${winBuilding ? `, ${winBuilding} building${data.windowsNote ? ` (${data.windowsNote})` : ""}` : ""}`
    : "";
  document.getElementById("progress-label").textContent = s.done === s.total
    ? `All ${s.total} Linux builds done${windows}`
    : `${s.done} of ${s.total} done · ${s.building} building · ${s.queued} queued${s.failed ? ` · ${s.failed} failed` : ""}${windows}`;
  const mean = (v) => (v == null ? "–" : fmtNum(v));
  document.getElementById("totals").replaceChildren(...[
    [`${s.done}/${s.total}`, "toolkits done"],
    [mean(s.meanSelfVisual), "mean self-rated visual"],
    [mean(s.meanMyVisual), "mean supervisor rating"],
    [mean(s.meanUserVisual), "mean owner rating"],
    [mean(s.meanMayVisualDone), "May visual, same toolkits"],
    [s.activeHours ? `${fmtNum(s.activeHours)} h` : "–", "active agent time"],
  ].map(([n, l]) => h("div", {}, h("dt", {}, l), h("dd", {}, n))));
  document.getElementById("links").replaceChildren(...[
    { label: "May 2026 evaluation", url: "../" },
    ...(data.links || []),
  ].map((l) => h("li", {}, h("a", { href: l.url }, l.label))));
  const kinds = [...new Set(data.toolkits.filter((t) => t.status !== "reference").map((t) => t.kind))].sort();
  const select = document.getElementById("kind-filter");
  if (select.options.length - 1 !== kinds.length) {
    select.replaceChildren(h("option", { value: "all" }, "All"), ...kinds.map((k) => h("option", { value: k }, k)));
    select.value = kinds.includes(filters.kind) ? filters.kind : "all";
  }
}

function ago(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function renderLive(offline = false) {
  const badge = document.getElementById("live-badge");
  badge.classList.toggle("offline", offline);
  if (!data) return;
  const when = new Date(data.generatedAt);
  badge.title = `Data updated ${when.toLocaleString()}; this page checks for new results every minute.`;
  document.getElementById("live-updated").textContent = `updated ${ago(data.generatedAt)}${offline ? " (offline)" : ""}`;
}

function renderAll() {
  data.toolkits.forEach((t, i) => { t._order = (t.wave ?? 0) * 100 + i; });
  renderHeader();
  renderTable();
  renderGallery();
  renderBeforeAfter();
  renderVsMay();
  renderLive();
}

function openLightbox(list, i) {
  if (!list.length) return;
  lb.list = list;
  lb.index = (i + list.length) % list.length;
  const s = list[lb.index];
  const img = document.getElementById("lightbox-img");
  const compare = document.getElementById("lightbox-compare");
  img.hidden = Boolean(s.compare);
  compare.hidden = !s.compare;
  if (s.compare) {
    img.removeAttribute("src");
    compare.replaceChildren(compareView(s.compare, true));
  } else {
    compare.replaceChildren();
    img.src = BASE + s.src;
    img.alt = `${s.title}: ${s.caption}`;
  }
  document.getElementById("lightbox-caption").replaceChildren(
    h("span", {}, `${s.title}: ${s.caption}`), h("small", {}, s.meta));
  const dialog = document.getElementById("lightbox");
  dialog.querySelectorAll(".lb-nav").forEach((b) => { b.hidden = list.length < 2; });
  if (!dialog.open) dialog.showModal();
}

function wire() {
  document.querySelectorAll("#shootout-table th[data-sort]").forEach((th) => {
    th.tabIndex = 0;
    const go = () => {
      const key = th.dataset.sort;
      if (sort.key === key) sort.dir *= -1;
      else { sort.key = key; sort.dir = ASCENDING.includes(key) ? 1 : -1; }
      renderTable();
    };
    th.addEventListener("click", go);
    th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
  document.getElementById("kind-filter").addEventListener("change", (e) => { filters.kind = e.target.value; renderTable(); });
  document.getElementById("status-filter").addEventListener("change", (e) => { filters.status = e.target.value; renderTable(); });
  const dialog = document.getElementById("lightbox");
  const step = (d) => openLightbox(lb.list, lb.index + d);
  dialog.querySelector(".lb-prev").addEventListener("click", () => step(-1));
  dialog.querySelector(".lb-next").addEventListener("click", () => step(1));
  dialog.querySelector(".lb-close").addEventListener("click", () => dialog.close());
  const frame = dialog.querySelector("figure");
  dialog.addEventListener("click", (e) => { if (e.target === dialog || e.target === frame) dialog.close(); });
  dialog.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight") step(1); });
}

async function load() {
  const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function refresh() {
  if (document.hidden) return;
  try {
    const json = await load();
    if (json.generatedAt !== data?.generatedAt) { data = json; renderAll(); }
    else renderLive();
  } catch {
    renderLive(true);
  }
}

wire();
load().then((json) => {
  data = json;
  renderAll();
  setInterval(refresh, REFRESH_MS);
  document.addEventListener("visibilitychange", refresh);
}).catch((err) => {
  renderLive(true);
  document.querySelector("main").prepend(h("p", { class: "empty" }, "Could not load the shootout results. ", String(err)));
});

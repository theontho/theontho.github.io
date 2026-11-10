"use strict";

const BASE = "../";
const REPO = "https://github.com/WGSExtract/wgsextract-cli";

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const $ = (id) => document.getElementById(id);
const secs = (v) => (v == null ? "–" : `${v.toFixed(1)} s`);
const pct = (v, base) => `${v <= base ? "−" : "+"}${Math.abs((1 - v / base) * 100).toFixed(1)}%`;

function bars(steps, { fmt = secs, showPct = true, kind = (s) => (s.baseline ? "base" : /metal/i.test(s.label) ? "gpu" : "cpu") } = {}) {
  const max = Math.max(...steps.map((s) => s.value));
  const base = steps[0].value;
  return h("div", { class: "bars" }, steps.map((s, i) => h("div", { class: `bar-row ${kind(s)}` },
    h("div", { class: "bar-label" }, s.label),
    h("div", { class: "bar-track" },
      h("div", { class: "bar-fill", style: `width:${(s.value / max) * 100}%` }),
      h("span", { class: "bar-value" }, fmt(s.value), showPct && i > 0 ? h("small", {}, ` ${pct(s.value, base)}`) : null)),
    s.what ? h("div", { class: "bar-what" }, s.what) : null)));
}

function table(el, head, rows) {
  el.replaceChildren(
    h("thead", {}, h("tr", {}, head.map(([t, num]) => h("th", { class: num ? "num" : null }, t)))),
    h("tbody", {}, rows.map((r) => h("tr", {}, r.map(([v, num]) => h("td", { class: num ? "num" : null }, v))))));
}

function render(d) {
  $("era").replaceChildren(
    h("div", {}, h("dt", {}, "When"), h("dd", {}, d.period)),
    h("div", {}, h("dt", {}, "Models"), h("dd", {}, d.models)),
    h("div", {}, h("dt", {}, "Machines"), h("dd", {}, d.machines)));
  $("headline").replaceChildren(...d.headline.map((x) => h("div", {}, h("dt", {}, x.label), h("dd", {}, x.value))));
  $("method").textContent = `${d.rule} Data: ${d.data}. Shorter bars are faster; percentages compare with the first row.`;

  $("climbs").replaceChildren(...d.climbs.map((c) => h("article", { class: "climb" },
    h("h3", {}, c.title), bars(c.steps), c.note ? h("p", { class: "footnote" }, c.note) : null)));

  $("mm2-title").textContent = d.minimap2.title;
  table($("mm2-table"), [["Reads"], ["Bioconda", 1], ["wgse 0.1.0", 1], ["Change", 1]],
    d.minimap2.rows.map((r) => [[r.reads], [secs(r.bioconda), 1], [secs(r.v010), 1], [r.change, 1]]));
  table($("mm2-metal-table"), [["Reads"], ["Bioconda", 1], ["wgse 0.1.0", 1], ["0.2.0 --metal", 1], ["Change", 1]],
    d.minimap2.metalRows.map((r) => [[r.reads], [secs(r.bioconda), 1], [secs(r.v010), 1], [secs(r.metal), 1], [r.change, 1]]));
  $("mm2-notes").replaceChildren(...d.minimap2.notes.map((n) => h("li", {}, n)));

  $("mem3-title").textContent = d.mem3.title;
  table($("mem3-table"), [["Mode"], ["Bioconda", 1], ["wgse CPU", 1], ["wgse --metal", 1], ["Change", 1]],
    d.mem3.rows.map((r) => [[r.mode], [secs(r.bioconda), 1], [secs(r.cpu), 1], [secs(r.metal), 1], [r.change, 1]]));
  $("mem3-notes").replaceChildren(...d.mem3.notes.map((n) => h("li", {}, n)));

  $("energy-note").textContent = d.energy.note;
  $("energy").replaceChildren(bars(
    d.energy.rows.map((r) => ({ label: r.aligner, value: r.wh30x, what: `${secs(r.time)} at ${r.watts} W` })),
    { fmt: (v) => `${v} Wh`, showPct: false, kind: (s) => (/metal/.test(s.label) ? "gpu" : /Bioconda/.test(s.label) ? "base" : "cpu") }));

  $("small-title").textContent = d.smallMac.title;
  $("small").replaceChildren(bars(d.smallMac.rows.map((r) => ({ label: r.run, value: r.time, what: r.what })),
    { showPct: false, kind: (s) => (/metal/.test(s.label) ? "gpu" : "cpu") }));
  $("small-notes").replaceChildren(...d.smallMac.notes.map((n) => h("li", {}, n)));
  $("hosted").replaceChildren(...d.hosted.map((n) => h("li", {}, n)));
  $("failed").replaceChildren(...d.failed.map((n) => h("li", {}, n)));
  $("links").replaceChildren(...d.links.map((l) => h("li", {}, h("a", { href: l.url }, l.label))));
  $("prs").replaceChildren(...d.prs.map(([n, t]) => h("li", {}, h("a", { href: `${REPO}/pull/${n}` }, `#${n}`), ` ${t}`)));
}

fetch(BASE + "data/apple-silicon-aligners.json").then((r) => r.json()).then(render).catch((err) => {
  document.querySelector("main").prepend(h("p", { class: "empty" }, "Could not load the data. ", String(err)));
});

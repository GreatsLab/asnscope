import { call, pool } from "./api.js";
import {
  countryOf, currentPrefixes, moreSpecifics, normaliseNeighbours, parseQuery,
  peeringLayout, prefixLenHistogram, shortHolder, splitFamilies, v4Space,
} from "./data.js";

const $ = (s) => document.querySelector(s);
const NS = "http://www.w3.org/2000/svg";

// Starting points. Names here are only labels for the buttons; the page
// always shows the holder name RIPEstat returns.
const PICKS = [
  ["AS29465", "MTN Nigeria"], ["AS36873", "Airtel Nigeria"], ["AS37148", "Globacom"],
  ["AS37282", "MainOne"], ["AS37100", "SEACOM"], ["AS30844", "Liquid"],
  ["AS33771", "Safaricom"], ["AS16637", "MTN South Africa"], ["AS37457", "Telkom SA"],
  ["AS13335", "Cloudflare"],
];

const fmt = (n) => Math.round(n).toLocaleString("en-US");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let seq = 0;   // drop responses from an older lookup if the user typed a new one

function status(msg, err = false) {
  const s = $("#status");
  s.textContent = msg;
  s.classList.toggle("err", err);
}

async function lookup(raw, { push = true } = {}) {
  const q = parseQuery(raw);
  if (!q) return;
  if (q.kind === "bad") { status(`"${raw}" doesn't look like an AS number, IP address or prefix.`, true); return; }
  $("#q").value = q.value;
  if (push) history.pushState({ q: q.value }, "", `?q=${encodeURIComponent(q.value)}`);

  const my = ++seq;
  if (q.kind === "asn") return showAsn(q.value, my);

  status(`Finding who announces ${q.value}…`);
  try {
    const info = await call("network-info", { resource: q.value });
    if (my !== seq) return;
    if (!info.asns || !info.asns.length) {
      status(`${q.value} isn't announced in BGP right now (unrouted, or private address space).`, true);
      return;
    }
    const asn = `AS${info.asns[0]}`;
    await showAsn(asn, my, `${q.value} is in ${info.prefix}, announced by ${asn}${info.asns.length > 1 ? ` (and ${info.asns.length - 1} other origin${info.asns.length > 2 ? "s" : ""})` : ""}.`);
  } catch (e) {
    if (my === seq) status(e.message, true);
  }
}

async function showAsn(asn, my, note = "") {
  status(`Loading ${asn}…`);
  const num = asn.slice(2);
  let overview, prefixes, neighbours;
  try {
    [overview, prefixes, neighbours] = await Promise.all([
      call("as-overview", { resource: num }),
      call("announced-prefixes", { resource: num }),
      call("asn-neighbours", { resource: num }),
    ]);
  } catch (e) {
    if (my === seq) status(e.message, true);
    return;
  }
  if (my !== seq) return;

  $("#intro").hidden = true;
  $("#result").hidden = false;
  document.title = `${asn} ${shortHolder(overview.holder)} - asnscope`;

  const cc = countryOf(overview.holder);
  $("#r-asn").innerHTML = `${esc(asn)}${cc ? `<small>${esc(cc)}</small>` : ""}`;
  $("#r-holder").textContent = overview.holder || "No holder name in the registry";

  const fam = splitFamilies(currentPrefixes(prefixes));
  const ns = normaliseNeighbours(neighbours);
  const counts = neighbours.neighbour_counts || {};
  const space = v4Space(fam.v4);
  const ms = new Set(moreSpecifics(fam.v4));

  const parts = [];
  if (note) parts.push(note);
  if (!overview.announced && !fam.v4.length && !fam.v6.length) {
    parts.push("It isn't announcing anything that the RIPE route collectors can see right now.");
  } else {
    parts.push(`Announces ${fmt(fam.v4.length)} IPv4 prefix${fam.v4.length === 1 ? "" : "es"} covering ${fmt(space * 256)} addresses (${fmt(space)} /24s) and ${fmt(fam.v6.length)} IPv6 prefix${fam.v6.length === 1 ? "" : "es"}.`);
    if (ms.size) parts.push(`${fmt(ms.size)} of the IPv4 ones are more-specifics of its own larger blocks, usually traffic engineering.`);
  }
  parts.push(`Seen next to ${fmt(counts.unique ?? ns.length)} other networks: ${fmt(counts.left ?? 0)} on the provider/peer side, ${fmt(counts.right ?? 0)} behind it.`);
  $("#r-summary").textContent = parts.join(" ");

  drawMap(asn, ns, {});
  renderNeighbours(ns, {});
  renderPrefixes(fam, ms);
  status("");
  window.scrollTo({ top: 0 });

  // names for the neighbours we actually show: one as-overview call each
  const shown = [...ns.filter(n => n.type !== "right").slice(0, 14), ...ns.filter(n => n.type === "right").slice(0, 14),
    ...ns.slice(0, 40)];
  const uniq = [...new Map(shown.map(n => [n.asn, n])).values()];
  const names = {};
  await pool(uniq, 6, async (n) => {
    const o = await call("as-overview", { resource: n.asn.slice(2) });
    names[n.asn] = o.holder;
  });
  if (my !== seq) return;
  drawMap(asn, ns, names);
  renderNeighbours(ns, names);
}

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent && parent.appendChild(e);
  return e;
}

function drawMap(asn, ns, names) {
  lastMap = [asn, ns, names];
  const svg = $("#map");
  svg.innerHTML = "";
  // a 900-wide drawing squeezed onto a phone makes 6px text. On narrow
  // screens draw a smaller canvas with fewer neighbours instead.
  const narrow = svg.parentElement.clientWidth < 620;
  const W = narrow ? 560 : 900, H = narrow ? 520 : 420;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.classList.toggle("narrow", narrow);
  const L = peeringLayout(ns, { width: W, height: H, max: narrow ? 6 : 14 });
  if (!ns.length) {
    el("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "empty" }, svg).textContent = "No neighbours seen.";
    return;
  }
  for (const n of L.nodes) {
    const side = n.type === "right" ? "r" : "l";
    const mx = (L.cx + n.x) / 2;
    el("path", { class: `link ${side}`, d: `M${L.cx},${L.cy} C${mx},${L.cy} ${mx},${n.y} ${n.x},${n.y}`, "stroke-width": n.w }, svg);
  }
  for (const n of L.nodes) {
    const side = n.type === "right" ? "r" : "l";
    const g = el("g", { class: `n ${side}`, tabindex: 0, role: "button", "aria-label": `Open ${n.asn}` }, svg);
    el("circle", { cx: n.x, cy: n.y, r: 6 + n.w / 2 }, g);
    const anchor = side === "l" ? "end" : "start";
    const dx = side === "l" ? -14 : 14;
    el("text", { x: n.x + dx, y: n.y - 1, "text-anchor": anchor }, g).textContent = n.asn;
    const nm = shortHolder(names[n.asn]);
    if (nm) el("text", { x: n.x + dx, y: n.y + 14, "text-anchor": anchor, class: "sub" }, g).textContent = nm.length > 26 ? nm.slice(0, 25) + "…" : nm;
    g.addEventListener("click", () => lookup(n.asn));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter") lookup(n.asn); });
  }
  const c = el("g", { class: "centre" }, svg);
  el("circle", { cx: L.cx, cy: L.cy, r: narrow ? 64 : 58 }, c);
  el("text", { x: L.cx, y: L.cy + 7, "text-anchor": "middle" }, c).textContent = asn;
  if (L.hiddenLeft) el("text", { x: 12, y: H - 8, class: "more" }, svg).textContent = `+${L.hiddenLeft} more`;
  if (L.hiddenRight) el("text", { x: W - 12, y: H - 8, class: "more", "text-anchor": "end" }, svg).textContent = `+${L.hiddenRight} more`;
}

function renderNeighbours(ns, names) {
  $("#n-count").textContent = ns.length ? fmt(ns.length) : "";
  const rows = ns.slice(0, 40).map(n => {
    const side = n.type === "right" ? "r" : "l";
    const label = n.type === "right" ? "behind" : n.type === "uncertain" ? "peer?" : "provider/peer";
    const nm = names[n.asn];
    return `<tr><td><button type="button" data-asn="${n.asn}">${n.asn}</button></td>
      <td>${esc(shortHolder(nm))}${countryOf(nm) ? `<span class="cc">${countryOf(nm)}</span>` : ""}</td>
      <td><span class="side ${side}">${label}</span></td><td class="num">${fmt(n.paths)}</td></tr>`;
  });
  if (ns.length > 40) rows.push(`<tr><td colspan="4">…and ${fmt(ns.length - 40)} more</td></tr>`);
  $("#n-table tbody").innerHTML = rows.join("") || `<tr><td colspan="4">None seen.</td></tr>`;
}

let famState = null;
function renderPrefixes(fam, ms) {
  famState = { fam, ms };
  $("#p-count").textContent = `${fmt(fam.v4.length)} v4, ${fmt(fam.v6.length)} v6`;
  const hist = prefixLenHistogram(fam.v4);
  const top = Math.max(1, ...hist.map(h => h.count));
  $("#p-sizes").innerHTML = hist.map(h =>
    `<div style="height:${(h.count / top) * 100}%" title="${h.count} × /${h.len}"><span>/${h.len}</span></div>`).join("");
  showFamily(document.querySelector('.tabs [aria-selected="true"]').dataset.fam);
}

function showFamily(f) {
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.fam === f)));
  const { fam, ms } = famState;
  const list = fam[f];
  $("#p-list").innerHTML = list.length
    ? list.map(p => `<li${ms.has(p) ? ' class="ms"' : ""}>${esc(p)}</li>`).join("")
    : `<li>No ${f === "v4" ? "IPv4" : "IPv6"} prefixes announced.</li>`;
}

// ---- wiring ----
$("#picks").innerHTML = PICKS.map(([a, n]) => `<li><button type="button" data-asn="${a}"><b>${a}</b>${esc(n)}</button></li>`).join("");
document.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-asn]");
  if (b) lookup(b.dataset.asn);
});
document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-fam]");
  if (b && famState) showFamily(b.dataset.fam);
});
let lastMap = null;
let resizeT;
window.addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => lastMap && drawMap(...lastMap), 150);
});
$("#search").addEventListener("submit", (e) => { e.preventDefault(); lookup($("#q").value); });
window.addEventListener("popstate", () => {
  const q = new URLSearchParams(location.search).get("q");
  if (q) lookup(q, { push: false });
  else { $("#intro").hidden = false; $("#result").hidden = true; seq++; status(""); }
});

const start = new URLSearchParams(location.search).get("q");
if (start) lookup(start, { push: false });

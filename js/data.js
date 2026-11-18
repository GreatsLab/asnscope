// Pure data helpers - no DOM, no fetch - so they can be tested in node.

export function parseQuery(q) {
  const s = String(q).trim().replace(/\s+/g, "");
  if (!s) return null;
  const asn = s.match(/^(?:AS)?(\d{1,10})$/i);
  if (asn) return { kind: "asn", value: `AS${Number(asn[1])}` };
  if (/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(s)) {
    const [ip] = s.split("/");
    if (ip.split(".").some(o => Number(o) > 255)) return { kind: "bad", value: s };
    return { kind: s.includes("/") ? "prefix" : "ip", value: s };
  }
  if (/^[0-9a-f:]+(\/\d{1,3})?$/i.test(s) && s.includes(":")) {
    return { kind: s.includes("/") ? "prefix" : "ip", value: s.toLowerCase() };
  }
  return { kind: "bad", value: s };
}

// RIPEstat renamed some neighbour fields between versions (power -> path_count,
// v4_peers -> peer_count). Accept either.
export function normaliseNeighbours(data) {
  const list = (data && data.neighbours) || [];
  return list.map(n => ({
    asn: `AS${n.asn}`,
    type: n.type,
    paths: n.power ?? n.path_count ?? 0,
    peers: (n.v4_peers ?? n.peer_count ?? 0) + (n.v6_peers ?? 0),
  })).sort((a, b) => b.paths - a.paths);
}

// prefixes that are announced right now (timeline ends at the query end)
export function currentPrefixes(data) {
  const end = data && data.query_endtime;
  return ((data && data.prefixes) || [])
    .filter(p => !end || !p.timelines || p.timelines.some(t => t.endtime >= end.slice(0, 16)))
    .map(p => p.prefix);
}

export function splitFamilies(prefixes) {
  const v4 = [], v6 = [];
  for (const p of prefixes) (p.includes(":") ? v6 : v4).push(p);
  return { v4: sortPrefixes(v4), v6: v6.sort() };
}

function v4key(p) {
  const [ip, len] = p.split("/");
  return ip.split(".").reduce((n, o) => n * 256 + Number(o), 0) * 64 + Number(len);
}

export function sortPrefixes(v4) {
  return [...v4].sort((a, b) => v4key(a) - v4key(b));
}

// Total IPv4 space in /24 equivalents, counting overlaps once.
// ASes often announce a /16 *and* the /24s inside it (traffic engineering);
// adding those up naively double counts, which a lot of tools get wrong.
export function v4Space(prefixes) {
  const ranges = prefixes.map(p => {
    const [ip, len] = p.split("/");
    const start = ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
    return [start, start + 2 ** (32 - Number(len))];
  }).sort((a, b) => a[0] - b[0]);
  let total = 0, curS = -1, curE = -1;
  for (const [s, e] of ranges) {
    if (s > curE) { if (curE > curS) total += curE - curS; curS = s; curE = e; }
    else curE = Math.max(curE, e);
  }
  if (curE > curS) total += curE - curS;
  return total / 256;
}

export function prefixLenHistogram(v4) {
  const h = {};
  for (const p of v4) {
    const l = Number(p.split("/")[1]);
    h[l] = (h[l] || 0) + 1;
  }
  return Object.entries(h).map(([len, count]) => ({ len: Number(len), count })).sort((a, b) => a.len - b.len);
}

// More-specifics: prefixes covered by another prefix from the same AS.
export function moreSpecifics(v4) {
  const r = v4.map(p => {
    const [ip, len] = p.split("/");
    const s = ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
    return { p, s, e: s + 2 ** (32 - Number(len)), len: Number(len) };
  });
  return r.filter(a => r.some(b => b !== a && b.len < a.len && b.s <= a.s && a.e <= b.e)).map(a => a.p);
}

// Lay neighbours out on two arcs either side of the centre: "left" ones (seen
// between us and the collectors - transit/peers) on the left, "right" ones
// (seen behind us - customers) on the right. Uncertain ones go with left.
export function peeringLayout(neighbours, { width = 900, height = 420, max = 14 } = {}) {
  const cx = width / 2, cy = height / 2;
  const left = neighbours.filter(n => n.type !== "right").slice(0, max);
  const right = neighbours.filter(n => n.type === "right").slice(0, max);
  const top = Math.max(1, ...neighbours.map(n => n.paths));
  const arc = (list, side) => list.map((n, i) => {
    const k = list.length === 1 ? 0.5 : i / (list.length - 1);
    const a = (-60 + k * 120) * Math.PI / 180;          // -60deg .. +60deg
    // leave ~170px each side for the AS number + holder label
    const r = Math.min(cx - 170, height * 0.9);
    return {
      ...n,
      x: cx + side * Math.cos(a) * r,
      y: cy + Math.sin(a) * (height / 2 - 34),
      w: 1 + 7 * Math.sqrt(n.paths / top),
    };
  });
  return { cx, cy, nodes: [...arc(left, -1), ...arc(right, 1)], hiddenLeft: Math.max(0, neighbours.filter(n => n.type !== "right").length - max), hiddenRight: Math.max(0, neighbours.filter(n => n.type === "right").length - max) };
}

export function shortHolder(h) {
  if (!h) return "";
  // "MTNNS-AS, ZA" / "GLOBACOM-AS - Globacom Ltd, NG" -> a readable name
  let s = h.replace(/,\s*[A-Z]{2}$/, "");
  const dash = s.split(" - ");
  if (dash.length > 1) s = dash.slice(1).join(" - ");
  return s.trim();
}

export function countryOf(holder) {
  const m = holder && holder.match(/,\s*([A-Z]{2})$/);
  return m ? m[1] : "";
}

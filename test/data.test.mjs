import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, normaliseNeighbours, currentPrefixes, splitFamilies, v4Space, moreSpecifics, prefixLenHistogram, peeringLayout, shortHolder, countryOf } from "../js/data.js";

test("parseQuery", () => {
  assert.deepEqual(parseQuery("as29465"), { kind: "asn", value: "AS29465" });
  assert.deepEqual(parseQuery(" 37282 "), { kind: "asn", value: "AS37282" });
  assert.deepEqual(parseQuery("102.89.4.10"), { kind: "ip", value: "102.89.4.10" });
  assert.deepEqual(parseQuery("41.58.0.0/16"), { kind: "prefix", value: "41.58.0.0/16" });
  assert.deepEqual(parseQuery("2c0f:f4c0::1"), { kind: "ip", value: "2c0f:f4c0::1" });
  assert.equal(parseQuery("300.1.1.1").kind, "bad");
  assert.equal(parseQuery("mtn").kind, "bad");
});

test("neighbour field names, old and new api", () => {
  const a = normaliseNeighbours({ neighbours: [{ asn: 1, type: "left", power: 5, v4_peers: 3, v6_peers: 1 }] });
  const b = normaliseNeighbours({ neighbours: [{ asn: 1, type: "left", path_count: 5, peer_count: 4 }] });
  assert.deepEqual(a, b);
  assert.deepEqual(a[0], { asn: "AS1", type: "left", paths: 5, peers: 4 });
});

test("only currently announced prefixes", () => {
  const d = {
    query_endtime: "2026-11-18T08:00:00",
    prefixes: [
      { prefix: "10.0.0.0/8", timelines: [{ starttime: "2026-11-04T08:00:00", endtime: "2026-11-18T08:00:00" }] },
      { prefix: "11.0.0.0/8", timelines: [{ starttime: "2026-11-04T08:00:00", endtime: "2026-11-06T00:00:00" }] },
    ],
  };
  assert.deepEqual(currentPrefixes(d), ["10.0.0.0/8"]);
});

test("v4 space counts overlaps once", () => {
  assert.equal(v4Space(["41.58.0.0/16", "41.58.10.0/24", "41.58.11.0/24"]), 256);
  assert.equal(v4Space(["41.58.0.0/24", "41.58.1.0/24"]), 2);
  assert.equal(v4Space(["197.210.0.0/22"]), 4);
});

test("more specifics + sizes + families", () => {
  const { v4, v6 } = splitFamilies(["41.58.10.0/24", "2c0f:f4c0::/32", "41.58.0.0/16", "105.112.0.0/12"]);
  assert.deepEqual(v4, ["41.58.0.0/16", "41.58.10.0/24", "105.112.0.0/12"]);
  assert.deepEqual(v6, ["2c0f:f4c0::/32"]);
  assert.deepEqual(moreSpecifics(v4), ["41.58.10.0/24"]);
  assert.deepEqual(prefixLenHistogram(v4), [{ len: 12, count: 1 }, { len: 16, count: 1 }, { len: 24, count: 1 }]);
});

test("layout puts left neighbours left of centre", () => {
  const ns = normaliseNeighbours({ neighbours: [
    { asn: 1, type: "left", power: 100 }, { asn: 2, type: "right", power: 10 }, { asn: 3, type: "uncertain", power: 1 }] });
  const { cx, nodes } = peeringLayout(ns);
  for (const n of nodes) assert.ok(n.type === "right" ? n.x > cx : n.x < cx, n.asn);
  assert.ok(nodes.find(n => n.asn === "AS1").w > nodes.find(n => n.asn === "AS3").w);
});

test("holder names", () => {
  assert.equal(shortHolder("GLOBACOM-AS - Globacom Ltd, NG"), "Globacom Ltd");
  assert.equal(shortHolder("MTNNS-AS, ZA"), "MTNNS-AS");
  assert.equal(countryOf("MTNNS-AS, ZA"), "ZA");
});

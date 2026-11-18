// Thin RIPEstat client. Public, no key, CORS enabled.
// https://stat.ripe.net/docs/data_api

const BASE = "https://stat.ripe.net/data";
const cache = new Map();

export async function call(name, params) {
  const qs = new URLSearchParams({ ...params, sourceapp: "asnscope-greatslab" });
  const url = `${BASE}/${name}/data.json?${qs}`;
  if (cache.has(url)) return cache.get(url);
  const p = (async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    let res;
    try {
      res = await fetch(url, { signal: ctrl.signal });
    } catch (e) {
      throw new Error(e.name === "AbortError" ? `RIPEstat took too long (${name})` : `Couldn't reach RIPEstat (${name})`);
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) throw new Error(`RIPEstat answered ${res.status} for ${name}`);
    const body = await res.json();
    if (body.status && body.status !== "ok") throw new Error(body.messages?.[0]?.[1] || `RIPEstat: ${body.status}`);
    return body.data;
  })();
  cache.set(url, p);
  p.catch(() => cache.delete(url));   // don't cache failures
  return p;
}

// run fn over items, at most `n` at a time - be nice to a free API
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch { out[k] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

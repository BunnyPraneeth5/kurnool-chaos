// Overpass API client shared by fetch.mjs and fetch-details.mjs.
// Retries with backoff while the server is busy. Set OVERPASS_URL to use another server.

export const ENDPOINT = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const UA = 'osm-map-export-script/0.1';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BUSY = new Set([429, 502, 503, 504]);
const WAITS_S = [15, 30, 60, 120, 240]; // exponential backoff when the server is busy

export async function overpass(label, query) {
  console.log(`Overpass: ${label} ...`);
  const t0 = Date.now();
  let res;
  let text = '';
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': UA,
        },
        body: 'data=' + encodeURIComponent(query),
      });
      text = await res.text();
    } catch (err) {
      if (attempt >= WAITS_S.length) throw new Error(`Could not reach Overpass at ${ENDPOINT}: ${err.message}`);
      console.log(`  network error (${err.message}), retrying in ${WAITS_S[attempt]} s`);
      await sleep(WAITS_S[attempt] * 1000);
      continue;
    }
    if (res.ok || !BUSY.has(res.status) || attempt >= WAITS_S.length) break;
    console.log(`  server busy (HTTP ${res.status}), retrying in ${WAITS_S[attempt]} s`);
    await sleep(WAITS_S[attempt] * 1000);
  }
  if (!res.ok) {
    throw new Error(`Overpass ${label} failed: HTTP ${res.status}\n${text.slice(0, 800)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Overpass ${label} did not return JSON:\n${text.slice(0, 800)}`);
  }
  if (json.remark && /error|timed out|runtime/i.test(json.remark)) {
    throw new Error(`Overpass ${label} stopped early: ${json.remark}`);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ${json.elements.length} elements, ${(text.length / 1e6).toFixed(1)} MB, ${secs} s`);
  return json;
}

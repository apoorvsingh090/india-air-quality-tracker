const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { timeout = 25000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "application/json,text/html;q=0.9,*/*;q=0.8" },
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// Scrape the AQICN/WAQI city page for the primary station id.
export async function discoverWaqiIdx(slugs) {
  for (const slug of slugs || []) {
    try {
      const html = await get(`https://aqicn.org/city/${slug}/`, { timeout: 7000, retries: 0 });
      const m = html.match(/aqiStation\s*=\s*\{[^}]*?"idx"\s*:\s*(\d+)/);
      if (m) {
        const name = html.match(/aqiStation\s*=\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/);
        return { idx: Number(m[1]), name: name ? name[1] : slug, slug };
      }
    } catch {
      // try next slug variant
    }
    await sleep(400);
  }
  return null;
}

// Public AQICN widget feed: no token needed, returns 48-50 hourly points.
export async function fetchWaqiStation(idx) {
  const text = await get(`https://aqicn.org/aqicn/json/android/@${idx}/`, { retries: 2 });
  const j = JSON.parse(text);
  if (j.status === "error") throw new Error(j.reason || "waqi error");
  return j;
}

export function parseWaqi(j) {
  const h = j.historic || {};
  const toArr = (v) => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      return Object.entries(v)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map((e) => e[1]);
    }
    return [];
  };
  const series = {
    pm25: toArr(h["PM2.5"]),
    pm10: toArr(h.PM10),
    no2: toArr(h.no2),
    so2: toArr(h.so2),
    o3: toArr(h.O3),
    co: toArr(h.co)
  };
  const lastN = (arr, n) => {
    const vals = arr.filter((v) => v != null && v !== "-" && !Number.isNaN(Number(v))).map(Number);
    return vals.slice(-n);
  };
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const reported = Number(j.aqi);
  return {
    reportedAqi: Number.isFinite(reported) ? reported : null,
    name: j.nameen || j.namena || null,
    updatedAt: j.time ? new Date(j.time * 1000).toISOString() : null,
    series,
    last: {
      pm25: lastN(series.pm25, 1)[0] ?? null,
      pm10: lastN(series.pm10, 1)[0] ?? null,
      no2: lastN(series.no2, 1)[0] ?? null,
      so2: lastN(series.so2, 1)[0] ?? null,
      o3: lastN(series.o3, 1)[0] ?? null,
      co: lastN(series.co, 1)[0] ?? null
    },
    avg24: {
      pm25: mean(lastN(series.pm25, 24)),
      pm10: mean(lastN(series.pm10, 24)),
      no2: mean(lastN(series.no2, 24)),
      so2: mean(lastN(series.so2, 24)),
      o3: mean(lastN(series.o3, 8)),
      co: mean(lastN(series.co, 8))
    }
  };
}

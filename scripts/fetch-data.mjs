import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CITIES } from "./lib/cities.mjs";
import { computeAqi, POLLUTANTS, ugm3ToMgm3 } from "./lib/aqi.mjs";
import { discoverWaqiIdx, fetchWaqiStation, parseWaqi, sleep } from "./lib/waqi.mjs";
import { fetchBulletin } from "./lib/cpcb.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const DISCOVER = process.argv.includes("--discover");
const MAX_DISCOVER = Number(process.env.MAX_DISCOVER || (DISCOVER ? 999 : 6));

const CAMS_VARS = [
  "pm2_5",
  "pm10",
  "nitrogen_dioxide",
  "sulphur_dioxide",
  "carbon_monoxide",
  "ozone",
  "ammonia"
];

const mean = (arr) => {
  const v = arr.filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const round = (v, d = 1) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

async function fetchJson(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "india-aqi-tracker/1.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      await sleep(1200 * (i + 1));
    }
  }
  throw last;
}

async function fetchCams(cities) {
  const out = new Map();
  const batchSize = 40;
  for (let i = 0; i < cities.length; i += batchSize) {
    const batch = cities.slice(i, i + batchSize);
    const lat = batch.map((c) => c.lat).join(",");
    const lon = batch.map((c) => c.lon).join(",");
    const url =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&hourly=${CAMS_VARS.join(",")}&past_days=2&forecast_days=1&timezone=Asia%2FKolkata`;
    try {
      const json = await fetchJson(url);
      const arr = Array.isArray(json) ? json : [json];
      batch.forEach((city, j) => {
        const d = arr[j];
        if (d?.hourly) out.set(city.id, d);
      });
    } catch (e) {
      console.error(`CAMS batch ${i} failed: ${e.message}`);
    }
    await sleep(400);
  }
  return out;
}

function camsCity(d) {
  const H = d.hourly;
  const times = H.time;
  const series = {};
  for (const [key, apiKey] of [
    ["pm25", "pm2_5"],
    ["pm10", "pm10"],
    ["no2", "nitrogen_dioxide"],
    ["so2", "sulphur_dioxide"],
    ["co", "carbon_monoxide"],
    ["o3", "ozone"],
    ["nh3", "ammonia"]
  ]) {
    series[key] = H[apiKey] || [];
  }
  // Ignore trailing null hours (forecast not yet available); keep last 72h.
  // Cap at the current IST hour so the "current" values never come from the forecast tail.
  const nowIST = new Date(Date.now() + 19800000).toISOString().slice(0, 16);
  const lastReal = series.pm25.reduce(
    (acc, v, idx) => (v != null && times[idx] <= nowIST ? idx : acc),
    0
  );
  const start = Math.max(0, lastReal - 71);
  const cut = (arr) => arr.slice(start, lastReal + 1);

  const t = times.slice(start, lastReal + 1);
  const cutSeries = {};
  for (const p of POLLUTANTS) cutSeries[p] = cut(series[p] || []);
  cutSeries.co = cutSeries.co.map((v) => ugm3ToMgm3(v));

  const avg24 = {};
  const last8 = {};
  for (const p of POLLUTANTS) {
    avg24[p] = p === "co" || p === "o3" ? mean(cutSeries[p].slice(-8)) : mean(cutSeries[p].slice(-24));
    last8[p] = cutSeries[p][cutSeries[p].length - 1] ?? null;
  }
  const aqi24 = computeAqi(avg24);
  const aqiNow = computeAqi(last8);
  const hourlyAqi = cutSeries.pm25.map((v, idx) => {
    const c = {
      pm25: v,
      pm10: cutSeries.pm10[idx],
      no2: cutSeries.no2[idx],
      so2: cutSeries.so2[idx],
      co: cutSeries.co[idx],
      o3: cutSeries.o3[idx],
      nh3: cutSeries.nh3[idx]
    };
    return computeAqi(c).aqi;
  });
  return {
    times: t,
    series: cutSeries,
    pollutants: Object.fromEntries(POLLUTANTS.map((p) => [p, round(avg24[p], 2)])),
    now: Object.fromEntries(POLLUTANTS.map((p) => [p, round(last8[p], 2)])),
    aqi: aqi24.aqi,
    dominant: aqi24.dominant,
    aqiNow: aqiNow.aqi,
    hourlyAqi,
    updatedAt: t[t.length - 1] ? `${t[t.length - 1]}:00+05:30` : null
  };
}

async function loadWaqiIndex() {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA, "waqi-index.json"), "utf8"));
  } catch {
    return {};
  }
}

async function loadLatestBulletin() {
  const now = new Date();
  const ist = new Date(now.getTime() + 19800000);
  const dates = [];
  for (let i = 0; i < 4; i++) {
    dates.push(new Date(ist.getTime() - i * 86400000).toISOString().slice(0, 10));
  }
  for (const d of dates) {
    try {
      const b = await fetchBulletin(d);
      if (b.count < 50) throw new Error(`only ${b.count} cities parsed`);
      const map = new Map();
      for (const row of b.cities) map.set(row.normalized, row);
      console.log(`CPCB bulletin: ${d} (${b.count} cities)`);
      return { date: d, aqiOn: b.aqiOn, aqiAt: b.aqiAt, map };
    } catch {
      // try the previous day
    }
  }
  return null;
}

async function main() {
  await fs.mkdir(DATA, { recursive: true });
  const waqiIndex = await loadWaqiIndex();
  const sources = {
    cams: {
      name: "CAMS (Copernicus) via Open-Meteo",
      status: "ok",
      url: "https://open-meteo.com/en/docs/air-quality-api",
      note: "Modeled surface concentrations, hourly. Used as the consistent national baseline."
    },
    cpcb: {
      name: "CPCB CAAQMS stations via AQICN/WAQI",
      status: "ok",
      url: "https://aqicn.org/india/",
      note: "Ground-station data reported by CPCB and state pollution control boards, aggregated by the World Air Quality Index project. WAQI reports its own AQI (US EPA method); stale feeds are excluded from the live count."
    }
  };

  console.log(`CAMS: fetching ${CITIES.length} cities...`);
  const camsRaw = await fetchCams(CITIES);
  const cams = new Map();
  for (const [id, d] of camsRaw) {
    try {
      cams.set(id, camsCity(d));
    } catch (e) {
      console.error(`CAMS parse failed for ${id}: ${e.message}`);
    }
  }

  // Discover missing AQICN station ids (slow, bounded per run).
  let discovered = 0;
  let attempts = 0;
  const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || (DISCOVER ? 999 : 5));
  for (const city of CITIES) {
    if (waqiIndex[city.id] || discovered >= MAX_DISCOVER || attempts >= MAX_ATTEMPTS) continue;
    attempts++;
    const found = await discoverWaqiIdx(city.slugs);
    if (found) {
      waqiIndex[city.id] = found;
      discovered++;
      console.log(`WAQI idx ${city.id} -> ${found.idx} (${found.name})`);
    }
  }
  await fs.writeFile(path.join(DATA, "waqi-index.json"), JSON.stringify(waqiIndex, null, 2));

  console.log("WAQI: fetching station feeds...");
  const stations = new Map();
  const entries = CITIES.filter((c) => waqiIndex[c.id]);
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const city = entries[cursor++];
      const meta = waqiIndex[city.id];
      try {
        const raw = await fetchWaqiStation(meta.idx);
        const parsed = parseWaqi(raw);
        const ageHours = parsed.updatedAt ? (Date.now() - Date.parse(parsed.updatedAt)) / 3600000 : null;
        stations.set(city.id, {
          idx: meta.idx,
          name: parsed.name || meta.name,
          aqi: parsed.reportedAqi,
          updatedAt: parsed.updatedAt,
          ageHours: ageHours == null ? null : round(ageHours, 1),
          stale: ageHours == null || ageHours > 6
        });
      } catch (e) {
        console.error(`WAQI ${city.id}: ${e.message}`);
      }
      await sleep(250);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(`WAQI: ${stations.size}/${entries.length} stations`);

  const bulletin = await loadLatestBulletin();

  sources.bulletin = {
    name: "CPCB Daily National AQI Bulletin",
    status: bulletin ? "ok" : "unavailable",
    url: "https://cpcb.nic.in/aqi_bulletin.php",
    note: bulletin
      ? `Official city AQI, 24h average ending 4 PM IST on ${bulletin.date}. Used as the headline value.`
      : "No recent bulletin available; headline falls back to the CAMS model."
  };

  const now = new Date();
  const cities = CITIES.map((city) => {
    const m = cams.get(city.id) || null;
    const s = stations.get(city.id) || null;
    const b = bulletin?.map.get(city.id) || null;
    const freshStation = s && !s.stale ? s : null;
    const primary = b?.aqi != null ? b : m?.aqi != null ? m : freshStation;
    const primarySource = b?.aqi != null ? "cpcb-bulletin" : m?.aqi != null ? "cams" : freshStation ? "cpcb" : null;
    return {
      ...city,
      waqi: waqiIndex[city.id] || null,
      aqi: primary?.aqi ?? null,
      dominant: b?.pollutant ?? m?.dominant ?? null,
      primarySource,
      pollutants: m?.pollutants ?? null,
      bulletin: b
        ? {
            date: bulletin.date,
            aqi: b.aqi,
            category: b.category,
            pollutant: b.pollutant,
            stations: b.stations
          }
        : null,
      model: m
        ? {
            aqi: m.aqi,
            aqiNow: m.aqiNow,
            dominant: m.dominant,
            pollutants: m.pollutants,
            updatedAt: m.updatedAt
          }
        : null,
      station: s
        ? {
            idx: s.idx,
            name: s.name,
            aqi: s.aqi,
            updatedAt: s.updatedAt,
            ageHours: s.ageHours,
            stale: s.stale
          }
        : null
    };
  });

  const ranked = cities.filter((c) => c.aqi != null).sort((a, b) => b.aqi - a.aqi);
  const freshStations = cities.filter((c) => c.station && !c.station.stale).length;
  sources.cpcb.status = freshStations > 0 ? "ok" : "stale";
  sources.cpcb.note += ` Current mapped stations: ${freshStations} of ${stations.size} (≤6h old).`;
  sources.cams.status = cams.size === CITIES.length ? "ok" : cams.size > 0 ? "partial" : "unavailable";
  sources.cams.note = `Modeled surface concentrations, hourly. ${cams.size} of ${CITIES.length} cities returned a series. Used for cities without a current official bulletin row.`;
  const latest = {
    generatedAt: now.toISOString(),
    generatedAtIST: now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }),
    aqiStandard: "CPCB National AQI (2014), 24h averages",
    sources,
    national: {
      avgAqi: ranked.length ? Math.round(ranked.reduce((a, c) => a + c.aqi, 0) / ranked.length) : null,
      worst: ranked[0] ? { id: ranked[0].id, name: ranked[0].name, aqi: ranked[0].aqi } : null,
      best: ranked.length
        ? { id: ranked.at(-1).id, name: ranked.at(-1).name, aqi: ranked.at(-1).aqi }
        : null,
      stationCount: freshStations,
      stationMappedCount: stations.size
    },
    cities
  };
  await fs.writeFile(path.join(DATA, "latest.json"), JSON.stringify(latest));

  // Trend history: CAMS hourly AQI + PM2.5 for every city (72h).
  const hours = cams.values().next().value?.times || [];
  const history = { generatedAt: now.toISOString(), hours, cities: {} };
  for (const city of CITIES) {
    const m = cams.get(city.id);
    history.cities[city.id] = {
      model: m ? { pm25: m.series.pm25, aqi: m.hourlyAqi } : null
    };
  }
  await fs.writeFile(path.join(DATA, "history.json"), JSON.stringify(history));
  await fs.writeFile(path.join(DATA, "cities.json"), JSON.stringify(CITIES.map(({ slugs, ...c }) => c), null, 2));

  console.log(`Wrote latest.json (${ranked.length} ranked cities) and history.json`);
  console.log(`National average AQI: ${latest.national.avgAqi}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
// Data + methodology audit for the India Air Quality Tracker.
// Usage: node scripts/audit.mjs [--verbose]
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CITIES } from "./lib/cities.mjs";
import { categoryOf, subIndex, CATEGORIES } from "./lib/aqi.mjs";
import { normalizeCity } from "./lib/cpcb.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const VERBOSE = process.argv.includes("--verbose");

const errors = [];
const warnings = [];
const passes = [];
const stats = {};

function ok(cond, msg) {
  if (cond) passes.push(msg);
  else errors.push(msg);
}
function warn(cond, msg) {
  if (!cond) warnings.push(msg);
}
function summarize(label, value) {
  stats[label] = value;
}
async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const close = (a, b, tol = 0.25) => a != null && b != null && Math.abs(a - b) <= tol;
const parseIST = (s) => {
  if (!s) return null;
  const raw = String(s);
  const hasZone = /[zZ]$|[+-]\d{2}:\d{2}$/.test(raw);
  const normalized = hasZone ? raw : raw.length === 16 ? `${raw}:00+05:30` : `${raw}+05:30`;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
};
const hoursAgo = (d) => (d ? (Date.now() - d.getTime()) / 3600000 : null);

/* ------------------------------------------------------------------ */
/* 1. AQI methodology test vectors                                     */
/* ------------------------------------------------------------------ */
const vectors = [
  ["pm25", 0, 0], ["pm25", 30, 50], ["pm25", 60, 100], ["pm25", 90, 200],
  ["pm25", 120, 300], ["pm25", 250, 400], ["pm25", 500, 500],
  ["pm10", 50, 50], ["pm10", 100, 100], ["pm10", 250, 200], ["pm10", 430, 400],
  ["no2", 40, 50], ["so2", 80, 100], ["co", 1, 50], ["co", 2, 100],
  ["o3", 100, 100], ["nh3", 400, 100]
];
for (const [p, v, expected] of vectors) {
  const got = subIndex(p, v);
  ok(got === expected, `AQI vector ${p}=${v} -> ${got} (expected ${expected})`);
}
ok(categoryOf(50).name === "Good", "Category boundary 50 = Good");
ok(categoryOf(51).name === "Satisfactory", "Category boundary 51 = Satisfactory");
ok(categoryOf(300).name === "Poor", "Category boundary 300 = Poor");
ok(categoryOf(401).name === "Severe", "Category boundary 401 = Severe");
ok(CATEGORIES.length === 6, "Six CPCB categories defined");

// Ambiguous city names must not collide across states.
ok(normalizeCity("Aurangabad (Bihar)") === "aurangabad-bihar", "Aurangabad (Bihar) normalized distinctly");
ok(normalizeCity("Aurangabad (Maharashtra)") === "aurangabad", "Aurangabad (Maharashtra) normalized to city id");
ok(normalizeCity("Greater Noida") === "greater-noida", "Greater Noida not merged into Noida");
ok(normalizeCity("Navi Mumbai") === "navi-mumbai", "Navi Mumbai not merged into Mumbai");
ok(normalizeCity("Bangalore") === "bengaluru", "Bangalore alias normalized");

/* ------------------------------------------------------------------ */
/* 2. Static city config + generated metadata                          */
/* ------------------------------------------------------------------ */
const cities = await readJson(path.join(DATA, "cities.json"));
const latest = await readJson(path.join(DATA, "latest.json"));
const history = await readJson(path.join(DATA, "history.json"));
const diwali = await readJson(path.join(DATA, "diwali.json"));
const waqi = await readJson(path.join(DATA, "waqi-index.json"));

const ids = new Set(CITIES.map((c) => c.id));
ok(ids.size === CITIES.length, `City ids unique (${CITIES.length})`);
ok(cities.length === CITIES.length, `cities.json count ${cities.length} = ${CITIES.length}`);
const tierCounts = CITIES.reduce((acc, c) => ((acc[c.tier] = (acc[c.tier] || 0) + 1), acc), {});
summarize("cities", { total: CITIES.length, ...tierCounts });
ok(tierCounts[1] === 8, `Tier 1 count ${tierCounts[1]} (expected 8)`);
ok(tierCounts[2] >= 25, `Tier 2 count ${tierCounts[2]} (>=25)`);
ok(tierCounts[3] >= 30, `Tier 3 count ${tierCounts[3]} (>=30)`);
for (const c of CITIES) {
  ok(c.lat >= 6 && c.lat <= 38 && c.lon >= 68 && c.lon <= 98, `${c.name} coordinates inside India bbox`);
}
const cityIds = new Set(cities.map((c) => c.id));
ok(cityIds.size === cities.length, "cities.json has no duplicate ids");
ok([...ids].every((id) => cityIds.has(id)), "cities.json covers every configured city");

/* ------------------------------------------------------------------ */
/* 3. latest.json                                                      */
/* ------------------------------------------------------------------ */
const gen = parseIST(latest.generatedAt);
ok(gen != null, "latest.generatedAt is a valid timestamp");
const age = hoursAgo(gen);
summarize("latestAgeHours", round1(age));
warn(age != null && age < 6, `latest.json is ${round1(age)}h old (expected <6h)`);
ok(latest.cities.length === CITIES.length, `latest.json has ${latest.cities.length} cities`);
ok(new Set(latest.cities.map((c) => c.id)).size === latest.cities.length, "latest.json city ids unique");

const allowedSources = new Set(["cpcb-bulletin", "cams", "cpcb", null]);
let sourceCounts = { bulletin: 0, cams: 0, station: 0, none: 0 };
let staleStations = 0;
let stationMismatch = 0;
let categoryMismatch = 0;
let nullAqi = 0;

for (const c of latest.cities) {
  ok(Number.isInteger(c.aqi) && c.aqi >= 0 && c.aqi <= 500, `${c.name} AQI valid (${c.aqi})`);
  if (c.aqi == null) nullAqi++;
  ok(allowedSources.has(c.primarySource), `${c.name} primarySource valid (${c.primarySource})`);
  ok(c.tier === 1 || c.tier === 2 || c.tier === 3, `${c.name} tier valid`);

  if (c.primarySource === "cpcb-bulletin") {
    sourceCounts.bulletin++;
    ok(c.bulletin && c.aqi === c.bulletin.aqi, `${c.name} headline equals bulletin AQI`);
    ok(c.bulletin?.pollutant == null || c.dominant === c.bulletin.pollutant, `${c.name} dominant pollutant matches bulletin`);
    if (c.bulletin) {
      const cat = categoryOf(c.bulletin.aqi).name;
      if (cat !== c.bulletin.category) {
        categoryMismatch++;
        errors.push(`${c.name} bulletin category ${c.bulletin.category} != derived ${cat} for AQI ${c.bulletin.aqi}`);
      }
      warn(parseIST(`${c.bulletin.date}T00:00:00+05:30`) != null, `${c.name} bulletin date parseable`);
    }
  } else if (c.primarySource === "cams") {
    sourceCounts.cams++;
    ok(c.model && c.aqi === c.model.aqi, `${c.name} headline equals CAMS AQI`);
  } else if (c.primarySource === "cpcb") {
    sourceCounts.station++;
    ok(c.station && c.aqi === c.station.aqi, `${c.name} headline equals station AQI`);
  } else {
    sourceCounts.none++;
  }

  if (c.station?.updatedAt) {
    const t = parseIST(c.station.updatedAt);
    const ageH = hoursAgo(t);
    const fresh = ageH != null && ageH <= 6;
    if (!fresh) staleStations++;
    ok(c.station.stale === !fresh, `${c.name} station freshness flag consistent`);
    if (fresh) {
      // WAQI/CPCB headline is a different standard; only check rough plausibility.
      if (c.bulletin && Math.abs(c.station.aqi - c.bulletin.aqi) > 250) stationMismatch++;
    }
    if (c.primarySource === "cpcb") ok(fresh, `${c.name} stale station is not used as headline`);
  }
  if (c.model?.pollutants) {
    for (const [p, v] of Object.entries(c.model.pollutants)) {
      ok(v == null || (v >= 0 && v < 5000), `${c.name} model ${p} plausible (${v})`);
    }
    ok(c.model.pollutants.co == null || c.model.pollutants.co < 100, `${c.name} model CO in mg/m³ range`);
  }
  if (c.model?.aqi != null) ok(c.model.aqi >= 0 && c.model.aqi <= 500, `${c.name} CAMS AQI in range`);
  if (c.station?.aqi != null) ok(c.station.aqi >= 0 && c.station.aqi <= 500, `${c.name} station AQI in range`);
}
summarize("headlineSources", sourceCounts);
summarize("staleStations", staleStations);
summarize("stationBulletinGapOver250", stationMismatch);

const ranked = latest.cities.filter((c) => c.aqi != null);
const avg = Math.round(mean(ranked.map((c) => c.aqi)));
ok(avg === latest.national.avgAqi, `National average ${latest.national.avgAqi} = recomputed ${avg}`);
ok(latest.national.worst?.aqi === Math.max(...ranked.map((c) => c.aqi)), "Worst city matches max AQI");
ok(latest.national.best?.aqi === Math.min(...ranked.map((c) => c.aqi)), "Best city matches min AQI");
const freshStationCities = latest.cities.filter((c) => c.station && !c.station.stale).length;
ok(latest.national.stationCount === freshStationCities, `stationCount ${latest.national.stationCount} = fresh stations ${freshStationCities}`);
ok(latest.national.stationMappedCount >= latest.national.stationCount, "mapped stations >= fresh stations");
warn(staleStations === 0, `${staleStations} mapped stations are stale (>6h) and excluded from the live count`);
warn(latest.sources?.cpcb?.status === "ok", `CPCB station source status is ${latest.sources?.cpcb?.status}`);
ok(["ok", "partial", "unavailable"].includes(latest.sources?.cams?.status), `CAMS source status valid (${latest.sources?.cams?.status})`);
summarize("nationalAvg", latest.national.avgAqi);

/* ------------------------------------------------------------------ */
/* 4. history.json                                                     */
/* ------------------------------------------------------------------ */
const hours = history.hours || [];
summarize("historyHours", hours.length);
ok(hours.length >= 48 && hours.length <= 96, `history has ${hours.length} hourly points`);
const sorted = hours.every((h, i) => i === 0 || h > hours[i - 1]);
ok(sorted, "history hours strictly ascending");
const lastHour = parseIST(hours[hours.length - 1]);
warn(lastHour && Math.abs(hoursAgo(lastHour)) < 4, `history ends ${round1(hoursAgo(lastHour))}h from now`);
ok(Object.keys(history.cities).length === CITIES.length, `history covers ${Object.keys(history.cities).length} cities`);

let seriesMismatch = 0;
let historyAqiBelowPm25 = 0;
let lastHourAqiGap = 0;
for (const c of latest.cities) {
  const h = history.cities[c.id];
  if (!h?.model) continue;
  if (h.model.aqi.length !== hours.length || h.model.pm25.length !== hours.length) seriesMismatch++;
  h.model.aqi.forEach((v, i) => {
    if (v == null) return;
    if (v < 0 || v > 500) errors.push(`${c.name} history AQI out of range at ${hours[i]}: ${v}`);
    const pmSi = subIndex("pm25", h.model.pm25[i]);
    if (pmSi != null && v < pmSi) historyAqiBelowPm25++;
  });
  const lastHistoryAqi = [...h.model.aqi].reverse().find((v) => v != null);
  if (c.model?.aqiNow != null && lastHistoryAqi != null && c.model.aqiNow - lastHistoryAqi > 25) {
    lastHourAqiGap++;
  }
}
ok(seriesMismatch === 0, `history series lengths align (${seriesMismatch} mismatches)`);
ok(historyAqiBelowPm25 === 0, `hourly AQI >= PM2.5 sub-index (${historyAqiBelowPm25} violations)`);
warn(lastHourAqiGap === 0, `${lastHourAqiGap} cities have current AQI > hourly trend by 25+ (possible missing pollutant in hourly AQI)`);
summarize("hourlyAqiGapCities", lastHourAqiGap);

/* ------------------------------------------------------------------ */
/* 5. Diwali study                                                     */
/* ------------------------------------------------------------------ */
const y25 = diwali.y2025;
const y26 = diwali.y2026;
ok(y25?.date === "2025-10-20", `Diwali 2025 date ${y25?.date}`);
ok(y26?.date === "2026-11-08", `Diwali 2026 date ${y26?.date}`);
ok(["official", "pending"].includes(y26?.status), `2026 status valid (${y26?.status})`);
ok(y25?.status === "official", "2025 study uses official bulletins");
ok(y25?.summary?.citiesCompared >= 50, `2025 compared ${y25?.summary?.citiesCompared} cities (>=50)`);
ok(y25?.cities?.length === CITIES.length, `2025 city rows ${y25?.cities?.length}`);
ok(new Set((y25?.cities || []).map((c) => c.id)).size === CITIES.length, "2025 city ids unique");

let diwaliMath = 0;
let diwaliRange = 0;
for (const c of y25.cities) {
  if (c.baselineAqi != null) ok(c.baselineAqi >= 0 && c.baselineAqi <= 500, `2025 ${c.name} baseline in range`);
  if (c.diwaliAqi != null) {
    if (c.diwaliAqi < 0 || c.diwaliAqi > 500) diwaliRange++;
    if (!close(c.changePct, ((c.diwaliAqi - c.baselineAqi) / c.baselineAqi) * 100, 0.2)) diwaliMath++;
  }
}
ok(diwaliMath === 0, `2025 change percentages consistent (${diwaliMath} mismatches)`);
ok(diwaliRange === 0, `2025 Diwali AQI values in range (${diwaliRange} out of range)`);

const scored25 = y25.cities.filter((c) => c.baselineAqi != null && c.diwaliAqi != null);
const baselineOnly25 = y25.cities.filter((c) => c.baselineAqi != null);
ok(y25.summary.citiesCompared === scored25.length, "2025 summary count matches rows");
ok(close(y25.summary.avgBaselineAqi, round1(mean(scored25.map((c) => c.baselineAqi))), 0.2), "2025 avg baseline consistent");
ok(close(y25.summary.avgBaselineAvailable, round1(mean(baselineOnly25.map((c) => c.baselineAqi))), 0.2), "2025 available baseline consistent");
ok(close(y25.summary.avgDiwaliAqi, round1(mean(scored25.map((c) => c.diwaliAqi))), 0.2), "2025 avg Diwali AQI consistent");
ok(close(y25.summary.avgChangePct, round1(mean(scored25.map((c) => c.changePct))), 0.2), "2025 avg change consistent");
ok(y25.summary.citiesUp20 === scored25.filter((c) => c.changePct > 20).length, "2025 >20% count consistent");
summarize("diwali2025", {
  compared: y25.summary.citiesCompared,
  avgBaseline: y25.summary.avgBaselineAqi,
  avgDiwali: y25.summary.avgDiwaliAqi,
  avgChangePct: y25.summary.avgChangePct,
  up20: y25.summary.citiesUp20
});
summarize("diwali2026", {
  status: y26.status,
  baseline: y26.summary.avgBaselineAvailable,
  citiesWithBaseline: y26.cities.filter((c) => c.baselineAqi != null).length
});
ok(y26.summary.avgBaselineAqi != null || y26.summary.avgBaselineAvailable != null, "2026 pre-Diwali baseline available");

const missing2025 = y25.cities.filter((c) => c.diwaliAqi == null).map((c) => c.name);
summarize("diwali2025Missing", missing2025);

/* ------------------------------------------------------------------ */
/* 6. Cached CPCB bulletins                                            */
/* ------------------------------------------------------------------ */
const bulletinDir = path.join(DATA, "cache", "bulletins");
let bulletinFiles = [];
try {
  bulletinFiles = (await fs.readdir(bulletinDir)).filter((f) => f.endsWith(".json")).sort();
} catch {}
summarize("cachedBulletins", bulletinFiles.length);
ok(bulletinFiles.length >= 10, `cached bulletins present (${bulletinFiles.length})`);

let bulletinRows = 0;
let bulletinCategoryMismatch = 0;
let bulletinDuplicates = 0;
let bulletinBadRange = 0;
const expected = {
  "2025-10-21": { delhi: 351, mumbai: 211, chennai: 142, kolkata: 174, patna: 226 }
};
for (const f of bulletinFiles) {
  const date = f.replace(".json", "");
  const b = await readJson(path.join(bulletinDir, f));
  ok(b.count === b.cities.length, `${date} bulletin count matches rows`);
  ok(b.count >= 200, `${date} bulletin has ${b.count} cities (>=200)`);
  const names = new Set();
  for (const row of b.cities) {
    bulletinRows++;
    if (names.has(row.normalized)) bulletinDuplicates++;
    names.add(row.normalized);
    if (row.aqi < 0 || row.aqi > 500) bulletinBadRange++;
    if (categoryOf(row.aqi).name !== row.category) bulletinCategoryMismatch++;
    if (row.stations.reporting > row.stations.total) bulletinBadRange++;
    if (![null, "PM2.5", "PM10", "NO2", "SO2", "NH3", "O3", "CO"].includes(row.pollutant)) {
      errors.push(`${date} invalid pollutant ${row.pollutant} for ${row.name}`);
    }
  }
  if (expected[date]) {
    for (const [id, aqi] of Object.entries(expected[date])) {
      const row = b.cities.find((r) => r.normalized === id);
      ok(row?.aqi === aqi, `${date} spot-check ${id} = ${row?.aqi} (expected ${aqi})`);
    }
  }
}
ok(bulletinDuplicates === 0, `bulletin duplicate cities (${bulletinDuplicates})`);
ok(bulletinCategoryMismatch === 0, `bulletin category/AQI mismatches (${bulletinCategoryMismatch})`);
ok(bulletinBadRange === 0, `bulletin out-of-range values (${bulletinBadRange})`);
summarize("bulletinRows", bulletinRows);

/* ------------------------------------------------------------------ */
/* 7. Live station index                                               */
/* ------------------------------------------------------------------ */
const waqiEntries = Object.entries(waqi);
summarize("waqiMappedCities", waqiEntries.length);
for (const [id, v] of waqiEntries) {
  ok(ids.has(id), `WAQI mapping id ${id} is a known city`);
  ok(Number.isInteger(v.idx) && v.idx > 0, `WAQI ${id} station id valid`);
}
const idxValues = waqiEntries.map(([, v]) => v.idx);
ok(new Set(idxValues).size === idxValues.length, "WAQI station ids not duplicated");

/* ------------------------------------------------------------------ */
/* 8. Files referenced by the site                                     */
/* ------------------------------------------------------------------ */
for (const f of ["index.html", "assets/app.js", "assets/styles.css", ".nojekyll", "data/latest.json", "data/history.json", "data/diwali.json"]) {
  try {
    await fs.access(path.join(ROOT, f));
    passes.push(`site file exists: ${f}`);
  } catch {
    errors.push(`missing site file: ${f}`);
  }
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */
console.log("\n=== INDIA AQI TRACKER AUDIT ===\n");
console.log("Stats:");
for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
console.log(`\nChecks passed: ${passes.length}`);
console.log(`Warnings: ${warnings.length}`);
console.log(`Errors: ${errors.length}`);

if (warnings.length) {
  console.log("\nWarnings:");
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (errors.length) {
  console.log("\nErrors:");
  for (const e of errors) console.log(`  x ${e}`);
}
if (VERBOSE) {
  console.log("\nPassed checks:");
  for (const p of passes) console.log(`  + ${p}`);
}

process.exit(errors.length ? 1 : 0);

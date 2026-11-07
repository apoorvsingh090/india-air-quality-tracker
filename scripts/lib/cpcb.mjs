import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pdf from "pdf-parse/lib/pdf-parse.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE = path.join(ROOT, "data", "cache", "bulletins");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) india-aqi-tracker/1.0";

const CATEGORY_RE = "Good|Satisfactory|Moderate|Poor|Very Poor|Severe";

const ALIASES = {
  bangalore: "bengaluru",
  mysore: "mysuru",
  mangalore: "mangaluru",
  hubli: "hubballi",
  trivandrum: "thiruvananthapuram",
  cochin: "kochi",
  allahabad: "prayagraj",
  gurgaon: "gurugram",
  baroda: "vadodara",
  nasik: "nashik",
  vizag: "visakhapatnam",
  calicut: "kozhikode",
  trichy: "tiruchirappalli",
  tiruchirapalli: "tiruchirappalli",
  "greater noida": "noida",
  "navi mumbai": "mumbai"
};

export function normalizeCity(name) {
  let n = name
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return ALIASES[n] || n;
}

function pollutantFrom(chunk) {
  const s = chunk.replace(/\s+/g, " ");
  if (/PM\s*2\.5/.test(s)) return "PM2.5";
  if (/PM\s*10/.test(s)) return "PM10";
  if (/NO\s*2/.test(s)) return "NO2";
  if (/SO\s*2/.test(s)) return "SO2";
  if (/NH\s*3/.test(s)) return "NH3";
  if (/O\s*3/.test(s)) return "O3";
  if (/CO/.test(s)) return "CO";
  return null;
}

function parseText(text) {
  const rows = [];
  const re = new RegExp(
    `(\\d{1,3})\\s*([A-Za-z][A-Za-z .()&'\\-\\n\\r]*?)\\s*(${CATEGORY_RE})\\s*(\\d{1,3})([\\s\\S]{0,60}?)(\\d+)\\s*\\/\\s*(\\d+)`,
    "g"
  );
  for (const m of text.matchAll(re)) {
    const name = m[2].replace(/\s+/g, " ").trim();
    if (!name || name.length < 3) continue;
    rows.push({
      name,
      normalized: normalizeCity(name),
      category: m[3],
      aqi: Number(m[4]),
      pollutant: pollutantFrom(m[5]),
      stations: { reporting: Number(m[6]), total: Number(m[7]) }
    });
  }
  return rows;
}

export async function fetchBulletin(dateStr, { useCache = true } = {}) {
  const cacheFile = path.join(CACHE, `${dateStr}.json`);
  if (useCache) {
    try {
      return JSON.parse(await fs.readFile(cacheFile, "utf8"));
    } catch {
      // not cached
    }
  }
  const compact = dateStr.replace(/-/g, "");
  const url = `https://cpcb.gov.in/upload/Downloads/AQI_Bulletin_${compact}.pdf`;
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`bulletin ${dateStr}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const parsed = await pdf(buf);
  const text = parsed.text;
  const header = text.match(/Air Quality Index on\s+([A-Za-z]{3}\s+\d{1,2},\s+\d{4})\s*@\s*([0-9: APM]+)/i);
  const cities = parseText(text);
  // De-duplicate by city, keeping the first (highest serial) occurrence.
  const seen = new Set();
  const unique = [];
  for (const row of cities) {
    if (seen.has(row.normalized)) continue;
    seen.add(row.normalized);
    unique.push(row);
  }
  const out = {
    date: dateStr,
    aqiOn: header ? header[1] : dateStr,
    aqiAt: header ? header[2].trim() : null,
    url,
    count: unique.length,
    cities: unique
  };
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(out));
  return out;
}

export async function bulletinDates(startDate, endDate) {
  const out = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

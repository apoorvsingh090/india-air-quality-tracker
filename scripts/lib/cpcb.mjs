import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pdf from "pdf-parse/lib/pdf-parse.js";
import { atomicWriteJson } from "./fsx.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE = path.join(ROOT, "data", "cache", "bulletins");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) india-aqi-tracker/1.0";
const PARSER_VERSION = 3;

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
  tiruchirapalli: "tiruchirappalli"
};

// Names that need their qualifier kept (or resolved) so distinct cities never collide.
const QUALIFIED_ALIASES = {
  "aurangabad (maharashtra)": "aurangabad",
  "aurangabad (bihar)": "aurangabad-bihar",
  "greater noida": "greater-noida",
  "navi mumbai": "navi-mumbai"
};

export function normalizeCity(name) {
  const lower = name.replace(/\s+/g, " ").trim().toLowerCase();
  if (QUALIFIED_ALIASES[lower]) return QUALIFIED_ALIASES[lower];
  const paren = lower.match(/\(([^)]+)\)/);
  if (paren) {
    const base = lower.replace(/\([^)]*\)/g, "").trim();
    const qualifier = paren[1].trim().replace(/\s+/g, "-");
    return `${base}-${qualifier}`;
  }
  return ALIASES[lower] || lower;
}

function pollutantFrom(chunk) {
  const s = chunk.replace(/\s+/g, " ");
  const m = s.match(/PM\s*2\.5|PM\s*10|NO\s*2|SO\s*2|NH\s*3|O\s*3|CO/);
  if (!m) return null;
  const token = m[0].replace(/\s+/g, "");
  return { "PM2.5": "PM2.5", PM10: "PM10", NO2: "NO2", SO2: "SO2", NH3: "NH3", O3: "O3", CO: "CO" }[token] || null;
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
      const cached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
      if (cached.parserVersion === PARSER_VERSION && cached.count >= 50 && cached.cities?.length === cached.count) return cached;
    } catch {
      // not cached, or cache is incomplete: refetch
    }
  }
  const compact = dateStr.replace(/-/g, "");
  const url = `https://cpcb.gov.in/upload/Downloads/AQI_Bulletin_${compact}.pdf`;
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`bulletin ${dateStr}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 20 * 1024 * 1024) throw new Error(`bulletin PDF too large (${buf.length} bytes)`);
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
    parserVersion: PARSER_VERSION,
    date: dateStr,
    aqiOn: header ? header[1] : dateStr,
    aqiAt: header ? header[2].trim() : null,
    url,
    count: unique.length,
    cities: unique
  };
  await fs.mkdir(CACHE, { recursive: true });
  await atomicWriteJson(cacheFile, out);
  return out;
}

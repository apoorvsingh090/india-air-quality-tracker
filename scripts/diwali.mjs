import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CITIES } from "./lib/cities.mjs";
import { fetchBulletin } from "./lib/cpcb.mjs";
import { atomicWriteJson } from "./lib/fsx.mjs";
import { buildYear } from "./lib/diwali.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");

// Diwali dates (Lakshmi Puja evening). CPCB bulletins are 24h averages ending 4 PM IST,
// so the D+1 bulletin covers Diwali evening and night.
const DIWALI = {
  "2025": {
    date: "2025-10-20",
    baseline: ["2025-10-13", "2025-10-14", "2025-10-15", "2025-10-16", "2025-10-17", "2025-10-18", "2025-10-19"],
    impact: "2025-10-21"
  },
  "2026": {
    date: "2026-11-08",
    baseline: ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"],
    impact: "2026-11-09"
  }
};

async function loadBulletins(dates) {
  const map = new Map();
  for (const d of dates) {
    try {
      map.set(d, await fetchBulletin(d));
    } catch (e) {
      // bulletins can lag by a day; missing dates are simply skipped, but not silently
      console.error(`Diwali bulletin ${d} unavailable: ${e?.message ?? e}`);
    }
  }
  return map;
}

async function main() {
  const now = new Date();
  console.log("Diwali study: loading CPCB AQI bulletins...");

  const dates2025 = [...DIWALI["2025"].baseline, DIWALI["2025"].impact];
  const dates2026 = [...DIWALI["2026"].baseline, DIWALI["2026"].impact];
  const [b2025, b2026] = await Promise.all([loadBulletins(dates2025), loadBulletins(dates2026)]);
  console.log(`Bulletins: 2025=${b2025.size}/${dates2025.length}, 2026=${b2026.size}/${dates2026.length}`);

  const y2025 = buildYear(CITIES, b2025, DIWALI["2025"].impact);
  const y2026 = buildYear(CITIES, b2026, DIWALI["2026"].impact);
  const status2026 = b2026.has(DIWALI["2026"].impact) ? "official" : "pending";

  const out = {
    generatedAt: now.toISOString(),
    diwali: DIWALI,
    method: {
      baseline: "Mean official CPCB city AQI over the 7 daily bulletins before Diwali (each a 24h average ending 4 PM IST).",
      impact: "Official CPCB AQI from the D+1 bulletin, whose 24h averaging window covers Diwali evening and night in each city.",
      source: "Central Pollution Control Board daily National AQI Bulletin (cpcb.gov.in).",
      caveat: "AQI is a 24-hour city average, so it smooths the sharpest hourly firecracker peaks. Station-level hourly peaks can be higher."
    },
    y2025: {
      date: DIWALI["2025"].date,
      impactDate: DIWALI["2025"].impact,
      status: b2025.has(DIWALI["2025"].impact) ? "official" : "pending",
      ...y2025
    },
    y2026: {
      date: DIWALI["2026"].date,
      impactDate: DIWALI["2026"].impact,
      status: status2026,
      note:
        status2026 === "pending"
          ? "The CPCB bulletin covering Diwali night is published on 9 Nov 2026 (evening). This page fills in automatically."
          : null,
      ...y2026
    }
  };

  await fs.mkdir(DATA, { recursive: true });
  await atomicWriteJson(path.join(DATA, "diwali.json"), out);
  console.log(`Wrote diwali.json — 2025 avg change ${out.y2025.summary.avgChangePct}% across ${out.y2025.summary.citiesCompared} cities; 2026 status ${status2026}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

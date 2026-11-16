import test from "node:test";
import assert from "node:assert/strict";
import { buildYear } from "../scripts/lib/diwali.mjs";

const city = { id: "delhi", name: "Delhi", state: "Delhi", tier: 1 };

const row = (aqi) => ({
  normalized: "delhi",
  aqi,
  category: "Poor",
  pollutant: "PM2.5",
  stations: { reporting: 1, total: 1 }
});

const bulletin = (aqi) => ({ cities: [row(aqi)] });

const BASELINE_DATES = [
  "2026-11-01",
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
  "2026-11-06",
  "2026-11-07"
];
const IMPACT = "2026-11-09";

test("baseline excludes the Diwali-night (impact) bulletin", () => {
  const bulletins = new Map(BASELINE_DATES.map((d) => [d, bulletin(100)]));
  bulletins.set(IMPACT, bulletin(300));

  const { summary, cities } = buildYear([city], bulletins, IMPACT);

  // 7 x 100 pre-Diwali; including the 300 impact day would wrongly give 125.
  assert.equal(cities[0].baselineAqi, 100);
  assert.equal(cities[0].diwaliAqi, 300);
  assert.equal(cities[0].changePct, 200);
  assert.equal(summary.avgBaselineAqi, 100);
  assert.equal(summary.avgDiwaliAqi, 300);
  assert.equal(summary.avgChangePct, 200);
});

test("impact bulletin inserted before the baseline dates is still excluded", () => {
  const bulletins = new Map();
  bulletins.set(IMPACT, bulletin(300));
  for (const d of BASELINE_DATES) bulletins.set(d, bulletin(100));

  assert.equal(buildYear([city], bulletins, IMPACT).summary.avgBaselineAqi, 100);
});

test("a missing pre-Diwali day averages the days that do exist", () => {
  const bulletins = new Map();
  for (const d of BASELINE_DATES.slice(0, 5)) bulletins.set(d, bulletin(100));
  bulletins.set(BASELINE_DATES[6], bulletin(200));
  bulletins.set(IMPACT, bulletin(300));

  // 5 x 100 + 1 x 200 = 700 / 6 = 116.7 (the 300 impact day is not included).
  assert.equal(buildYear([city], bulletins, IMPACT).cities[0].baselineAqi, 116.7);
});

test("a city with no impact reading is excluded from the comparison", () => {
  const bulletins = new Map(BASELINE_DATES.map((d) => [d, bulletin(100)]));
  bulletins.set(IMPACT, { cities: [{ ...row(300), normalized: "mumbai" }] });

  const { summary, cities } = buildYear([city], bulletins, IMPACT);
  assert.equal(cities[0].diwaliAqi, null);
  assert.equal(cities[0].changePct, null);
  assert.equal(summary.citiesCompared, 0);
  // The baseline is still published even though there is nothing to compare.
  assert.equal(summary.avgBaselineAvailable, 100);
});

test("without an impact bulletin the study is pending but keeps baselines", () => {
  const bulletins = new Map(BASELINE_DATES.map((d) => [d, bulletin(100)]));
  const { summary } = buildYear([city], bulletins, IMPACT);
  assert.equal(summary.avgBaselineAqi, null);
  assert.equal(summary.avgBaselineAvailable, 100);
});

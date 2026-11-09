import test from "node:test";
import assert from "node:assert/strict";
import { subIndex, categoryOf, computeAqi, CATEGORIES } from "../scripts/lib/aqi.mjs";

test("sub-index vectors match CPCB methodology", () => {
  const vectors = [
    ["pm25", 0, 0], ["pm25", 30, 50], ["pm25", 60, 100], ["pm25", 90, 200],
    ["pm25", 120, 300], ["pm25", 250, 400], ["pm25", 500, 500],
    ["pm10", 50, 50], ["pm10", 100, 100], ["pm10", 250, 200], ["pm10", 430, 400],
    ["no2", 40, 50], ["so2", 80, 100], ["co", 1, 50], ["co", 2, 100],
    ["o3", 100, 100], ["nh3", 400, 100],
  ];
  for (const [p, v, expected] of vectors) {
    assert.equal(subIndex(p, v), expected, `${p}=${v}`);
  }
});

test("categoryOf boundaries", () => {
  assert.equal(categoryOf(50).name, "Good");
  assert.equal(categoryOf(51).name, "Satisfactory");
  assert.equal(categoryOf(300).name, "Poor");
  assert.equal(categoryOf(401).name, "Severe");
  assert.equal(CATEGORIES.length, 6);
});

test("subIndex clamps out-of-range highs", () => {
  assert.equal(subIndex("pm25", 9999), 500);
});

test("subIndex rejects negative/NaN", () => {
  assert.equal(subIndex("pm25", -1), null);
  assert.equal(subIndex("pm25", NaN), null);
});

test("computeAqi returns the worst sub-index and marks the dominant pollutant", () => {
  const r = computeAqi({ pm25: 60, pm10: 250, no2: 20 });
  assert.equal(r.aqi, 200);
  assert.equal(r.dominant, "pm10");
});

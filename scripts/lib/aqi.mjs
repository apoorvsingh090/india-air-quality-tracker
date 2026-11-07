// CPCB (India) National Air Quality Index, 2014 breakpoints.
// Sub-index is computed by linear interpolation inside the breakpoint band.
// Reference: CPCB "National Air Quality Index" report, Oct 2014.

const BREAKPOINTS = {
  pm25: { unit: "µg/m³", avg: "24h", bands: [[0, 30, 0, 50], [30, 60, 51, 100], [60, 90, 101, 200], [90, 120, 201, 300], [120, 250, 301, 400], [250, 500, 401, 500]] },
  pm10: { unit: "µg/m³", avg: "24h", bands: [[0, 50, 0, 50], [50, 100, 51, 100], [100, 250, 101, 200], [250, 350, 201, 300], [350, 430, 301, 400], [430, 600, 401, 500]] },
  no2: { unit: "µg/m³", avg: "24h", bands: [[0, 40, 0, 50], [40, 80, 51, 100], [80, 180, 101, 200], [180, 280, 201, 300], [280, 400, 301, 400], [400, 600, 401, 500]] },
  so2: { unit: "µg/m³", avg: "24h", bands: [[0, 40, 0, 50], [40, 80, 51, 100], [80, 380, 101, 200], [380, 800, 201, 300], [800, 1600, 301, 400], [1600, 2000, 401, 500]] },
  co: { unit: "mg/m³", avg: "8h", bands: [[0, 1, 0, 50], [1, 2, 51, 100], [2, 10, 101, 200], [10, 17, 201, 300], [17, 34, 301, 400], [34, 50, 401, 500]] },
  o3: { unit: "µg/m³", avg: "8h", bands: [[0, 50, 0, 50], [50, 100, 51, 100], [100, 168, 101, 200], [168, 208, 201, 300], [208, 748, 301, 400], [748, 1000, 401, 500]] },
  nh3: { unit: "µg/m³", avg: "24h", bands: [[0, 200, 0, 50], [200, 400, 51, 100], [400, 800, 101, 200], [800, 1200, 201, 300], [1200, 1800, 301, 400], [1800, 2000, 401, 500]] }
};

export const POLLUTANTS = Object.keys(BREAKPOINTS);

export const CATEGORIES = [
  { max: 50, name: "Good", color: "#22c55e", advisory: "Minimal impact. Air quality is satisfactory." },
  { max: 100, name: "Satisfactory", color: "#84cc16", advisory: "Minor breathing discomfort to sensitive people." },
  { max: 200, name: "Moderate", color: "#f59e0b", advisory: "Breathing discomfort to people with asthma, heart or lung disease." },
  { max: 300, name: "Poor", color: "#f97316", advisory: "Breathing discomfort to most people on prolonged exposure." },
  { max: 400, name: "Very Poor", color: "#ef4444", advisory: "Respiratory illness on prolonged exposure. Avoid outdoor exercise." },
  { max: 500, name: "Severe", color: "#b91c1c", advisory: "Health emergency. Everyone should avoid outdoor activity." }
];

export function categoryOf(aqi) {
  if (aqi == null || Number.isNaN(aqi)) return { name: "No data", color: "#64748b", advisory: "No recent measurement available." };
  return CATEGORIES.find((c) => aqi <= c.max) || CATEGORIES[CATEGORIES.length - 1];
}

export function subIndex(pollutant, value) {
  const spec = BREAKPOINTS[pollutant];
  if (!spec || value == null || Number.isNaN(value) || value < 0) return null;
  const bands = spec.bands;
  const top = bands[bands.length - 1][1];
  const v = Math.min(value, top);
  for (const [clo, chi, ilo, ihi] of bands) {
    if (v >= clo && v <= chi) {
      const si = ((ihi - ilo) / (chi - clo)) * (v - clo) + ilo;
      return Math.round(Math.max(0, Math.min(500, si)));
    }
  }
  return 500;
}

// concentrations: { pm25, pm10, no2, so2, co (mg/m3), o3, nh3 }
export function computeAqi(concentrations) {
  const subIndices = {};
  let aqi = 0;
  let dominant = null;
  for (const p of POLLUTANTS) {
    const si = subIndex(p, concentrations[p]);
    if (si == null) continue;
    subIndices[p] = si;
    if (si > aqi) {
      aqi = si;
      dominant = p;
    }
  }
  if (!dominant) return { aqi: null, dominant: null, subIndices };
  return { aqi, dominant, subIndices };
}

// CAMS surface ozone is reported in µg/m³ by Open-Meteo; CO in µg/m³.
export const ugm3ToMgm3 = (v) => (v == null ? null : v / 1000);

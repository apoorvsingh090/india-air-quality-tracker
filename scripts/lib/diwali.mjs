// Diwali impact study maths, kept pure so it can be unit-tested.
//
// The study compares each city's official CPCB AQI on the bulletin covering
// Diwali night (the "impact" bulletin, dated D+1) with the mean of the seven
// daily bulletins published *before* Diwali.

export const mean = (a) => {
  const v = a.filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
};

export const round = (v, d = 1) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

export const pct = (now, base) => (now == null || base == null || base === 0 ? null : ((now - base) / base) * 100);

// bulletins: Map<date, parsed bulletin>. The impact date is the Diwali-night
// measurement, so it must never contribute to the pre-Diwali baseline.
export function buildYear(cities, bulletins, impactDate) {
  const impactBulletin = bulletins.get(impactDate) || null;

  const baselineByCity = new Map();
  for (const [date, b] of bulletins) {
    if (date === impactDate) continue;
    for (const row of b.cities) {
      if (!baselineByCity.has(row.normalized)) baselineByCity.set(row.normalized, []);
      baselineByCity.get(row.normalized).push(row.aqi);
    }
  }

  const impactByCity = new Map();
  if (impactBulletin) for (const row of impactBulletin.cities) impactByCity.set(row.normalized, row);

  const rows = cities.map((city) => {
    const baselineAqi = round(mean(baselineByCity.get(city.id) || []));
    const impact = impactByCity.get(city.id);
    const diwaliAqi = impact?.aqi ?? null;
    return {
      id: city.id,
      name: city.name,
      state: city.state,
      tier: city.tier,
      baselineAqi,
      diwaliAqi,
      changePct: round(pct(diwaliAqi, baselineAqi)),
      category: impact?.category ?? null,
      pollutant: impact?.pollutant ?? null,
      stations: impact?.stations ?? null,
      source: impact ? "cpcb" : "pending"
    };
  });

  const scored = rows.filter((c) => c.baselineAqi != null && c.diwaliAqi != null);
  const baselineOnly = rows.filter((c) => c.baselineAqi != null);
  const summary = {
    citiesCompared: scored.length,
    avgBaselineAqi: round(mean(scored.map((c) => c.baselineAqi))),
    avgBaselineAvailable: round(mean(baselineOnly.map((c) => c.baselineAqi))),
    avgDiwaliAqi: round(mean(scored.map((c) => c.diwaliAqi))),
    avgChangePct: round(mean(scored.map((c) => c.changePct))),
    citiesUp20: scored.filter((c) => c.changePct > 20).length,
    citiesDown20: scored.filter((c) => c.changePct < -20).length,
    worst: [...scored].sort((a, b) => b.diwaliAqi - a.diwaliAqi)[0] || null,
    biggestJump: [...scored].sort((a, b) => b.changePct - a.changePct)[0] || null
  };
  rows.sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999));
  return { summary, cities: rows };
}

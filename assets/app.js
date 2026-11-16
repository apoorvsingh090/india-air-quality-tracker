const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const CATEGORY = [
  { max: 50, name: "Good", color: "#22c55e" },
  { max: 100, name: "Satisfactory", color: "#84cc16" },
  { max: 200, name: "Moderate", color: "#f59e0b" },
  { max: 300, name: "Poor", color: "#f97316" },
  { max: 400, name: "Very Poor", color: "#ef4444" },
  { max: Infinity, name: "Severe", color: "#b91c1c" }
];

const ADVISORY = {
  Good: "Minimal impact. Air quality is satisfactory for outdoor activity.",
  Satisfactory: "Minor breathing discomfort for sensitive people. Unusually sensitive individuals should consider reducing prolonged exertion.",
  Moderate: "Breathing discomfort for people with asthma, heart or lung disease. Sensitive groups should limit prolonged outdoor exertion.",
  Poor: "Breathing discomfort for most people on prolonged exposure. Reduce outdoor exercise; sensitive groups should stay indoors where possible.",
  "Very Poor": "Respiratory illness on prolonged exposure. Avoid outdoor activity; keep windows closed and use a mask outdoors.",
  Severe: "Health emergency. Everyone should avoid outdoor activity and follow local health advisories."
};

const POLLUTANTS = [
  { key: "pm25", label: "PM2.5", unit: "µg/m³", max: 250 },
  { key: "pm10", label: "PM10", unit: "µg/m³", max: 430 },
  { key: "no2", label: "NO₂", unit: "µg/m³", max: 400 },
  { key: "so2", label: "SO₂", unit: "µg/m³", max: 800 },
  { key: "co", label: "CO", unit: "mg/m³", max: 34 },
  { key: "o3", label: "O₃", unit: "µg/m³", max: 208 },
  { key: "nh3", label: "NH₃", unit: "µg/m³", max: 1800 }
];

const BREAKPOINTS = {
  pm25: [[0, 30, 0, 50], [30, 60, 51, 100], [60, 90, 101, 200], [90, 120, 201, 300], [120, 250, 301, 400], [250, 500, 401, 500]],
  pm10: [[0, 50, 0, 50], [50, 100, 51, 100], [100, 250, 101, 200], [250, 350, 201, 300], [350, 430, 301, 400], [430, 600, 401, 500]],
  no2: [[0, 40, 0, 50], [40, 80, 51, 100], [80, 180, 101, 200], [180, 280, 201, 300], [280, 400, 301, 400], [400, 600, 401, 500]],
  so2: [[0, 40, 0, 50], [40, 80, 51, 100], [80, 380, 101, 200], [380, 800, 201, 300], [800, 1600, 301, 400], [1600, 2000, 401, 500]],
  co: [[0, 1, 0, 50], [1, 2, 51, 100], [2, 10, 101, 200], [10, 17, 201, 300], [17, 34, 301, 400], [34, 50, 401, 500]],
  o3: [[0, 50, 0, 50], [50, 100, 51, 100], [100, 168, 101, 200], [168, 208, 201, 300], [208, 748, 301, 400], [748, 1000, 401, 500]],
  nh3: [[0, 200, 0, 50], [200, 400, 51, 100], [400, 800, 101, 200], [800, 1200, 201, 300], [1200, 1800, 301, 400], [1800, 2000, 401, 500]]
};

const state = {
  latest: null,
  history: null,
  diwali: null,
  search: "",
  tier: "all",
  sort: "aqi-desc",
  diwaliYearKey: null
};

function categoryOf(aqi) {
  if (aqi == null || Number.isNaN(aqi)) return { name: "No data", color: "#64748b" };
  return CATEGORY.find((c) => aqi <= c.max) || CATEGORY[CATEGORY.length - 1];
}

function subIndex(p, v) {
  const bands = BREAKPOINTS[p];
  if (!bands || v == null || Number.isNaN(v) || v < 0) return null;
  const top = bands[bands.length - 1][1];
  const x = Math.min(v, top);
  for (const [clo, chi, ilo, ihi] of bands) {
    if (x >= clo && x <= chi) {
      return Math.round(((ihi - ilo) / (chi - clo)) * (x - clo) + ilo);
    }
  }
  return 500;
}

function fmt(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function timeIST(iso, withDate = false) {
  if (!iso) return null;
  const raw = String(iso);
  const hasZone = /[zZ]$|[+-]\d{2}:\d{2}$/.test(raw);
  const normalized = hasZone ? raw : raw.length === 16 ? `${raw}:00+05:30` : `${raw}+05:30`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return raw.replace("T", " ").replace("+05:30", " IST");
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    ...(withDate ? { day: "numeric", month: "short" } : {}),
    hour12: false
  });
}

function dateIST(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00+05:30`);
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
}

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

function safe(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
}

/* ---------- charts ---------- */

function sparkline(values, color) {
  const clean = values.filter((v) => v != null && !Number.isNaN(v));
  if (clean.length < 2) return "";
  const w = 96;
  const h = 34;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = Math.max(1, max - min);
  const pts = clean.map((v, i) => {
    const x = (i / (clean.length - 1)) * w;
    const y = h - 3 - ((v - min) / span) * (h - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" class="spark" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" opacity=".95"/>
    <circle cx="${pts[pts.length - 1].split(",")[0]}" cy="${pts[pts.length - 1].split(",")[1]}" r="2.2" fill="${color}"/>
  </svg>`;
}

function lineChart(values, labels) {
  const w = 720;
  const h = 190;
  const pad = { t: 14, r: 10, b: 26, l: 34 };
  const clean = values.map((v) => (v == null || Number.isNaN(v) ? null : v));
  const real = clean.filter((v) => v != null);
  if (!real.length) return `<p class="muted">No recent hourly series available.</p>`;
  const maxY = Math.max(100, Math.ceil(Math.max(...real) / 100) * 100);
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const x = (i) => pad.l + (i / Math.max(1, clean.length - 1)) * plotW;
  const y = (v) => pad.t + plotH - (v / maxY) * plotH;

  let d = "";
  let area = "";
  let started = false;
  clean.forEach((v, i) => {
    if (v == null) return;
    const cmd = started ? "L" : "M";
    d += `${cmd}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    started = true;
  });
  if (started) {
    const firstIdx = clean.findIndex((v) => v != null);
    const lastIdx = clean.length - 1 - [...clean].reverse().findIndex((v) => v != null);
    area = `M${x(firstIdx).toFixed(1)},${(h - pad.b).toFixed(1)} L${x(firstIdx).toFixed(1)},${y(clean[firstIdx]).toFixed(1)} ` + d.replace(/^M/, "L") + `L${x(lastIdx).toFixed(1)},${(h - pad.b).toFixed(1)} Z`;
  }
  const lastVal = real[real.length - 1];
  const color = categoryOf(lastVal).color;

  const grid = [0, 100, 200, 300, 400, 500].filter((v) => v <= maxY).map((v) => {
    const yy = y(v).toFixed(1);
    return `<line x1="${pad.l}" y1="${yy}" x2="${w - pad.r}" y2="${yy}" stroke="rgba(148,179,212,.13)" stroke-dasharray="3 4"/>
      <text x="${pad.l - 8}" y="${Number(yy) + 3}" text-anchor="end" fill="#6c819c" font-size="9">${v}</text>`;
  }).join("");

  const firstLabel = labels && labels[0] ? timeIST(labels[0], true) : "";
  const lastLabel = labels && labels[labels.length - 1] ? timeIST(labels[labels.length - 1], true) : "";

  return `<svg viewBox="0 0 ${w} ${h}" class="line-chart" role="img" aria-label="Hourly AQI trend">
    <defs><linearGradient id="lc" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    ${area ? `<path d="${area}" fill="url(#lc)"/>` : ""}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <text x="${pad.l}" y="${h - 8}" fill="#6c819c" font-size="9">${safe(firstLabel)}</text>
    <text x="${w - pad.r}" y="${h - 8}" text-anchor="end" fill="#6c819c" font-size="9">${safe(lastLabel)}</text>
  </svg>`;
}

/* ---------- dashboard ---------- */

function renderNational() {
  const n = state.latest.national;
  const cat = categoryOf(n.avgAqi);
  const official = state.latest.cities.filter((c) => c.primarySource === "cpcb-bulletin").length;
  const modelled = state.latest.cities.filter((c) => c.primarySource === "cams").length;
  const cards = [
    {
      label: "National average AQI",
      value: `${fmt(n.avgAqi)} <small>${cat.name}</small>`,
      sub: `${official} official bulletin · ${modelled} modelled`,
      glow: `rgba(45,212,191,.18)`
    },
    {
      label: "Most polluted",
      value: `${safe(n.worst?.name || "—")}`,
      sub: n.worst ? `AQI ${fmt(n.worst.aqi)} · ${categoryOf(n.worst.aqi).name}` : "",
      glow: `rgba(239,68,68,.18)`
    },
    {
      label: "Cleanest",
      value: `${safe(n.best?.name || "—")}`,
      sub: n.best ? `AQI ${fmt(n.best.aqi)} · ${categoryOf(n.best.aqi).name}` : "",
      glow: `rgba(34,197,94,.18)`
    },
    {
      label: "Cities tracked",
      value: `${fmt(state.latest.cities.length)}`,
      sub: `${n.stationCount} current station${n.stationCount === 1 ? "" : "s"} · bulletin ${dateIST(state.latest.cities.find((c) => c.bulletin)?.bulletin.date)}`,
      glow: `rgba(96,165,250,.18)`
    }
  ];
  $("#nationalGrid").innerHTML = cards.map((c) => `
    <div class="stat" style="--glow:${c.glow}">
      <div class="label">${safe(c.label)}</div>
      <div class="value">${c.value}</div>
      <div class="sub">${c.sub}</div>
    </div>`).join("");
}

// Study years, newest first.
const DIWALI_KEYS = ["y2026", "y2025"];

function diwaliYearOf(key) {
  return key.replace(/^y/, "");
}

function diwaliOfficialKeys() {
  return DIWALI_KEYS.filter((k) => state.diwali?.[k]?.status === "official");
}

function latestOfficialDiwaliYear() {
  const key = diwaliOfficialKeys()[0];
  return key ? diwaliYearOf(key) : null;
}

// Diwali-night change for a city from the newest official study that has one.
function diwaliCity(cityId) {
  for (const key of DIWALI_KEYS) {
    const y = state.diwali?.[key];
    if (y?.status !== "official") continue;
    const row = y.cities?.find((c) => c.id === cityId);
    if (row?.changePct != null) return { row, year: diwaliYearOf(key) };
  }
  return { row: null, year: null };
}

function cityChange(city) {
  return diwaliCity(city.id).row?.changePct ?? null;
}

function filteredCities() {
  let list = [...state.latest.cities];
  const q = state.search.trim().toLowerCase();
  if (q) list = list.filter((c) => `${c.name} ${c.state}`.toLowerCase().includes(q));
  if (state.tier !== "all") list = list.filter((c) => String(c.tier) === state.tier);
  const byAqi = (a, b) => (b.aqi ?? -1) - (a.aqi ?? -1);
  switch (state.sort) {
    case "aqi-asc": list.sort((a, b) => (a.aqi ?? 9999) - (b.aqi ?? 9999)); break;
    case "change-desc": list.sort((a, b) => (cityChange(b) ?? -999) - (cityChange(a) ?? -999)); break;
    case "name-asc": list.sort((a, b) => a.name.localeCompare(b.name)); break;
    default: list.sort(byAqi);
  }
  return list;
}

function renderCities() {
  const list = filteredCities();
  const grid = $("#cityGrid");
  grid.innerHTML = "";
  $("#emptyState").hidden = list.length > 0;
  $("#resultCount").textContent = `${list.length} of ${state.latest.cities.length} cities shown`;

  const legend = CATEGORY.map((c) => `<span><i style="background:${c.color}"></i>${c.name}</span>`).join("");
  $("#legendInline").innerHTML = legend;

  const history = state.history?.cities || {};

  for (const city of list) {
    const cat = categoryOf(city.aqi);
    const model = city.model;
    const pm25 = model?.pollutants?.pm25;
    const pm10 = model?.pollutants?.pm10;
    const trend = history[city.id]?.model?.aqi || [];
    const dc = diwaliCity(city.id);
    const srcs = [];
    if (city.bulletin) srcs.push(`<span class="src cpcb" title="Official CPCB daily bulletin">CPCB</span>`);
    if (city.station && !city.station.stale) srcs.push(`<span class="src station" title="${safe(city.station.name || "Live station")}">STATION</span>`);
    if (city.model) srcs.push(`<span class="src cams" title="CAMS model">CAMS</span>`);

    const card = el("button", "city-card");
    card.style.setProperty("--accent", cat.color);
    card.type = "button";
    card.innerHTML = `
      <div class="top">
        <div>
          <div class="city-name">${safe(city.name)}</div>
          <div class="city-sub">${safe(city.state)} <span class="tier-badge">T${city.tier}</span></div>
        </div>
        <div class="aqi-badge" style="--accent:${cat.color}">
          <b>${fmt(city.aqi)}</b><span>${safe(cat.name)}</span>
        </div>
      </div>
      <div class="city-mid">
        <div class="city-metrics">
          <div class="metric"><b>${fmt(pm25, 0)}</b><span>PM2.5</span></div>
          <div class="metric"><b>${fmt(pm10, 0)}</b><span>PM10</span></div>
          <div class="metric"><b>${safe((city.dominant || "—").toUpperCase())}</b><span>Dominant</span></div>
        </div>
        ${sparkline(trend, cat.color)}
      </div>
      <div class="city-foot">
        <div class="src-chips">${srcs.join("")}</div>
        <span class="trend">${dc.row == null ? "" : `Diwali ’${dc.year.slice(2)} ${dc.row.changePct > 0 ? "+" : ""}${fmt(dc.row.changePct)}%`}</span>
      </div>`;
    card.addEventListener("click", () => openCity(city));
    grid.appendChild(card);
  }
}

/* ---------- modal ---------- */

let lastFocused = null;

function openCity(city) {
  const cat = categoryOf(city.aqi);
  const model = city.model;
  const bulletin = city.bulletin;
  const station = city.station;
  const series = state.history?.cities?.[city.id]?.model || {};
  const change = cityChange(city);
  const { row: d, year: dYear } = diwaliCity(city.id);

  const pollBars = POLLUTANTS.map((p) => {
    const val = model?.pollutants?.[p.key];
    if (val == null) return "";
    const si = subIndex(p.key, val);
    const color = categoryOf(si).color;
    const width = Math.min(100, (val / p.max) * 100);
    return `<div class="poll">
      <span class="pn">${p.label}</span>
      <span class="pt"><span class="pf" style="width:${width.toFixed(1)}%;--pc:${color}"></span></span>
      <span class="pv">${fmt(val, val < 10 ? 1 : 0)} ${p.unit}</span>
    </div>`;
  }).join("");

  const sourceBoxes = [
    {
      k: "CPCB bulletin",
      v: bulletin ? fmt(bulletin.aqi) : "—",
      m: bulletin ? `${bulletin.category} · ${bulletin.pollutant || "n/a"} · ${bulletin.date}` : "not available"
    },
    {
      k: station?.stale ? "Station (stale)" : "Station reading",
      v: station?.aqi != null ? fmt(station.aqi) : "—",
      m: station
        ? `${station.name || "CAAQMS"} · ${timeIST(station.updatedAt, true) || "n/a"}${station.stale ? " · not current" : ""}`
        : "not in live feed"
    },
    {
      k: "CAMS model",
      v: model ? fmt(model.aqi) : "—",
      m: model ? `${model.dominant || "n/a"} · ${timeIST(model.updatedAt) || "n/a"}` : "not available"
    }
  ].map((b) => `<div class="source-box"><div class="k">${b.k}</div><div class="v">${b.v}</div><div class="m">${safe(b.m)}</div></div>`).join("");

  $("#modalBody").innerHTML = `
    <div class="modal-head">
      <div>
        <h3 id="modalTitle">${safe(city.name)}</h3>
        <div class="sub">${safe(city.state)} · Tier ${city.tier} · ${city.lat.toFixed(2)}°N, ${city.lon.toFixed(2)}°E</div>
      </div>
      <div class="modal-aqi" style="--accent:${cat.color}">
        <b>${fmt(city.aqi)}</b>
        <span>${safe(cat.name)}</span>
      </div>
    </div>

    <div class="modal-section">
      <h4>Source comparison</h4>
      <div class="source-grid">${sourceBoxes}</div>
      <p class="modal-note">Headline uses the official CPCB 24-hour bulletin. Station = WAQI/US EPA AQI; CAMS = modelled CPCB AQI. Standards and averaging windows differ.</p>
    </div>

    <div class="modal-section">
      <h4>Hourly AQI · last ${series.aqi?.length || 0} hours (CAMS)</h4>
      ${lineChart(series.aqi || [], state.history?.hours || [])}
    </div>

    <div class="modal-section">
      <h4>Pollutant concentrations · 24h average (CAMS)</h4>
      <div class="poll-bars">${pollBars || '<p class="muted">No pollutant detail available.</p>'}</div>
      <p class="modal-note">Bars show modelled concentrations; colour reflects each pollutant's CPCB sub-index category.</p>
    </div>

    <div class="modal-section">
      <div class="advisory" style="--accent:${cat.color}">
        <strong>${safe(cat.name)}.</strong> ${safe(ADVISORY[cat.name] || "")}
      </div>
      ${d?.changePct != null ? `<p class="modal-note">Diwali ${dYear}: AQI moved from a ${fmt(d.baselineAqi)} baseline to ${fmt(d.diwaliAqi)} on the Diwali-night bulletin (${d.changePct > 0 ? "+" : ""}${fmt(d.changePct)}%).</p>` : ""}
      ${change != null && !d ? "" : ""}
    </div>
  `;
  lastFocused = document.activeElement;
  $("#cityModal").hidden = false;
  document.body.style.overflow = "hidden";
  setBackgroundInert(true);
  $(".modal-close")?.focus();
}

function closeModal() {
  $("#cityModal").hidden = true;
  document.body.style.overflow = "";
  setBackgroundInert(false);
  if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
  lastFocused = null;
}

function setBackgroundInert(on) {
  for (const node of $$("body > header, body > nav, body > main, body > footer")) node.inert = on;
}

function trapModalFocus(e) {
  if (e.key !== "Tab") return;
  const modal = $("#cityModal");
  const focusable = $$("a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])", modal).filter(
    (n) => n.offsetParent !== null
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ---------- diwali ---------- */

function pendingCountdown(Y) {
  const istToday = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  const dayDiff = Math.round((new Date(`${Y.date}T00:00:00Z`) - new Date(`${istToday}T00:00:00Z`)) / 86400000);
  const title =
    dayDiff > 1 ? `Diwali is in ${dayDiff} days` : dayDiff === 1 ? "Diwali is tomorrow" : dayDiff === 0 ? "Diwali is tonight" : "Diwali was last night";
  const bulletinDay = Y.impactDate ? dateIST(Y.impactDate) : "the D+1 bulletin";
  const copy =
    dayDiff > 0
      ? `The CPCB bulletin covering Diwali night is published on ${bulletinDay}, evening. This panel fills in automatically — no action needed.`
      : `The CPCB bulletin covering Diwali night is due on ${bulletinDay}, evening. This panel fills in automatically — no action needed.`;
  return { title, copy };
}

function pendingCard(Y, year, ref) {
  const { title, copy } = pendingCountdown(Y);
  return `
    <div class="pending-card">
      <div class="ring">◔</div>
      <h4>${title}</h4>
      <p>${copy}</p>
      <div class="pending-list">
        <div><span>${year} pre-Diwali baseline</span><b>${fmt(Y.summary.avgBaselineAvailable ?? Y.summary.avgBaselineAqi)} AQI</b></div>
        <div><span>Cities tracked</span><b>${Y.cities.filter((c) => c.baselineAqi != null).length}</b></div>
        <div><span>Live national AQI now</span><b>${fmt(state.latest?.national?.avgAqi)}</b></div>
        ${ref ? `<div><span>Diwali ${ref.year} average jump</span><b>${ref.summary.avgChangePct == null ? "—" : `${ref.summary.avgChangePct > 0 ? "+" : ""}${fmt(ref.summary.avgChangePct, 1)}%`}</b></div>` : ""}
      </div>
    </div>`;
}

function renderDiwaliYearToggle(keys) {
  const box = $("#diwaliYearFilter");
  box.innerHTML = keys.map((k) => {
    const y = diwaliYearOf(k);
    const active = k === state.diwaliYearKey;
    return `<button type="button" class="seg-btn${active ? " is-active" : ""}" data-year="${y}" aria-pressed="${active}">${y}</button>`;
  }).join("");
  box.hidden = keys.length < 2;
}

function renderDiwaliMain(Y, year) {
  const s = Y.summary;
  if (Y.status !== "official") {
    const refKey = diwaliOfficialKeys()[0];
    const ref = refKey ? { year: diwaliYearOf(refKey), summary: state.diwali[refKey].summary } : null;
    $("#diwaliHero").innerHTML = `<div class="panel" style="grid-column:1/-1">${pendingCard(Y, year, ref)}</div>`;
    return;
  }
  const biggest = s.biggestJump;
  $("#diwaliHero").innerHTML = `
    <div class="diwali-big">
      <div class="kicker">Diwali ${year} · ${dateIST(Y.date)}</div>
      <div class="huge">${s.avgChangePct > 0 ? "+" : ""}${fmt(s.avgChangePct, 1)}<small>% mean per-city change</small></div>
      <p>Across <strong>${s.citiesCompared} cities</strong>, the official Diwali-night AQI averaged ${fmt(s.avgDiwaliAqi)} against a ${fmt(s.avgBaselineAqi)} pre-Diwali baseline. Firecracker night made the air worse in ${s.citiesUp20} of them by more than 20%.</p>
    </div>
    <div class="diwali-stat">
      <div class="k">Biggest jump</div>
      <div class="v">${safe(biggest?.name || "—")}</div>
      <div class="s">${biggest ? `AQI ${fmt(biggest.baselineAqi)} → ${fmt(biggest.diwaliAqi)} · ${biggest.changePct > 0 ? "+" : ""}${fmt(biggest.changePct, 1)}%` : ""}</div>
    </div>
    <div class="diwali-stat">
      <div class="k">Worst Diwali-night AQI</div>
      <div class="v">${fmt(s.worst?.diwaliAqi)}</div>
      <div class="s">${safe(s.worst?.name || "—")} · ${safe(s.worst?.category || "")}</div>
    </div>`;
}

function renderDiwaliChart(Y, year) {
  $("#diwaliChartTitle").textContent = `Biggest AQI jumps · Diwali ${year}`;
  if (Y.status !== "official") {
    $("#diwaliChart").innerHTML = `<p class="muted">Official Diwali-night values will appear here once the D+1 bulletin is published.</p>`;
    return;
  }
  const top = Y.cities.filter((c) => c.changePct != null).slice(0, 15);
  const max = Math.max(20, ...top.map((c) => Math.max(0, c.changePct)));
  $("#diwaliChart").innerHTML = top.map((c) => {
    const cat = categoryOf(c.diwaliAqi);
    const w = Math.max(3, (Math.max(0, c.changePct) / max) * 100);
    const sign = c.changePct > 0 ? "+" : "";
    return `<div class="bar-row">
      <span class="nm" title="${safe(c.name)}: AQI ${fmt(c.baselineAqi)} → ${fmt(c.diwaliAqi)} (${sign}${fmt(c.changePct, 1)}%)">${safe(c.name)}</span>
      <span class="track"><span class="fill" style="width:${w.toFixed(1)}%;--bc:${cat.color}"></span></span>
      <span class="val">${sign}${fmt(c.changePct, 1)}%</span>
    </div>`;
  }).join("") + `<div class="chart-axis"><span>0%</span><span>+${fmt(max)}%</span></div>`;
}

function renderDiwaliSide(other, otherKey, ref) {
  const panel = $("#diwaliSidePanel");
  if (!other) {
    panel.hidden = true;
    $("#diwaliGrid").classList.add("single");
    return;
  }
  panel.hidden = false;
  $("#diwaliGrid").classList.remove("single");
  const oyear = diwaliYearOf(otherKey);
  const os = other.summary;
  $("#diwaliSideTitle").textContent = `Diwali ${oyear} · at a glance`;
  $("#diwaliSideStatus").textContent = other.status === "official" ? "Official CPCB data" : "Pending bulletin";
  const body = $("#diwaliSideBody");
  if (other.status === "official") {
    const jump = os.biggestJump;
    body.innerHTML = `
      <div class="diwali-stat" style="border:none;padding:0;background:none">
        <div class="k">Average change · Diwali ${oyear}</div>
        <div class="v" style="color:${os.avgChangePct > 0 ? "#fca5a5" : "#86efac"}">${os.avgChangePct > 0 ? "+" : ""}${fmt(os.avgChangePct, 1)}%</div>
        <div class="s">${os.citiesCompared} cities · ${os.citiesUp20} up more than 20%</div>
      </div>
      <div class="pending-list">
        <div><span>Average baseline</span><b>${fmt(os.avgBaselineAqi)}</b></div>
        <div><span>Average Diwali-night AQI</span><b>${fmt(os.avgDiwaliAqi)}</b></div>
        <div><span>Worst city</span><b>${safe(os.worst?.name || "—")} · ${fmt(os.worst?.diwaliAqi)}</b></div>
        <div><span>Biggest jump</span><b>${safe(jump?.name || "—")} · ${jump?.changePct == null ? "—" : `${jump.changePct > 0 ? "+" : ""}${fmt(jump.changePct, 1)}%`}</b></div>
      </div>`;
  } else {
    body.innerHTML = pendingCard(other, oyear, ref);
  }
}

function renderDiwali() {
  const d = state.diwali;
  if (!d) {
    $("#diwaliHero").innerHTML = `<div class="panel"><p class="muted">Diwali study data is not available yet.</p></div>`;
    $("#diwaliYearFilter").innerHTML = "";
    $("#diwaliChart").innerHTML = "";
    $("#diwaliTable tbody").innerHTML = "";
    renderDiwaliSide(null);
    return;
  }
  const keys = DIWALI_KEYS.filter((k) => d[k]?.date);
  if (!keys.includes(state.diwaliYearKey)) {
    state.diwaliYearKey = diwaliOfficialKeys()[0] || keys[0] || null;
  }
  if (!state.diwaliYearKey) return;
  renderDiwaliYearToggle(keys);

  const Y = d[state.diwaliYearKey];
  const year = diwaliYearOf(state.diwaliYearKey);
  const s = Y.summary;
  const otherKey = keys.find((k) => k !== state.diwaliYearKey);
  const other = otherKey ? d[otherKey] : null;

  renderDiwaliMain(Y, year);
  renderDiwaliChart(Y, year);
  renderDiwaliSide(other, otherKey, { year, summary: s });

  // table
  const tbody = $("#diwaliTable tbody");
  const rows = Y.status === "official" ? Y.cities.filter((c) => c.diwaliAqi != null) : [];
  tbody.innerHTML = rows.length ? rows.map((c) => {
    const cat = categoryOf(c.diwaliAqi);
    const cls = c.changePct > 2 ? "delta-up" : c.changePct < -2 ? "delta-down" : "delta-flat";
    return `<tr>
      <td><span class="citycell"><b>${safe(c.name)}</b><span>${safe(c.state)}</span></span></td>
      <td>T${c.tier}</td>
      <td class="num">${fmt(c.baselineAqi)}</td>
      <td class="num">${fmt(c.diwaliAqi)}</td>
      <td class="num ${cls}">${c.changePct == null ? "—" : `${c.changePct > 0 ? "+" : ""}${fmt(c.changePct, 1)}%`}</td>
      <td><span class="pill" style="--pc:${cat.color}">${safe(c.category || categoryOf(c.diwaliAqi).name)}</span></td>
    </tr>`;
  }).join("") : `<tr><td colspan="6" class="muted">No official Diwali-night values published yet.</td></tr>`;

  $("#diwaliCaption").textContent = `Diwali ${year} · pre-Diwali baseline vs Diwali-night bulletin${Y.impactDate ? ` (${dateIST(Y.impactDate)})` : ""}`;
  const coverage = ` ${s.citiesCompared} of ${Y.cities.length} cities had an official Diwali-night value.`;
  $("#diwaliMethod").innerHTML = `<b>How this is measured.</b> ${safe(d.method.impact)} Baseline: ${safe(d.method.baseline)} ${safe(d.method.caveat)}${safe(coverage)} Source: ${safe(d.method.source)}`;
}

/* ---------- sources ---------- */

function renderSources() {
  const s = state.latest.sources;
  const meta = [
    { key: "bulletin", color: "#2dd4bf", label: "Official" },
    { key: "cpcb", color: "#60a5fa", label: "Ground stations" },
    { key: "cams", color: "#a78bfa", label: "Model" }
  ];
  $("#sourceCards").innerHTML = meta.map((m) => {
    const src = s[m.key];
    if (!src) return "";
    return `<div class="source-card" style="--sc:${m.color}">
      <span class="badge">${m.label}</span>
      <h3>${safe(src.name)}</h3>
      <p>${safe(src.note)}</p>
      <a href="${safe(src.url)}" target="_blank" rel="noopener">Visit source →</a>
    </div>`;
  }).join("");
}

/* ---------- boot ---------- */

async function loadJson(path) {
  // Cache freely: Pages serves ETags and the data changes hourly, so the
  // browser revalidates correctly instead of bypassing cache on every view.
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function setUpdated() {
  const g = state.latest.generatedAt;
  const stamp = g ? new Date(g).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
  $("#updatedAt").textContent = `Updated ${stamp} IST`;
  $("#footerUpdated").textContent = `Last build: ${stamp} IST`;
  $("#cityCount").textContent = state.latest.cities.length;
}

async function init() {
  try {
    const [latest, history, diwali] = await Promise.all([
      loadJson("./data/latest.json"),
      loadJson("./data/history.json").catch(() => null),
      loadJson("./data/diwali.json").catch(() => null)
    ]);
    state.latest = latest;
    state.history = history;
    state.diwali = diwali;
    const latestYear = latestOfficialDiwaliYear();
    if (latestYear) {
      const opt = $('#sortSelect option[value="change-desc"]');
      if (opt) opt.textContent = `Biggest Diwali jump (${latestYear})`;
    }
    setUpdated();
    renderNational();
    renderCities();
    renderDiwali();
    renderSources();
  } catch (err) {
    console.error(err);
    $("#updatedAt").textContent = "Data unavailable";
    $("#nationalGrid").innerHTML = `<div class="stat wide"><div class="label">Could not load data</div><div class="sub">If you opened this file directly, serve it over HTTP (or view the GitHub Pages site). ${safe(err.message)}</div></div>`;
  }
}

/* ---------- events ---------- */

const tabs = $$(".tab");

function selectTab(btn, { scroll = false } = {}) {
  for (const b of tabs) {
    const active = b === btn;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-selected", String(active));
    b.tabIndex = active ? 0 : -1;
  }
  for (const p of $$(".tab-panel")) p.hidden = p.id !== `panel-${btn.dataset.tab}`;
  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

tabs.forEach((btn, i) => {
  btn.addEventListener("click", () => selectTab(btn, { scroll: true }));
  btn.addEventListener("keydown", (e) => {
    let next = null;
    if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
    else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === "Home") next = tabs[0];
    else if (e.key === "End") next = tabs[tabs.length - 1];
    if (!next) return;
    e.preventDefault();
    selectTab(next);
    next.focus();
  });
});

$("#searchInput")?.addEventListener("input", (e) => {
  state.search = e.target.value;
  renderCities();
});

$$("#tierFilter .seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.tier = btn.dataset.tier;
    $$("#tierFilter .seg-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
    renderCities();
  });
});

$("#diwaliYearFilter")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-year]");
  if (!btn || `y${btn.dataset.year}` === state.diwaliYearKey) return;
  state.diwaliYearKey = `y${btn.dataset.year}`;
  renderDiwali();
  $("#diwaliYearFilter .seg-btn.is-active")?.focus();
});

$("#sortSelect")?.addEventListener("change", (e) => {
  state.sort = e.target.value;
  renderCities();
});

$("#cityModal")?.addEventListener("click", (e) => {
  if (e.target.closest("[data-close='modal']")) closeModal();
});
$("#cityModal")?.addEventListener("keydown", trapModalFocus);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#cityModal").hidden) closeModal();
});

init();

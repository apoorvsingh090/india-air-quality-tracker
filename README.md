# India Air Quality Tracker

A public, automated air-quality tracker for **84 Indian cities** across tier 1, 2 and 3 — built on official CPCB data, live monitoring stations, and the Copernicus CAMS model. It also includes a reproducible **Diwali impact study** using official CPCB AQI bulletins.

**Live site:** https://apoorvsingh090.github.io/india-air-quality-tracker/

---

## What it does

- **Live national dashboard** — city-level AQI, category, dominant pollutant, PM2.5/PM10, 72-hour trend, and a source-by-source comparison.
- **Multiple independent sources** — the headline uses the official CPCB daily bulletin; live CAAQMS station readings and CAMS modelled concentrations are shown alongside it.
- **Diwali impact study** — compares official CPCB AQI on the Diwali-night bulletin with each city's own 7-day pre-Diwali baseline. The 2025 edition is complete; the 2026 edition fills in automatically after the 9 November 2026 bulletin.
- **Fully automated** — a GitHub Actions workflow rebuilds the data every hour and commits it to this repository. The static site is served by GitHub Pages.
- **Open and transparent** — every number on the site traces back to a public source and a documented method.

## Diwali 2025 findings

Using the official CPCB bulletins for 13–19 October 2025 (baseline) and 21 October 2025 (24-hour window covering Diwali night):

| Metric | Value |
| --- | --- |
| Cities compared | 66 |
| Average pre-Diwali AQI | 122 |
| Average Diwali-night AQI | 176 |
| Average change | **+43.2%** |
| Cities up more than 20% | **48 of 66** |
| Biggest jump | Amritsar: 86 → 224 (+159%) |
| Worst Diwali-night AQI | Rohtak: 376 (Very Poor) |

> AQI is a 24-hour city average, so it smooths the sharpest hourly firecracker peaks. The study measures the sustained city-wide effect, not the single worst hour. Diwali 2025 was observed on 20 October in most of India (some communities on 21 October); the 21 October bulletin covers the 20 October night.

## Data sources

| Source | Role | Cadence | Link |
| --- | --- | --- | --- |
| CPCB Daily National AQI Bulletin | Official headline AQI per city | Daily, ~4–6 PM IST | [cpcb.nic.in/aqi_bulletin.php](https://cpcb.nic.in/aqi_bulletin.php) |
| CPCB CAAQMS stations via AQICN/WAQI | Ground-station cross-check (fresh feeds only) | Hourly where available | [aqicn.org/india](https://aqicn.org/india/) |
| CAMS / Copernicus via Open-Meteo | Hourly modelled concentrations for all cities | Hourly | [open-meteo.com](https://open-meteo.com/en/docs/air-quality-api) |

### AQI standard

The tracker uses the **CPCB National Air Quality Index (2014)**. A sub-index is interpolated from the official breakpoint table for each pollutant; the city AQI is the maximum sub-index.

- PM2.5, PM10, NO2, SO2, NH3: 24-hour averages
- CO, O3: 8-hour averages
- Headline: the official CPCB bulletin value (24-hour average ending 4 PM IST)
- Categories: Good (0–50), Satisfactory (51–100), Moderate (101–200), Poor (201–300), Very Poor (301–400), Severe (401–500)

**Source mixing:** 65 of 84 cities currently have an official bulletin row; the other 19 use the CAMS model and are labelled `CAMS` on their city card. The national average is therefore a blend of official and modelled values, and each card exposes which source it used.

**Live-station caveat:** AQICN/WAQI's India feed is currently stale for most mapped stations (as of 7 Nov 2026, only Delhi is current). The tracker excludes feeds older than 6 hours from the live-station count and labels stale readings in the city detail view. The official bulletin remains the headline source.

## How it works

```
CPCB bulletin PDF ──parse──┐
CPCB/AQICN stations ───────┼──> scripts/fetch-data.mjs ──> data/latest.json
CAMS / Open-Meteo ─────────┘                              data/history.json

CPCB bulletins (D-7 … D+1) ──> scripts/diwali.mjs ──> data/diwali.json

GitHub Actions (hourly) ──commit──> GitHub Pages (static site)
```

The site is plain HTML/CSS/JS with no runtime dependencies or API keys. All data is pre-computed and committed, so it loads instantly and cannot be rate-limited in the browser.

### Data files

| File | Contents |
| --- | --- |
| `data/latest.json` | Current city headlines, per-source values, pollutant concentrations, national summary |
| `data/history.json` | 72-hour hourly AQI/PM2.5 series for charting |
| `data/diwali.json` | 2025 and 2026 Diwali comparisons, baselines, rankings, methodology |
| `data/cities.json` | City metadata (name, state, tier, coordinates) |
| `data/waqi-index.json` | Discovered live-station mappings |
| `data/cache/bulletins/*.json` | Parsed official CPCB bulletins (cache) |

## Run locally

```bash
npm install
npm run update          # fetch sources, rebuild Diwali study, run data audit
npm run serve           # http://localhost:4173
```

The `update` script needs network access. `serve` only needs the static files. `npm run audit` validates AQI math, data ranges, source freshness, bulletin parsing and Diwali summary consistency; the hourly workflow runs it before committing.

## Optional: extend station coverage

`data/waqi-index.json` maps cities to live AQICN/WAQI station IDs. The hourly workflow discovers a few new stations each run; you can also force a larger batch:

```bash
MAX_DISCOVER=999 node scripts/fetch-data.mjs --discover
```

AQICN rate-limits aggressive discovery, so a gradual fill is intentional.

## Limitations

- AQI is a 24-hour city average and understates short peaks such as firecracker bursts.
- Live station coverage is partial and several AQICN/WAQI feeds are stale; only feeds ≤6 hours old are counted, and stale readings are labelled.
- The national average mixes official bulletin values with CAMS estimates for cities lacking a bulletin row.
- CAMS values are model estimates, not measurements.
- Official bulletins can be delayed or unavailable on some days; the headline falls back to the CAMS model and is labelled accordingly.
- The 2025 Diwali study covers the 66 of 84 cities that had an official Diwali-night bulletin value.
- This is an independent information tool, not an official government service.

## License

MIT. Data remains subject to the terms of its providers (CPCB, AQICN/WAQI, Open-Meteo/CAMS).

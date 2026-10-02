// Shared tvguide.co.uk channel-listings layer — the UK equivalent of
// spike/replays/tvpassport.js, and shared the same way: the fights scraper
// (spike/replays/fight-replays.js) and the football one
// (spike/replays/football-replays.js) both read whole channel days from
// here and apply their own sport filter, so a build run fetches each
// channel/day page exactly once even where their channel lists overlap
// (Sky Sports Main Event, TNT Sports 1 and 2 are on both).
//
// Why this source (validated live 2026-08-11, re-confirmed 2026-08-12):
//  - robots.txt disallows only /search — no AI-agent blocks.
//  - Pages are server-rendered and every `.js-schedule` row carries
//    `data-date` as an ISO **UTC** timestamp, so air times need no timezone
//    parsing at all (unlike TV Passport, whose times render in a
//    geo-detected zone).
//
// What the markup does NOT carry, checked by dumping raw rows: there is no
// repeat/new flag and no original-air date — a row has only its start time,
// programme title, short description and long description. That is why both
// callers decide replay-vs-live by air-time arithmetic rather than by any
// flag, and why "Live ..." in a title cannot be trusted (tvguide keeps the
// "Live" prefix on repeat airings).
import * as cheerio from "cheerio";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

// One fetched page per (channel, date) for the whole process — see the
// module comment for why this matters.
const pageCache = new Map();

async function fetchPage(slug, dateParam) {
  const url = `https://www.tvguide.co.uk/channel/${slug}${dateParam ? `?date=${dateParam}` : ""}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());
  const rows = [];
  $(".js-schedule").each((_, el) => {
    const iso = $(el).attr("data-date");
    const title = $(el).find("a").first().text().trim();
    if (!iso || !title) return;
    rows.push({
      airTimeUTC: new Date(iso).toISOString(),
      title,
      // The compact one-line description ("Everton v Newcastle United") is
      // the cleanest matchup text the page offers; the long one repeats it
      // and then adds prose.
      subShort: $(el).find("div.text-sm div").first().text().trim(),
      subAll: $(el).find("div.text-sm").first().text().trim(),
    });
  });
  return rows;
}

function pageOnce(slug, dateParam) {
  const key = `${slug}|${dateParam ?? "today"}`;
  if (!pageCache.has(key)) pageCache.set(key, fetchPage(slug, dateParam));
  return pageCache.get(key);
}

/**
 * Every listing on one channel for `days` consecutive broadcast days.
 *
 * Consecutive is load-bearing: one page is ONE broadcast day, which runs
 * ~6am to ~6am and so spills into the next calendar date. That makes
 * `?date=D` look like it returned two days, and an early every-other-day
 * fetch pattern therefore skipped whole days silently — which is how a
 * Saturday ONE Championship card once went missing entirely.
 *
 * Each row also carries `nextStartUTC`, the start of the next programme on
 * the channel. tvguide publishes no duration field, so that gap is the only
 * real slot length available — it lets the catch-up view keep an airing
 * listed until it actually ends instead of guessing.
 */
export async function scrapeTvguideChannel({ slug, days = 3 }) {
  const dateParams = [null, ...Array.from({ length: days - 1 }, (_, i) => new Date(Date.now() + (i + 1) * 86400000).toISOString().slice(0, 10))];
  const seen = new Set();
  const rows = [];
  for (const dateParam of dateParams) {
    const key = `${slug}|${dateParam ?? "today"}`;
    const alreadyFetched = pageCache.has(key);
    for (const r of await pageOnce(slug, dateParam)) {
      // Overlapping broadcast days repeat entries across pages.
      const dedupeKey = `${r.airTimeUTC}|${r.title}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      rows.push({ slug, ...r });
    }
    // Only pace real network requests — a cache hit costs nothing.
    if (!alreadyFetched) await new Promise((res) => setTimeout(res, 300));
  }
  rows.sort((a, b) => Date.parse(a.airTimeUTC) - Date.parse(b.airTimeUTC));
  for (let i = 0; i < rows.length; i++) {
    rows[i].nextStartUTC = rows.slice(i + 1).find((r) => r.airTimeUTC !== rows[i].airTimeUTC)?.airTimeUTC ?? null;
  }
  return rows;
}

// FootyOnTV's server-rendered match listings — a second live-broadcast feed
// for the markets this dashboard cares about.
//
// This is deliberately an enrichment source, not a fixture source. The
// caller only uses rows that also correlate to a fixture already in
// fixtures.json, so a listing mistake cannot create a phantom match.
//
// The site publishes each market's local kickoff time in the match URL's
// date and the page's local clock. It is server-rendered HTML, so no browser
// automation or client-side endpoint is needed. Two pages per market (today
// and tomorrow) keeps the daily request budget modest while covering the
// period in which channel assignments are most likely to change.
import * as cheerio from "cheerio";

const BASE = "https://footyontv.com";
const UA = "BroadcastDashboard/1.0 (personal, non-commercial use)";

export const FOOTY_ON_TV_MARKETS = [
  { code: "ar", label: "Argentina", timeZone: "America/Argentina/Buenos_Aires" },
  { code: "br", label: "Brazil", timeZone: "America/Sao_Paulo" },
  { code: "ca", label: "Canada", timeZone: "America/Toronto" },
  { code: "de", label: "Germany", timeZone: "Europe/Berlin" },
  { code: "es", label: "Spain", timeZone: "Europe/Madrid" },
  { code: "fr", label: "France", timeZone: "Europe/Paris" },
  { code: "it", label: "Italy", timeZone: "Europe/Rome" },
  { code: "mx", label: "Mexico", timeZone: "America/Mexico_City" },
  { code: "pt", label: "Portugal", timeZone: "Europe/Lisbon" },
  { code: "uk", label: "UK", timeZone: "Europe/London" },
  { code: "us", label: "US & Canada (English)", timeZone: "America/New_York" },
];

function classHas($, el, ...tokens) {
  const classes = ($(el).attr("class") || "").split(/\s+/);
  return tokens.every((token) => classes.includes(token));
}

function textNodes($, scope, predicate) {
  return $(scope)
    .find("span")
    .filter((_, el) => predicate(el, $(el).attr("class") || ""))
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(Boolean);
}

function localTimeToUTC(dateKey, hhmm, timeZone) {
  const date = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(dateKey);
  const time = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").trim());
  if (!date || !time) return null;

  const desired = Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), Number(time[1]), Number(time[2]));
  let guess = desired;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });

  // Reconcile the wall clock in the requested zone with the same wall clock
  // interpreted as UTC. Two iterations are enough for the DST offsets used
  // by the supported markets, including the spring/autumn transitions.
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
    const rendered = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const delta = desired - rendered;
    guess += delta;
    if (delta === 0) break;
  }
  return new Date(guess).toISOString();
}

function closestTimeGroup($, el) {
  const ancestor = $(el)
    .parents()
    .toArray()
    .find((parent) => classHas($, parent, "flex", "items-start") && ($(parent).attr("class") || "").includes("gap-0"));
  return ancestor ? $(ancestor) : $();
}

/**
 * Parse one FootyOnTV market page.
 *
 * Exported for regression tests because the page is a presentation-oriented
 * source. The selectors intentionally use the site's semantic class tokens,
 * not positional child indexes, so the mobile and desktop copies of a card
 * are handled the same way.
 */
export function parseFootyOnTvPage(html, { market, dateFallback = null } = {}) {
  if (!market?.timeZone) throw new Error("FootyOnTV market timezone is required");
  const $ = cheerio.load(html);
  const rows = [];

  // Use the match URL as the anchor rather than relying on one particular
  // `<main>` boundary. The site keeps its finished and upcoming time groups
  // in the same visible page, but a streamed/hydrated response can serialize
  // those groups under more than one main-content wrapper when Cheerio
  // reparses it.
  $('a[href*="/matches/"]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href") || "";
    const dateKey = href.match(/\/matches\/(\d{4}-\d{2}-\d{2})\//)?.[1] ?? dateFallback;
    if (!dateKey) return;

    const teams = textNodes($, el, (_, classes) => classes.includes("text-[15px]") && classes.includes("truncate"));
    if (teams.length < 2) return;

    const timeGroup = closestTimeGroup($, el);
    const time = timeGroup
      .find("span")
      .filter((_, span) => classHas($, span, "font-mono", "tabular-nums"))
      .first()
      .text()
      .trim();
    const kickoffUTC = localTimeToUTC(dateKey, time, market.timeZone);
    if (!kickoffUTC) return;

    const labels = textNodes($, el, (_, classes) => classes.includes("label") && classes.includes("text-[10px]"));
    const channels = textNodes(
      $,
      el,
      (_, classes) =>
        classes.includes("font-mono") &&
        classes.includes("text-[10px]") &&
        classes.includes("font-semibold") &&
        classes.includes("leading-none")
    ).filter((name) => !/^\+\d+\s+more$/i.test(name) && !/^(?:tbc|tbd)$/i.test(name));

    if (!channels.length) return;
    rows.push({
      source: "footyontv",
      market: market.label,
      localDate: dateKey,
      kickoffUTC,
      teams: teams.slice(0, 2),
      competition: labels[0] || null,
      channels: [...new Set(channels)],
    });
  });

  return rows;
}

function dateInZone(timeZone, offsetDays) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offsetDays));
  return date.toISOString().slice(0, 10);
}

function marketPath(market, day, dateKey) {
  const prefix = market.code === "uk" ? "" : `/${market.code}`;
  if (day === 0) return `${prefix}/`;
  if (day === 1) return `${prefix}/tomorrow/`;
  return `${prefix}/date/${dateKey}/`;
}

async function fetchMarketPage(market, day, dateKey) {
  const url = `${BASE}${marketPath(market, day, dateKey)}`;
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/** Fetch today's and tomorrow's match-level listings for all supported markets. */
export async function scrapeFootyOnTvListings({ markets = FOOTY_ON_TV_MARKETS, days = 2 } = {}) {
  const out = [];
  let requested = 0;
  for (const market of markets) {
    const seen = new Set();
    for (let day = 0; day < days; day++) {
      const dateKey = dateInZone(market.timeZone, day);
      if (requested++) await new Promise((resolve) => setTimeout(resolve, 350));
      const html = await fetchMarketPage(market, day, dateKey);
      for (const row of parseFootyOnTvPage(html, { market, dateFallback: dateKey })) {
        for (const channel of row.channels) {
          const key = `${market.label}|${row.kickoffUTC}|${row.teams.join("|")}|${channel}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ ...row, channel });
        }
      }
    }
  }
  return out.sort((a, b) => Date.parse(a.kickoffUTC) - Date.parse(b.kickoffUTC));
}

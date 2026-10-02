// TV Info (tvinfo.de) — the German leg, reaching DAZN, Sky's Bundesliga
// feed, Sport1 and Sportdigital.
//
// Why this source, after the three obvious German guides failed:
//  - klack.de, tvdigital.de, hoerzu.de and tvmovie.de all open robots.txt
//    with a blanket notice that automated collection "is prohibited except
//    (1) for the purpose of search engine indexing or with express written
//    permission". That is a prohibition on any scraper, not an AI-crawler
//    block, so the corrected robots rule does not reinstate them.
//  - tvspielfilm.de and tvtoday.de sit behind a Cloudflare challenge that
//    403s every path INCLUDING robots.txt, and prisma.de serves robots.txt
//    but challenges its own listing pages. An unreadable robots.txt is
//    treated as disallow, and a bot wall is never worked around.
//  - tvinfo.de's `User-agent: *` group disallows only /share/openepg,
//    /tools, /phpredis, /ics and /merkzettel, with zero AI-agent
//    directives. The /tv-programm/ pages used here are open.
//
// **Timezone verified against an independent source rather than assumed** —
// the GatoTV failure is exactly what happens when the obvious guess goes
// unchecked, and this page publishes bare wall-clock with no offset. The
// anchor: SuperGuidaTV (itself verified, Europe/Rome) lists the Tour of
// Czech Republic's *4th stage* at 11:00 UTC, and tvinfo lists the *4th
// stage* at 13:00 — i.e. UTC+2. The stage number is what makes it decisive:
// under a UTC+1 reading the times would instead pair tvinfo's 3rd stage
// with the Italian guide's 4th, which is the wrong race. It also rules out
// visitor-local rendering, since this build ran from UTC+1. Corroborated by
// the European Athletics marathon, 06:25 UTC against tvinfo's 08:25.
//
// **One request returns FOUR days.** A channel page is a 4-column grid, one
// column per day, and `/tv-programm/<slug>/DD.MM.YYYY` starts that grid on a
// chosen date — so a week of listings costs two requests per channel, not
// seven. That makes this the cheapest per-day source here after El País.
//
// **The columns roll over past midnight and that is load-bearing.** A German
// broadcast day runs ~05:00 to ~03:00, so a column headed 16.08 ends with
// 23:00, 00:00, 02:00, 03:00 — and those last three belong to the 17th.
// Times within a column are ascending, so a decrease IS the rollover; the
// same trap that put SuperGuidaTV's Italian ties on the wrong date.
import * as cheerio from "cheerio";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";
const BASE = "https://www.tvinfo.de/tv-programm";
const ZONE = "Europe/Berlin";
const DAYS_PER_PAGE = 4;

const pageCache = new Map();

function zonedTimeToUTC(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset", hour: "2-digit", hour12: false })
    .formatToParts(guess);
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(parts.find((p) => p.type === "timeZoneName")?.value ?? "");
  const offsetMinutes = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(guess.getTime() - offsetMinutes * 60000);
}

/** "15.08.2026" as a UTC-midnight date, used only for day arithmetic. */
function parseGermanDate(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s ?? "");
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : null;
}

function formatGermanDate(d) {
  return [d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear()]
    .map((n, i) => String(n).padStart(i === 2 ? 4 : 2, "0"))
    .join(".");
}

function parsePage(html) {
  const $ = cheerio.load(html);

  // Each day column is a `tDN` class. The header cell of a column links to
  // /fernsehprogramm/DD.MM.YYYY — that is where the column's date is read
  // from, rather than assuming the page starts today.
  const columnDate = new Map();
  const columnRows = new Map();

  $("td[class*='tD']").each((_, el) => {
    const col = /\btD(\d+)\b/.exec($(el).attr("class") ?? "")?.[1];
    if (!col) return;

    const dateHref = $(el)
      .find("a[href^='/fernsehprogramm/']")
      .map((_, a) => $(a).attr("href").slice("/fernsehprogramm/".length))
      .get()
      .find((h) => /^\d{2}\.\d{2}\.\d{4}$/.test(h));
    if (dateHref) {
      columnDate.set(col, dateHref);
      return;
    }

    // A programme cell carries its start time in `p.tvTime`. Cells that only
    // continue the previous programme ("...seit 06:15 IRONMAN Pro Series")
    // have no such element, which is what excludes them.
    const time = $(el).find("p.tvTime").first().text().trim();
    if (!/^\d{1,2}:\d{2}$/.test(time)) return;

    const link = $(el).find("div.PGL a").first();
    const title = (link.attr("title") ?? link.text() ?? "").trim();
    if (!title) return;

    if (!columnRows.has(col)) columnRows.set(col, []);
    columnRows.get(col).push({ time, title, subtitle: $(el).find("span.subTitle").first().text().trim() });
  });

  const rows = [];
  for (const [col, entries] of columnRows) {
    const start = parseGermanDate(columnDate.get(col));
    if (!start) continue; // no date of its own — never guess which day it belongs to

    let dayShift = 0;
    let prevMinutes = -1;
    const withDates = [];
    for (const e of entries) {
      const [hh, mm] = e.time.split(":").map(Number);
      const minutes = hh * 60 + mm;
      if (minutes < prevMinutes) dayShift += 1; // past midnight, still this broadcast day
      prevMinutes = minutes;
      const d = new Date(start.getTime() + dayShift * 86400000);
      withDates.push({
        ...e,
        airTimeUTC: zonedTimeToUTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hh, mm, ZONE).toISOString(),
      });
    }
    // tvinfo publishes no duration, but the gap to the channel's next
    // programme IS the slot length — the same trick the UK layer uses, and
    // what lets the <75-minute condensed test work on these rows.
    for (let i = 0; i < withDates.length; i++) {
      rows.push({
        airTimeUTC: withDates[i].airTimeUTC,
        endsAtUTC: withDates[i + 1]?.airTimeUTC ?? null,
        title: withDates[i].title,
        subtitle: withDates[i].subtitle,
      });
    }
  }
  return rows;
}

async function fetchPage(slug, startDate) {
  const url = startDate ? `${BASE}/${slug}/${startDate}` : `${BASE}/${slug}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "de-DE,de;q=0.9" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parsePage(await res.text());
}

/**
 * Listings for one German channel across `days` consecutive days, starting
 * today. Each request covers four days, so `days` under 5 costs one fetch.
 */
export async function scrapeTvinfoChannel({ slug, days = DAYS_PER_PAGE }) {
  const out = [];
  const seen = new Set();
  const pages = Math.max(1, Math.ceil(days / DAYS_PER_PAGE));

  for (let p = 0; p < pages; p++) {
    // The first page is the bare URL: it is the only form guaranteed to
    // exist, and it starts on today.
    const startDate = p === 0 ? null : formatGermanDate(new Date(Date.now() + p * DAYS_PER_PAGE * 86400000));
    const key = `${slug}|${startDate ?? "today"}`;
    if (!pageCache.has(key)) pageCache.set(key, fetchPage(slug, startDate));
    for (const r of await pageCache.get(key)) {
      const dedupe = `${r.airTimeUTC}|${r.title}|${r.subtitle}`;
      if (seen.has(dedupe)) continue; // consecutive pages overlap at the boundary
      seen.add(dedupe);
      out.push(r);
    }
    if (p < pages - 1) await new Promise((r) => setTimeout(r, 350));
  }
  out.sort((a, b) => Date.parse(a.airTimeUTC) - Date.parse(b.airTimeUTC));
  return out;
}

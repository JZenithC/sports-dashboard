// Shared Guia de TV (guiadetv.com) channel-listings layer — the BRAZILIAN
// EPG, and — since GatoTV was removed for publishing times in the
// requester's timezone (see football-replays.js) — the only Latin American
// guide still in the pipeline. Its explicit UTC offsets are exactly what
// GatoTV lacked. Same contract as every other EPG layer here: fetch whole
// channel schedules, memoize per channel, let the caller filter and
// correlate.
//
// Why this source (validated live 2026-08-12):
//  - robots.txt is `User-agent: *` / `Disallow:` — completely permissive.
//  - Fully server-rendered.
//  - Every entry carries `data-dt="YYYY-MM-DD HH:MM:SS-03:00"` — an
//    explicit UTC OFFSET. No timezone inference of any kind is needed,
//    which makes this the most trustworthy of the three EPG sources.
//  - One fetch returns EIGHT days of listings (the day tabs are
//    scrollToDiv() anchors within the same page, not separate URLs), so a
//    channel costs exactly one request per build.
//
// Brazilian listing conventions, all observed on Premiere:
//  - The matchup separator is " x ", not " v " / " vs " ("Palmeiras x
//    Internacional").
//  - "VT - " prefixes a videotape airing — an explicit, native replay
//    marker, which neither tvguide.co.uk nor GatoTV offers.
import * as cheerio from "cheerio";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

const pageCache = new Map();

async function fetchChannel(slug) {
  const res = await fetch(`https://www.guiadetv.com/canal/${slug}`, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  // Dead slugs are served as HTTP 200 with a "Canal não encontrado" body,
  // same soft-404 trap GatoTV has — an empty row list is the tell.
  const $ = cheerio.load(html);
  const rows = [];
  $("b[data-dt]").each((_, el) => {
    const dt = $(el).attr("data-dt");
    const row = $(el).closest(".row");
    // A live entry renders as "AO VIVO" followed by the matchup on its own
    // line inside the same link, so the title has to be whitespace-collapsed
    // rather than trimmed.
    const title = row.find("h3 a").first().text().replace(/\s+/g, " ").trim();
    if (!dt || !title) return;
    // "2026-08-12 13:30:00-03:00" -> a value Date parses unambiguously.
    const airTime = new Date(dt.replace(" ", "T"));
    if (Number.isNaN(airTime.getTime())) return;
    rows.push({
      slug,
      airTimeUTC: airTime.toISOString(),
      title,
      description: row.find("p").first().text().replace(/\s+/g, " ").trim(),
    });
  });
  rows.sort((a, b) => Date.parse(a.airTimeUTC) - Date.parse(b.airTimeUTC));
  // No duration or end time is published, but the next programme's start on
  // the same channel is the slot length — the same trick the UK layer uses.
  for (let i = 0; i < rows.length; i++) {
    rows[i].endsAtUTC = rows.slice(i + 1).find((r) => r.airTimeUTC !== rows[i].airTimeUTC)?.airTimeUTC ?? null;
  }
  return rows;
}

export function scrapeGuiadetvChannel(slug) {
  if (!pageCache.has(slug)) pageCache.set(slug, fetchChannel(slug));
  return pageCache.get(slug);
}

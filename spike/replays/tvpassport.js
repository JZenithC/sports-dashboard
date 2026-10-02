// Scrapes TV Passport (tvpassport.com) station listing pages for MLB game
// airings — the aggregator that makes replay coverage possible for every
// team whose local carrier is still a real linear channel, plus MLB Network
// nationally. Found and validated after tvinsider.com (the other
// one-template-covers-every-network aggregator) was ruled out for
// disallowing Claude in robots.txt — tvpassport's robots.txt was checked
// live and is fully permissive (`User-Agent: *` with an empty Disallow).
//
// Why it's trustworthy (validated live, 2026-08-11, before this was built):
//  - Listings are server-rendered with Gracenote-grade structured data
//    attributes per entry: data-st (start), data-duration, data-league,
//    data-team1/data-team2 (exact MLB full team names, including 2026's
//    city-less "Athletics"), data-live / data-new_show / data-repeat flags,
//    and a stable data-listingID.
//  - Cross-checked same-day against the independently validated MASN
//    programming guide (spike/replays/masn.js): every MASN replay airing
//    matched a tvpassport entry to the minute after timezone conversion.
//  - Repeat flags are NOT reliable across stations (NBC-owned RSNs leave
//    overnight re-airs completely unflagged; SportsNet Pittsburgh marked one
//    re-air data-new_show="1"), so this module does NOT filter on
//    data-repeat. It excludes only data-live="1" entries and leaves
//    replay-vs-original disambiguation to the caller's air-time rule (a
//    replay airs hours AFTER its game started; the original airs at start
//    time — see build-mlb.js). data-live was correct on every live game
//    across all 16 stations sweep-checked.
//
// Times: the server renders data-st in a geo-detected display timezone (it
// picked Europe/Isle_of_Man for this machine), NOT a fixed zone. Rather than
// pinning a session cookie, the page's own timezone <select> marks the zone
// it rendered in — parse that and convert to UTC, which stays correct
// wherever the daily job happens to run from. No declared zone -> fail
// loudly rather than guess.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

const BASE = "https://www.tvpassport.com/tv-listings/stations/";

// DST-aware wall-clock -> UTC, longOffset form so half-hour zones
// (Newfoundland etc.) convert correctly should the server ever pick one.
export function zonedTimeToUTC(year, month, day, hour, minute, second, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset", hour: "2-digit", hour12: false }).formatToParts(
    guess
  );
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(parts.find((p) => p.type === "timeZoneName")?.value ?? "");
  const offsetMinutes = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(guess.getTime() - offsetMinutes * 60000);
}

function parseListingsPage(html) {
  const declaredZone = /<option value="([^"]+)"\s+selected>/.exec(html)?.[1];
  if (!declaredZone) throw new Error("no selected timezone on page — cannot interpret listing times");

  const entries = [];
  for (const [tag] of html.matchAll(/<div[^>]*class="list-group-item"[^>]*>/g)) {
    const attrs = {};
    for (const [, key, value] of tag.matchAll(/data-([a-zA-Z_0-9]+)="([^"]*)"/g)) attrs[key] = value;
    if (!attrs.st) continue;
    entries.push({ attrs, declaredZone });
  }
  return entries;
}

async function fetchListings(pathId, dateStr) {
  const res = await fetch(BASE + pathId + (dateStr ? `/${dateStr}` : ""), {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseListingsPage(await res.text());
}

function toUTC(st, zone) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(st);
  if (!m) return null;
  return zonedTimeToUTC(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), zone);
}

/**
 * Raw listing entries for one station, today + a configurable number of days — the shared
 * fetch/parse/timezone layer under both the MLB replay scraper below and
 * the fights one (spike/replays/fight-replays.js). Each entry is
 * { attrs, airTimeUTC } with `attrs` being the listing's full data-*
 * attribute set (showName, episodeTitle, league, team1/2, live/repeat
 * flags, ...). Deduped by listingID across the requested pages.
 */
export async function scrapeTvpassportListings({ path, days = 2 }) {
  // Additional dates use the US-broadcast day convention (Eastern), regardless
  // of the zone the server chooses to render in.
  const dayCount = Math.max(1, Number(days) || 1);
  const dates = [null];
  for (let offset = 1; offset < dayCount; offset++) {
    dates.push(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + offset * 86400000)));
  }

  const seen = new Set();
  const out = [];
  for (const dateStr of dates) {
    const entries = await fetchListings(path, dateStr);
    for (const { attrs, declaredZone } of entries) {
      const id = attrs.listingID || `${attrs.st}|${attrs.showName}|${attrs.episodeTitle}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const airTime = toUTC(attrs.st, declaredZone);
      if (!airTime) continue;
      out.push({ attrs, airTimeUTC: airTime.toISOString() });
    }
    await new Promise((r) => setTimeout(r, 350)); // one polite pause between daily fetches
  }
  return out;
}

/**
 * MLB game airings for one station, today + the next three days (replays that matter
 * air within ~72h of the game — validated pattern across every covered
 * network: same night and/or the next few days).
 *
 * Returns [{ channel, zone, airTimeUTC, teams: [name, name] }] — `teams` are
 * MLB full names straight from data-team1/2, `zone` is the station's own
 * market timezone (what "the replay airs at 4 PM" means for that channel's
 * viewers). Live entries are excluded here; replay-vs-original-broadcast
 * disambiguation is the caller's job (see module header).
 */
export async function scrapeTvpassportReplays({ path, channel, zone, days = 4 }) {
  const listings = await scrapeTvpassportListings({ path, days });
  const out = [];
  for (const { attrs, airTimeUTC } of listings) {
    if (attrs.league !== "MLB" || !attrs.team1 || !attrs.team2) continue;
    if (attrs.live === "1") continue;
    // data-duration is the listing's own slot length in minutes — carried so
    // the catch-up view can keep an airing visible until it actually ends,
    // rather than dropping it the moment it starts.
    const durationMinutes = Number(attrs.duration) || null;
    out.push({ channel, zone, airTimeUTC, durationMinutes, teams: [attrs.team1, attrs.team2] });
  }
  return out;
}

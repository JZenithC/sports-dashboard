// Scrapes MASN's public Programming Guide for Orioles game replays — the
// first confirmed-working replay source (see the MLB section of CLAUDE.md
// for how this was validated and why most other regional networks aren't
// covered yet). Live-checked before writing this:
//  - masnsports.com/robots.txt is fully permissive (no Disallow rules).
//  - The guide (masnsports.com/programming-guide/ — distinct from a simple
//    marketing schedule page) lists ~3 weeks of listings with explicit
//    "Live-HD" / "Repeat-HD" tags per entry.
//  - Repeat entries carry the ORIGINAL game's date as an MMDD suffix in the
//    title (e.g. "ORIOLES BASEBALL: BALTIMORE ORIOLES @ MINNESOTA TWINS
//    0810" = a replay of the Aug 10 game) — a reliable structured
//    correlation key, no fuzzy text matching needed.
//  - No "NATIONALS BASEBALL" entries appear anywhere in the guide — MASN
//    covers the Orioles only now (the Nationals air primarily on their own
//    team-branded Nationals.TV, a separate, not-yet-covered source).
import * as cheerio from "cheerio";

const GUIDE_URL = "https://www.masnsports.com/programming-guide/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

// MASN broadcasts to the Baltimore/DC market — all listing times are Eastern.
const MASN_ZONE = "America/New_York";

// Matches "ORIOLES BASEBALL: <away> @ <home> <MMDD>" — the MMDD suffix is
// only present on repeats (the live entry for the same game has no
// trailing date code), which is exactly what we filter to below.
const REPLAY_TITLE_RE = /^ORIOLES BASEBALL:.*\s(\d{4})$/i;

// "11 August 2026" -> {year, month, day}. MASN always spells the month out
// in English, so a plain Date.parse (locale-independent for this format)
// is reliable here — unlike the ambiguous numeric formats other sources in
// this project have had to special-case.
function parseGuideDate(text) {
  const d = new Date(`${text} UTC`);
  return Number.isNaN(d.getTime()) ? null : { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// "04:00 PM" -> {hour24, minute}
function parseGuideTime(text) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(text.trim());
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (/PM/i.test(m[3])) hour += 12;
  return { hour, minute: Number(m[2]) };
}

// DST-aware local-wall-clock -> UTC conversion (MASN's listed times are
// Eastern local, which shifts between EDT/EST across the season) — verified
// against known EDT/EST offsets before use.
function zonedTimeToUTC(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset", hour: "2-digit", hour12: false }).formatToParts(
    guess
  );
  const offsetMatch = /GMT([+-]\d+)/.exec(parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0");
  const offsetHours = offsetMatch ? Number(offsetMatch[1]) : 0;
  return new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute));
}

// Builds the same YYYY-MM-DD key style used elsewhere in this project
// (localDateKey in build-data.js) so callers can match against a game's own
// `localDate` without re-deriving timezone logic.
function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Returns Orioles replay listings as [{ originalGameDateKey, airTimeUTC }].
 * `originalGameDateKey` is the Orioles' own local-date key (America/New_York)
 * of the game being replayed — matches build-mlb.js's per-game `localDate`
 * for the Orioles directly, since MASN's air-date and the Orioles' own game
 * date are both Eastern time.
 */
export async function scrapeMasnReplays() {
  const res = await fetch(GUIDE_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const replays = [];
  $(".pg-schedule-item").each((_, el) => {
    const item = $(el);
    const status = item.find(".pg-channel").first().text().trim();
    if (status !== "Repeat-HD") return; // only replays — live entries are already covered by fetch-mlb.js

    const title = item.find(".pg-details h4").first().text().trim();
    const match = REPLAY_TITLE_RE.exec(title);
    if (!match) return; // a repeat of something else (poker, fishing, etc.) — not an Orioles game

    const guideDate = parseGuideDate(item.find(".pg-time span").first().text().trim());
    const guideTime = parseGuideTime(item.find(".pg-time strong").first().text().trim());
    if (!guideDate || !guideTime) return;

    const [, mmdd] = match;
    const originalMonth = Number(mmdd.slice(0, 2));
    const originalDay = Number(mmdd.slice(2, 4));
    if (originalMonth < 1 || originalMonth > 12 || originalDay < 1 || originalDay > 31) return; // not a real MMDD — skip rather than guess

    // The original game's year is assumed to be the same as the air date's
    // year, except when a replay of a late-December game airs in early
    // January — not a real scenario during the regular season this scraper
    // runs for, so not handled.
    const airTimeUTC = zonedTimeToUTC(guideDate.year, guideDate.month, guideDate.day, guideTime.hour, guideTime.minute, MASN_ZONE);

    replays.push({
      originalGameDateKey: dateKey(guideDate.year, originalMonth, originalDay),
      channel: "MASN",
      airTimeUTC: airTimeUTC.toISOString(),
    });
  });
  return replays;
}

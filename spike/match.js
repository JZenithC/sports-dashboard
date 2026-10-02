// Bare-bones matcher for spike purposes only — NOT the fully hardened engine
// build-order step 2 will eventually need, but now handles real team-name
// abbreviation/alias cases found via the spike (see team-aliases.js).

import { resolveAlias } from "./team-aliases.js";

// Strips corporate-suffix noise and grammatical filler words (de/do/da are
// just "of/from" in Portuguese/Spanish and never distinguish one club from
// another). Deliberately does NOT strip "atletico"/"athletic" — those *are*
// often the only thing distinguishing two real, different clubs (Atlético-MG
// vs Atlético-GO vs Athletico Paranaense), so stripping them caused false
// matches/information loss. Ambiguous cases like those go in team-aliases.js
// instead, keyed by their exact normalized form.
const SUFFIXES = /\b(fc|cf|sc|ac|afc|ca|cd|clube|club|de|do|da)\b/g;

export function normalizeTeam(name) {
  const base = (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "") // strip accents (combining diacritical marks after NFD)
    .replace(/[().]/g, "")
    .replace(/['’]/g, "") // "Newell's" vs "Newells" are the same club, just different scraper punctuation
    .replace(/-/g, " ") // "atlético-mg" -> "atletico mg", so alias keys can match on the full phrase
    .replace(SUFFIXES, "")
    .replace(/\s+/g, " ")
    .trim();
  return resolveAlias(base);
}

// Country-approximate UTC offsets for converting scraped local kickoff times.
// Not DST-aware — fine for a spike, would need a real tz library for production.
const ASSUMED_UTC_OFFSET_HOURS = {
  brazil: -3, // Brasília time
  argentina: -3,
  mexico: -6, // Mexico City, no DST since 2022
};

function toUtcMs(dateOnly, hhmm, offsetHours) {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const utcH = h - offsetHours;
  return Date.UTC(dateOnly.getUTCFullYear(), dateOnly.getUTCMonth(), dateOnly.getUTCDate(), utcH, m);
}

const TOLERANCE_MS = 20 * 60 * 1000;

// Matches one scraped entry against the fixture list. `today` anchors which
// calendar day the scraped local time belongs to (scraped sources don't always
// state the date explicitly for "hoje/today" style listings).
export function matchScrapedToFixtures(scraped, fixtures, { country, today = new Date() }) {
  const homeNorm = normalizeTeam(scraped.homeTeam);
  const awayNorm = normalizeTeam(scraped.awayTeam);

  let scrapedUtcMs = null;
  const offset = ASSUMED_UTC_OFFSET_HOURS[country];
  if (scraped.startDateMeta && scraped.kickoffLocal) {
    // The ARG/MX platform's schema.org startDate meta has a correct *date* but an
    // unreliable time-of-day (observed ~2h off from the rendered page and from
    // TheSportsDB's independently-reported local kickoff). The rendered `hora`
    // text matched TheSportsDB exactly in spot checks, so: trust the meta's date,
    // trust the rendered time.
    const datePart = scraped.startDateMeta.split("T")[0];
    const [y, mo, d] = datePart.split("-").map(Number);
    scrapedUtcMs = toUtcMs(new Date(Date.UTC(y, mo - 1, d)), scraped.kickoffLocal, offset);
  } else if (scraped.kickoffLocal) {
    scrapedUtcMs = toUtcMs(today, scraped.kickoffLocal, offset);
  }

  for (const fixture of fixtures) {
    const fHome = normalizeTeam(fixture.homeTeam);
    const fAway = normalizeTeam(fixture.awayTeam);
    const namesMatch =
      (fHome.includes(homeNorm) || homeNorm.includes(fHome)) &&
      (fAway.includes(awayNorm) || awayNorm.includes(fAway));
    if (!namesMatch) continue;

    if (scrapedUtcMs === null) return fixture; // name-only match, flagged separately by caller
    const fixtureMs = Date.parse(fixture.kickoffUTC);
    if (Math.abs(fixtureMs - scrapedUtcMs) <= TOLERANCE_MS) return fixture;
  }
  return null;
}

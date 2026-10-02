// Static, hand-maintained broadcast table for European competitions — per
// spec, top-flight broadcast rights follow a simple single/dual-rightsholder-
// per-competition pattern (unlike Brazil/Argentina/Mexico, which needs
// scraping because rights there are fragmented and PPV-heavy). Update a few
// times a season, not per-match.
//
// Every competition maps to an ordered list of market groups — local
// (the competition's home country), UK, and US — each rendered as its own
// labeled group on the fixture card rather than one flat unlabeled list,
// so it's clear which channel is available where.
//
// Researched against current league/UEFA rights notices for the 2026/27
// season. Two
// markets are deliberately absent for specific competitions:
// - Premier League has no separate "local" group: its home market IS the UK.
// - Ligue 1's local (France) and UK rights are the exact same broadcaster —
//   Ligue1+ (the LFP's own platform) is the sole primary broadcaster for
//   France as of 2026/27 and also serves the UK/Ireland market. They remain
//   separate groups so an exact market feed can replace either one cleanly.
// - Champions League has no single "local" market at all (pan-European).
const MARKET_US_EN = "US & Canada (English)";
const MARKET_US_ES = "US & Canada (Spanish)";

const MARKETS = {
  // Spain appears on every competition below, added 2026-08-16 at the user's
  // request ("I would love to watch FR and DE matches in spanish channels").
  // Researched, not assumed: DAZN holds the whole "Big 5" in Spain for
  // 2026/27 — Serie A, Bundesliga, Ligue 1 and the Premier League — and
  // Movistar Plus+ carries DAZN as a channel within its own package, so both
  // are listed. The three UEFA club competitions are Movistar Plus+ and
  // Orange. These are rightsholder-level entries; where a Spanish EPG or
  // LaLiga's own API supplies the exact channel for a given match, that
  // replaces this group (see attachLiveBroadcasts in scripts/build-data.js).
  "Premier League": [
    { label: "UK", channels: ["Sky Sports", "TNT Sports"] },
    { label: "Spain", channels: ["DAZN", "Movistar Plus+"] },
    { label: MARKET_US_EN, channels: ["Peacock", "NBC", "USA Network"] },
  ],
  "La Liga": [
    { label: "Spain", channels: ["DAZN", "Movistar Plus+"] },
    { label: "UK", channels: ["Premier Sports", "Disney+"] },
    { label: MARKET_US_EN, channels: ["ESPN+", "ESPN", "ESPN Deportes"] },
  ],
  Bundesliga: [
    { label: "Germany", channels: ["DAZN", "Sky Deutschland", "WOW"] },
    { label: "Spain", channels: ["DAZN", "Movistar Plus+"] },
    {
      label: "UK",
      channels: (kickoffUTC) => {
        const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", weekday: "short" }).format(new Date(kickoffUTC));
        if (day === "Fri") return ["BBC iPlayer", "YouTube"];
        if (day === "Sat") return ["Sky Sports"];
        if (day === "Sun") return ["Amazon Prime Video"];
        return [];
      },
    },
    { label: MARKET_US_EN, channels: ["USA Network", "Fandango", "Peacock"] },
    { label: MARKET_US_ES, channels: ["Telemundo", "Universo", "Peacock"] },
  ],
  "Serie A": [
    { label: "Italy", channels: ["DAZN", "Sky Italia"] },
    { label: "Spain", channels: ["DAZN", "Movistar Plus+"] },
    { label: "UK", channels: ["TNT Sports", "DAZN"] },
    { label: MARKET_US_EN, channels: ["Paramount+", "CBS"] },
  ],
  "Ligue 1": [
    { label: "France", channels: ["Ligue1+"] },
    { label: "UK", channels: ["Ligue1+"] },
    { label: "Spain", channels: ["DAZN", "Movistar Plus+"] },
    { label: MARKET_US_EN, channels: ["beIN Sports"] },
  ],
  "UEFA Champions League": [
    { label: "UK", channels: ["HBO Max", "Amazon Prime Video"] },
    // Telefónica is the Spanish rightsholder; Orange distributes the
    // Movistar channel but is not a separate match feed.
    { label: "Spain", channels: ["Movistar Plus+"] },
    { label: "France", channels: ["Canal+", "M6"] },
    { label: "Germany", channels: ["DAZN", "Amazon Prime Video"] },
    { label: "Italy", channels: ["Sky"] },
    { label: "Portugal", channels: ["SPORT TV"] },
    { label: "Canada", channels: ["DAZN"] },
    { label: MARKET_US_EN, channels: ["Paramount+", "DAZN"] },
    { label: MARKET_US_ES, channels: ["TUDN"] },
  ],
};

export function broadcastGroupsFor(competition, kickoffUTC) {
  const groups = MARKETS[competition] ?? [];
  return groups
    .map((g) => ({
      label: g.label,
      channels: typeof g.channels === "function" ? g.channels(kickoffUTC) : g.channels,
    }))
    .filter((g) => g.channels.length > 0);
}

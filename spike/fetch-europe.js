// Fetches upcoming fixtures for the 5 major European leagues + Champions
// League from football-data.org's v4 API (free tier). Named "fetch-" not
// "scrape-" — this is a clean JSON API, no HTML parsing involved.
//
// Free tier covers exactly: Premier League (PL), La Liga (PD), Bundesliga
// (BL1), Serie A (SA), Ligue 1 (FL1), Champions League (CL) — plus a few
// competitions we don't track (Eredivisie, Primeira Liga, Championship,
// World Cup, Euros). Europa League and domestic cups (FA Cup, Copa del Rey,
// etc.) are NOT in the free tier — deliberately not requested here, so
// there's no possibility of a "plan doesn't include this" error.
//
// Unlike the BR/AR/MX scrapers, this is a single authoritative source (no
// multi-site name-variant merging needed) and gives an absolute UTC kickoff
// time directly, so entries carry `kickoffUTC` already resolved rather than
// the dateAnchor/local-time-string shape the other scrapers use.
const COMPETITIONS = [
  { code: "PL", name: "Premier League" },
  { code: "PD", name: "La Liga" },
  { code: "BL1", name: "Bundesliga" },
  { code: "SA", name: "Serie A" },
  { code: "FL1", name: "Ligue 1" },
  { code: "CL", name: "UEFA Champions League" },
];

const WINDOW_DAYS = 10; // a little beyond the site's 7-day forward window, matching the other sources' margin

function dateOffset(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

async function fetchCompetition(code, token, dateFrom, dateTo) {
  const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`, {
    headers: { "X-Auth-Token": token },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.matches ?? [];
}

function toEntry(match, competitionName) {
  return {
    source: "football-data",
    competition: competitionName,
    competitionCode: match.competition?.code ?? null,
    competitionLogoUrl: match.competition?.emblem ?? null,
    homeTeam: match.homeTeam?.name ?? null,
    awayTeam: match.awayTeam?.name ?? null,
    homeLogo: match.homeTeam?.crest ?? null,
    awayLogo: match.awayTeam?.crest ?? null,
    kickoffUTC: match.utcDate ?? null,
    channels: [], // no broadcast data in this API — filled in from spike/uk-broadcast.js
  };
}

export async function fetchEurope({ token }) {
  if (!token) {
    console.warn("[europe] no FOOTBALL_DATA_TOKEN set, skipping European fixtures");
    return [];
  }
  const dateFrom = dateOffset(0);
  const dateTo = dateOffset(WINDOW_DAYS);
  const entries = [];
  for (const { code, name } of COMPETITIONS) {
    try {
      const matches = await fetchCompetition(code, token, dateFrom, dateTo);
      for (const m of matches) {
        if (!m.homeTeam?.name || !m.awayTeam?.name || !m.utcDate) continue; // incomplete fixture (e.g. TBD qualifier slot) — skip rather than guess
        entries.push(toEntry(m, name));
      }
    } catch (err) {
      console.error(`[europe] skipping ${name}: ${err.message}`);
    }
  }
  return entries;
}

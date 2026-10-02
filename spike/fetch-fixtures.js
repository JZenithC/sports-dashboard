// Fixture source of truth: TheSportsDB, using the free shared test key ("123").
// No signup required. API-Football's free tier was tried first and rejected —
// it only serves 2022-2024 seasons ("Free plans do not have access to this
// season, try from 2022 to 2024"), which is useless for a live dashboard.
//
// Caveat: the "123" key is a shared/rate-limited test key per TheSportsDB's own
// docs (not meant for production). Fine for this spike; a real ~$9/mo Patreon
// key would be the production choice if this source proves out.
//
// Scope (per current instructions): Americas only for now — Brazil, Argentina,
// Mexico domestic leagues/cups, plus the two CONMEBOL club competitions these
// countries' clubs actually play in. European leagues/cups are deliberately
// left out until this is working end-to-end.

const API_BASE = "https://www.thesportsdb.com/api/v1/json/123";

// Domestic league/cup IDs — each verified directly against lookupleague.php.
export const DOMESTIC_LEAGUES = {
  Brasileirão: 4351,
  "Argentine Primera División": 4406,
  "Liga MX": 4350,
  "Copa do Brasil": 4725,
  "Copa Argentina": 4500,
  // No current Mexican domestic cup equivalent to Copa do Brasil/Copa Argentina —
  // Copa MX was discontinued in 2018-19. "Campeón de Campeones" (id 5662) exists
  // but is a single-match season-opener, not an ongoing cup competition.
};

// CONMEBOL club competitions: Mexican clubs are not currently invited to these
// (that ended years ago), so in practice this only ever surfaces BR/ARG clubs —
// but we filter generically by participating club nationality rather than
// hardcoding that assumption, in case it changes.
export const CONTINENTAL_LEAGUES = {
  "Copa Libertadores": 4501,
  "Copa Sudamericana": 4724,
};

const RELEVANT_COUNTRIES = new Set(["Brazil", "Argentina", "Mexico"]);

// Which country's clock the venue-local kickoff time should be shown in.
const DOMESTIC_LEAGUE_COUNTRY = {
  Brasileirão: "Brazil",
  "Copa do Brasil": "Brazil",
  "Argentine Primera División": "Argentina",
  "Copa Argentina": "Argentina",
  "Liga MX": "Mexico",
};

async function apiGet(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error(`TheSportsDB ${path} -> HTTP ${res.status}`);
  return res.json();
}

const teamCountryCache = new Map();
async function getTeamCountry(teamId) {
  if (teamCountryCache.has(teamId)) return teamCountryCache.get(teamId);
  const json = await apiGet(`/lookupteam.php?id=${teamId}`);
  const country = json.teams?.[0]?.strCountry ?? null;
  teamCountryCache.set(teamId, country);
  return country;
}

function toFixture(item, competition, venueCountry) {
  const kickoffUTC = item.strTimestamp ? `${item.strTimestamp}Z` : null;
  return {
    id: item.idEvent,
    competition,
    homeTeam: item.strHomeTeam,
    awayTeam: item.strAwayTeam,
    homeTeamId: item.idHomeTeam,
    awayTeamId: item.idAwayTeam,
    kickoffUTC,
    venueCountry,
  };
}

function withinWindow(fixture, now, cutoff) {
  if (!fixture.kickoffUTC) return false;
  const d = new Date(fixture.kickoffUTC);
  return d >= now && d <= cutoff;
}

// TheSportsDB's eventsnextleague.php returns the next ~15 upcoming events for a
// league regardless of date range, so we fetch then filter to the window here.
export async function fetchFixtures({ days = 7 } = {}) {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);

  const results = [];

  for (const [name, leagueId] of Object.entries(DOMESTIC_LEAGUES)) {
    try {
      const json = await apiGet(`/eventsnextleague.php?id=${leagueId}`);
      for (const item of json.events || []) {
        const fixture = toFixture(item, name, DOMESTIC_LEAGUE_COUNTRY[name]);
        if (withinWindow(fixture, now, cutoff)) results.push(fixture);
      }
    } catch (err) {
      console.error(`[fixtures] ${name}: ${err.message}`);
    }
  }

  for (const [name, leagueId] of Object.entries(CONTINENTAL_LEAGUES)) {
    try {
      const json = await apiGet(`/eventsnextleague.php?id=${leagueId}`);
      for (const item of json.events || []) {
        const fixture = toFixture(item, name, null);
        if (!withinWindow(fixture, now, cutoff)) continue;
        const [homeCountry, awayCountry] = await Promise.all([
          getTeamCountry(fixture.homeTeamId),
          getTeamCountry(fixture.awayTeamId),
        ]);
        // Venue is the home team's country — only meaningful for display if it's
        // one of ours; otherwise leave it null and fall back to UTC-only display.
        if (RELEVANT_COUNTRIES.has(homeCountry)) fixture.venueCountry = homeCountry;
        if (RELEVANT_COUNTRIES.has(homeCountry) || RELEVANT_COUNTRIES.has(awayCountry)) {
          results.push(fixture);
        }
      }
    } catch (err) {
      console.error(`[fixtures] ${name}: ${err.message}`);
    }
  }

  return results;
}

// Fetches MLB schedule/broadcast and standings data from statsapi.mlb.com —
// a free, public, unauthenticated, official API. Named "fetch-" not
// "scrape-" like spike/fetch-europe.js: clean JSON, no HTML parsing.
//
// Unlike the soccer pipeline, this is a single authoritative source with no
// cross-site name matching needed — broadcast data (including which
// national/home/away TV channel airs each game) comes bundled with the
// schedule itself. Verified live against the real August 2026 schedule
// before writing this, including national streaming exclusives (Apple TV+,
// Peacock) and this season's regional-network carrier changes.
import { MLB_TEAMS, DIVISION_BY_ID } from "./mlb-teams.js";

const BASE = "https://statsapi.mlb.com/api/v1";

// This dashboard's MLB view is intentionally U.S.-only. Sportsnet and TVA
// Sports are the Canadian Blue Jays feeds; U.S. regional channels whose names
// contain "SportsNet" (for example SportsNet LA) remain eligible.
const NON_US_CHANNELS = new Set(["Sportsnet", "TVA Sports", "TV Azteca"]);

function dateStr(date) {
  return date.toISOString().slice(0, 10);
}

// Dedupe-by-name within a broadcast group — national broadcasts (e.g. TBS)
// are listed once per side (home + away) with identical fields, which would
// otherwise show the same channel chip twice on one card.
function dedupeChannelNames(broadcasts) {
  return [...new Set(broadcasts.map((b) => b.name))];
}

// Groups a game's broadcasts into {label, channels} — the same shape
// spike/euro-broadcast.js already produces for Europe's multi-market
// display, so the frontend's existing broadcastHtml() needs no changes.
// Order (National, Home, Away) matches the matchup card's left-to-right
// team order (home team is shown first — see renderEvent() in index.html).
export function buildBroadcastGroups(broadcasts, homeTeamName, awayTeamName) {
  const tv = (broadcasts ?? []).filter((b) => b.type === "TV" && !NON_US_CHANNELS.has(b.name));
  const national = dedupeChannelNames(tv.filter((b) => b.isNational));
  const home = dedupeChannelNames(tv.filter((b) => !b.isNational && b.homeAway === "home"));
  const away = dedupeChannelNames(tv.filter((b) => !b.isNational && b.homeAway === "away"));

  const groups = [];
  if (national.length) groups.push({ label: "National", channels: national });
  if (home.length) groups.push({ label: `${homeTeamName} (home)`, channels: home });
  if (away.length) groups.push({ label: `${awayTeamName} (away)`, channels: away });
  return groups;
}

// Game states worth showing at all — everything else (Postponed, Cancelled,
// Suspended) is dropped from both the upcoming and past windows rather than
// shown as if it happened or will happen as scheduled. MLB's own
// `abstractGameState` covers this cleanly: "Preview" (upcoming), "Live"
// (mid-game — shouldn't normally land in our ±7-day-from-now window logic,
// but treated as upcoming/ignorable rather than crashing on it), "Final"
// (completed). Anything else (the postponed/cancelled states use their own
// distinct detailedState values, not one of these three) is dropped.
function isRealGame(status) {
  return ["Preview", "Live", "Final"].includes(status?.abstractGameState);
}

export async function fetchMlbGames({ startDate, endDate }) {
  const url = `${BASE}/schedule?sportId=1&startDate=${dateStr(startDate)}&endDate=${dateStr(endDate)}&hydrate=broadcasts(all),team`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  const games = [];
  for (const day of data.dates ?? []) {
    for (const g of day.games ?? []) {
      if (!isRealGame(g.status)) continue;
      const home = g.teams?.home?.team;
      const away = g.teams?.away?.team;
      if (!home?.id || !away?.id || !g.gameDate) continue; // incomplete entry — skip rather than guess
      const homeInfo = MLB_TEAMS[home.id];
      games.push({
        gamePk: g.gamePk,
        homeTeamId: home.id,
        awayTeamId: away.id,
        homeTeam: home.name,
        awayTeam: away.name,
        // Venue-local time is approximated as the home team's own park
        // timezone — correct for essentially every game; a neutral-site
        // game (e.g. a London Series game) would show the wrong local zone,
        // an acceptable gap for a personal dashboard rather than added
        // complexity to detect it.
        timezone: homeInfo?.timezone ?? "America/New_York",
        gameDateUTC: g.gameDate,
        isFinal: g.status.abstractGameState === "Final",
        broadcastGroups: buildBroadcastGroups(g.broadcasts, home.name, away.name),
      });
    }
  }
  return games;
}

function readStat(record, key) {
  const v = record[key];
  return typeof v === "number" ? v : Number(v) || 0;
}

export async function fetchMlbStandings({ season }) {
  const url = `${BASE}/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // { AL: { divisions: [{name, teams:[...]}], wildcard: [...] }, NL: {...} }
  const result = { AL: { divisions: [], wildcard: [] }, NL: { divisions: [], wildcard: [] } };
  const wildcardPool = { AL: [], NL: [] };

  for (const record of data.records ?? []) {
    const meta = DIVISION_BY_ID[record.division?.id];
    if (!meta) continue; // unrecognized division id — skip rather than guess
    const teams = (record.teamRecords ?? []).map((t) => ({
      teamId: t.team?.id ?? null,
      team: t.team?.name ?? "Unknown",
      wins: readStat(t, "wins"),
      losses: readStat(t, "losses"),
      pct: t.winningPercentage ?? null,
      gamesBack: t.gamesBack ?? "-",
      divisionRank: Number(t.divisionRank) || null,
      wildCardRank: t.wildCardRank ? Number(t.wildCardRank) : null,
      wildCardGamesBack: t.wildCardGamesBack ?? null,
    }));
    teams.sort((a, b) => (a.divisionRank ?? 99) - (b.divisionRank ?? 99));
    result[meta.league].divisions.push({ name: meta.division, teams });
    wildcardPool[meta.league].push(...teams.filter((t) => t.divisionRank !== 1));
  }

  for (const league of ["AL", "NL"]) {
    result[league].divisions.sort((a, b) => ["East", "Central", "West"].indexOf(a.name) - ["East", "Central", "West"].indexOf(b.name));
    result[league].wildcard = wildcardPool[league]
      .filter((t) => t.wildCardRank != null)
      .sort((a, b) => a.wildCardRank - b.wildCardRank);
  }

  return result;
}

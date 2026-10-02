// Knockout-stage progress (Round of 16 onward) for Copa do Brasil and Copa
// Argentina — the two cups with no standings table (see scrape-standings.js).
//
// Previously scraped Wikipedia (English for Copa do Brasil, Spanish for Copa
// Argentina) — technically workable, but too laggy in practice: results from
// matches played 1-3 days earlier were still missing days later, since it's
// crowd-edited. Switched to Promiedos (promiedos.com.ar), a dedicated
// football results site: no robots.txt exists on the domain (checked
// directly — the site serves its own custom 404 for that path, not a
// restriction), no bot-detection wall observed, and every league page ships
// a `__NEXT_DATA__` JSON blob (Next.js's own hydration payload) in the raw
// server-rendered HTML — a structured bracket object, not a page to parse
// visually. Verified live: the exact match Wikipedia was missing (a leg 1
// played days earlier) showed up correctly here.
//
// Each tie's leg count (1 or 2) is read directly from how many games
// Promiedos lists for that pairing, rather than assumed per-competition —
// more robust than hardcoding "Copa do Brasil is always two-legged", though
// in practice a competition's format is consistent across all its ties.
//
// This is the one place a match *result* enters the system — deliberately
// scoped to a decided cup tie (a two-legged aggregate, or a single-match
// result), per the narrow carve-out documented in claude.md's "Out of
// scope" section. Nothing here should grow into general score tracking.
import { CANONICAL } from "./competition-scope.js";
import { normalizeTeam } from "./match.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const SOURCES = [
  { competition: CANONICAL.COPA_DO_BRASIL, path: "copa-do-brasil/bbf" },
  { competition: CANONICAL.COPA_ARGENTINA, path: "copa-argentina/gea" },
  // The CONMEBOL cups' knockout rounds are two-legged, which is exactly what
  // this module already models — without them a Libertadores round-of-16
  // first leg showed no round, no leg number and no first-leg score.
  { competition: CANONICAL.COPA_LIBERTADORES, path: "libertadores/bac" },
  { competition: CANONICAL.COPA_SUDAMERICANA, path: "conmebol-sudamericana/dij" },
];

// Promiedos labels stages in Spanish regardless of competition; only these
// (Round of 16 onward) are kept, per the "from 16s is enough" scope.
// "Playoffs" is Sudamericana's extra knockout round feeding the last 16.
const ROUND_NAME_PATTERN = /^(Playoffs|Octavos de Final|Cuartos de Final|Semifinales|Final)$/i;
const PLACEHOLDER_ID = -1; // Promiedos' marker for a bracket slot not yet decided by an earlier round

function normalizeRoundLabel(name) {
  if (/playoffs/i.test(name)) return "Playoff Round";
  if (/octavos/i.test(name)) return "Round of 16";
  if (/cuartos/i.test(name)) return "Quarterfinals";
  if (/semifinales/i.test(name)) return "Semifinals";
  if (/^final$/i.test(name)) return "Final";
  return name;
}

async function fetchBracketData(path) {
  const res = await fetch(`https://www.promiedos.com.ar/league/${path}`, {
    headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "es-ES,es;q=0.9" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const marker = 'id="__NEXT_DATA__"';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error("__NEXT_DATA__ blob not found in page");
  const scriptStart = html.indexOf(">", start) + 1;
  const scriptEnd = html.indexOf("</script>", scriptStart);
  const json = JSON.parse(html.slice(scriptStart, scriptEnd));
  return json.props?.pageProps?.data ?? null;
}

function isPlayed(game) {
  return game?.status?.name === "Finalizado" && Array.isArray(game.scores);
}

// Look up a team's goals by identity rather than assuming scores[i] lines up
// with teams[i] in a fixed home/away order (leg 2 reverses home/away).
function goalsFor(game, teamName) {
  const idx = game.teams.findIndex((t) => t.name === teamName);
  return idx === -1 ? null : game.scores[idx];
}

// Promiedos format: "DD-MM-YYYY HH:mm" — not lexicographically sortable or
// Date-parseable across locales as-is.
function toSortKey(startTime) {
  const m = (startTime || "").match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})/);
  return m ? `${m[3]}${m[2]}${m[1]}${m[4]}${m[5]}` : "";
}
function toIsoDate(startTime) {
  const m = (startTime || "").match(/^(\d{2})-(\d{2})-(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Promiedos names a club differently from the broadcast sites the fixtures
// come from ("Liga de Quito" vs "LDU Quito", "Universidad Católica" vs
// "CDU Católica"), so each tie also carries the alias-resolved keys the
// fixtures use. Without these the frontend's plain accent-stripping match
// silently failed on exactly those clubs.
function tieKeys(teamA, teamB) {
  return { teamKeys: [normalizeTeam(teamA), normalizeTeam(teamB)].sort() };
}

function buildTwoLeggedTie(games) {
  const [leg1, leg2] = [...games].sort((a, b) => toSortKey(a.start_time).localeCompare(toSortKey(b.start_time)));
  const teamA = leg1.teams[0].name;
  const teamB = leg1.teams[1].name;

  const leg1Score = isPlayed(leg1) ? `${goalsFor(leg1, teamA)}-${goalsFor(leg1, teamB)}` : null;
  const leg2Played = isPlayed(leg2);
  const leg2Score = leg2Played ? `${goalsFor(leg2, teamA)}-${goalsFor(leg2, teamB)}` : null;
  const leg2Date = !leg2Played ? toIsoDate(leg2.start_time) : null;

  let aggregate = null;
  let winner = null;
  if (leg1Score && leg2Score) {
    const [a1, b1] = leg1Score.split("-").map(Number);
    const [a2, b2] = leg2Score.split("-").map(Number);
    const totalA = a1 + a2;
    const totalB = b1 + b2;
    aggregate = `${totalA}-${totalB}`;
    if (totalA !== totalB) winner = totalA > totalB ? teamA : teamB;
  }

  return { teamA, teamB, ...tieKeys(teamA, teamB), leg1Score, leg2Date, leg2Score, aggregate, winner };
}

function buildSingleMatchTie(games) {
  const [game] = games;
  const teamA = game.teams[0].name;
  const teamB = game.teams[1].name;
  const played = isPlayed(game);
  const score = played ? `${goalsFor(game, teamA)}-${goalsFor(game, teamB)}` : null;
  const date = !played ? toIsoDate(game.start_time) : null;

  let winner = null;
  if (played) {
    const [gA, gB] = [goalsFor(game, teamA), goalsFor(game, teamB)];
    if (gA !== gB) winner = gA > gB ? teamA : teamB;
  }

  return { teamA, teamB, ...tieKeys(teamA, teamB), score, date, winner };
}

async function scrapeCompetitionBracket(competition, path) {
  const data = await fetchBracketData(path);
  if (!data?.brackets?.stages) throw new Error("no bracket data in response");

  const rounds = [];
  let legs = null;
  for (const stage of data.brackets.stages) {
    if (!ROUND_NAME_PATTERN.test(stage.name)) continue;
    const ties = [];
    for (const group of stage.groups ?? []) {
      const games = group.games ?? [];
      const participants = group.participants ?? [];
      if (!games.length || participants.some((p) => p.id === PLACEHOLDER_ID)) continue; // undrawn ("A confirmar")
      legs ??= games.length >= 2 ? 2 : 1;
      ties.push(games.length >= 2 ? buildTwoLeggedTie(games) : buildSingleMatchTie(games));
    }
    if (ties.length) rounds.push({ round: normalizeRoundLabel(stage.name), ties });
  }
  return rounds.length ? { competition, legs: legs ?? 1, rounds } : null;
}

export async function scrapeBrackets() {
  const brackets = [];
  for (const { competition, path } of SOURCES) {
    try {
      const bracket = await scrapeCompetitionBracket(competition, path);
      if (bracket) brackets.push(bracket);
      else console.warn(`[brackets] ${competition}: no knockout ties found yet, skipping`);
    } catch (err) {
      console.error(`[brackets] skipping ${competition}: ${err.message}`);
    }
  }
  return brackets;
}

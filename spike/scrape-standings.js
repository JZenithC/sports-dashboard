// League/group standings tables, scraped from ESPN's soccer/table pages.
//
// These pages are protected by an AWS WAF bot-challenge that rejects bare
// requests (curl -I with no Accept/Accept-Language returns HTTP 202 with an
// empty body) — a full browser-like header set (UA + Accept + Accept-Language)
// is required and reliably passes. Confirmed live before writing this file.
//
// Rather than parsing the rendered <table> markup (which lazy-loads team
// crests as base64 placeholder gifs, unusable for self-hosting), we pull the
// same data ESPN's own page hydrates from: a `window['__espnfitt__']` JSON
// blob embedded in a <script> tag. It's structured, includes real crest CDN
// URLs, and is far less likely to break on a minor markup change than table
// cell parsing would be.
import { CANONICAL } from "./competition-scope.js";
import { COMPETITION_LOGOS } from "./logos.js";
import { cacheImage } from "./image-cache.js";
import { zoneFor, TABLE_NOTES } from "./standings-zones.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

// ESPN's league codes for the tables we track. Copa do Brasil / Copa
// Argentina are deliberately absent — pure knockout cups, no standings table
// exists for them anywhere (confirmed by direct research) — see
// scrape-brackets.js for their round-by-round progress instead.
const SOURCES = [
  { competition: CANONICAL.BRASILEIRAO, code: "bra.1" },
  { competition: CANONICAL.ARGENTINE_PRIMERA, code: "arg.1" },
  { competition: CANONICAL.LIGA_MX, code: "mex.1" },
  { competition: CANONICAL.COPA_LIBERTADORES, code: "conmebol.libertadores" },
  { competition: CANONICAL.COPA_SUDAMERICANA, code: "conmebol.sudamericana" },
];

function extractFitt(html) {
  const marker = "window['__espnfitt__']";
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const eqIdx = html.indexOf("=", start) + 1;
  let end = html.indexOf(";</script>", eqIdx);
  if (end === -1) end = html.indexOf("</script>", eqIdx);
  return JSON.parse(html.slice(eqIdx, end).trim());
}

async function fetchGroups(code) {
  const res = await fetch(`https://www.espn.com/soccer/table/_/league/${code}`, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = extractFitt(await res.text());
  if (!data) throw new Error("standings data blob not found in page");
  return data.page.content.standings.groups; // { headers, groups: [{ name, standings: [...] }] }
}

function readStat(headers, stats, type) {
  const meta = headers[type];
  return meta ? stats[meta.i] : undefined;
}

async function buildRow(headers, position, entry, competition) {
  const { team, stats } = entry;
  return {
    position,
    team: team.displayName,
    teamLogo: (await cacheImage(team.logo, { subdir: "teams" })) ?? null,
    played: Number(readStat(headers, stats, "gamesplayed")) || 0,
    win: Number(readStat(headers, stats, "wins")) || 0,
    draw: Number(readStat(headers, stats, "ties")) || 0,
    loss: Number(readStat(headers, stats, "losses")) || 0,
    gf: Number(readStat(headers, stats, "pointsfor")) || 0,
    ga: Number(readStat(headers, stats, "pointsagainst")) || 0,
    gd: Number(readStat(headers, stats, "pointdifferential")) || 0,
    points: Number(readStat(headers, stats, "points")) || 0,
    zone: zoneFor(competition, position),
  };
}

export async function scrapeStandings() {
  const tables = [];
  for (const { competition, code } of SOURCES) {
    try {
      const { headers, groups } = await fetchGroups(code);
      const parsedGroups = [];
      for (const group of groups ?? []) {
        if (!group.standings?.length) continue;
        const rows = await Promise.all(
          group.standings.map((entry, i) => buildRow(headers, i + 1, entry, competition))
        );
        // Only label sub-tables when there's more than one group (Zone/Group
        // split) — a single flat table doesn't need a redundant label.
        parsedGroups.push({ label: groups.length > 1 ? group.name : null, rows });
      }
      if (!parsedGroups.length) {
        console.warn(`[standings] ${competition}: no groups returned, skipping (likely between stages)`);
        continue;
      }
      tables.push({
        competition,
        competitionLogo: COMPETITION_LOGOS[competition] ?? null,
        note: TABLE_NOTES[competition] ?? null,
        groups: parsedGroups,
      });
    } catch (err) {
      console.error(`[standings] skipping ${competition}: ${err.message}`);
    }
  }
  return tables;
}

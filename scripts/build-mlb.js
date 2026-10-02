// Builds public/data/mlb.json — the MLB counterpart to fixtures.json/
// standings.json. Kept as its own script/output (like build-standings.js is
// kept separate from build-data.js) so a problem in one sport's pipeline can
// never affect the other's.
//
// Much simpler than the soccer pipeline: MLB Stats API is a single
// authoritative source for schedule, broadcasts, and standings — no
// cross-site name matching or roster-checking needed. The one scraped piece
// is replay/rebroadcast times, sourced from spike/mlb-replay-sources.js —
// per-team stations plus national channels; see that file for the coverage
// map and the two listing shapes its sources return.
import fs from "fs";
import { fetchMlbGames, fetchMlbStandings } from "../spike/fetch-mlb.js";
import { MLB_TEAMS, teamLogoUrl } from "../spike/mlb-teams.js";
import { MLB_REPLAY_SOURCES, MLB_NATIONAL_REPLAY_SOURCES } from "../spike/mlb-replay-sources.js";
import { cacheImage } from "../spike/image-cache.js";
import { channelDomainFor } from "../spike/channel-logos.js";
import { recordSource, writeHealth } from "../spike/source-health.js";
import { appendUpdates, diffRuns } from "../spike/updates.js";

function formatInZone(isoUTC, timeZone) {
  if (!isoUTC || !timeZone) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoUTC));
}

// YYYY-MM-DD in the given timezone — same convention as build-data.js's
// localDateKey, duplicated here rather than imported since each build-*.js
// script is deliberately self-contained (see build-standings.js's header
// comment: lets one pipeline fail without the other).
function localDateKey(isoUTC, timeZone) {
  if (!isoUTC || !timeZone) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(isoUTC));
}

function readJsonSafe(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

async function cacheChannelLogo(name) {
  const domain = channelDomainFor(name);
  return domain
    ? await cacheImage(`https://www.google.com/s2/favicons?domain=${domain}&sz=64`, { subdir: "channels", cacheKey: domain })
    : null;
}

async function buildBroadcastGroupsWithLogos(groups) {
  const out = [];
  for (const g of groups) {
    const channels = [];
    for (const name of g.channels) channels.push({ name, logo: await cacheChannelLogo(name) });
    out.push({ label: g.label, channels });
  }
  return out;
}

async function main() {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 86400000);
  const end = new Date(now.getTime() + 7 * 86400000);

  console.log("Fetching MLB schedule...");
  const rawGames = await fetchMlbGames({ startDate: start, endDate: end });
  recordSource("mlb-schedule", { label: "MLB schedule + broadcasts (statsapi)", group: "MLB", ok: true, items: rawGames.length });

  console.log("Fetching MLB standings...");
  const previous = readJsonSafe("public/data/mlb.json");
  let standings = previous?.standings ?? { AL: { divisions: [], wildcard: [] }, NL: { divisions: [], wildcard: [] } };
  try {
    standings = await fetchMlbStandings({ season: now.getFullYear() });
    recordSource("mlb-standings", { label: "MLB standings (statsapi)", group: "MLB", ok: true });
  } catch (err) {
    // Keep the previous run's standings rather than wiping them out — same
    // "one broken source shouldn't take down the page" principle
    // build-standings.js already follows.
    console.error(`[mlb] standings fetch failed, keeping previous: ${err.message}`);
    recordSource("mlb-standings", { label: "MLB standings (statsapi)", group: "MLB", ok: false, error: err.message });
  }

  console.log("Caching team + channel logos...");
  const teamLogoCache = new Map();
  async function logoFor(teamId) {
    if (!teamLogoCache.has(teamId)) {
      teamLogoCache.set(teamId, await cacheImage(teamLogoUrl(teamId), { subdir: "teams" }));
    }
    return teamLogoCache.get(teamId);
  }

  // Attaches a team crest + a "would make the postseason today" zone marker
  // to every standings row, mirroring the {tier, label} shape
  // spike/standings-zones.js already produces for soccer so the frontend can
  // reuse the same zone-highlight CSS. Division leader and wild-card
  // positions 1-3 (today's 3-team format) are zone-primary/zone-secondary;
  // everyone else gets no zone rather than a guessed "eliminated" marker —
  // magic-number elimination math isn't implemented here.
  // wildcard[] holds the same object references as divisions[].teams (see
  // fetchMlbStandings), so mutating a row once updates it in both places.
  for (const league of ["AL", "NL"]) {
    for (const division of standings[league].divisions) {
      for (const t of division.teams) {
        if (t.teamId) t.teamLogo = await logoFor(t.teamId);
        if (t.divisionRank === 1) t.zone = { tier: "primary", label: "Leads division" };
        else if (t.wildCardRank != null && t.wildCardRank <= 3) t.zone = { tier: "secondary", label: "Wild Card position" };
        else t.zone = null;
      }
    }
  }

  const built = [];
  for (const g of rawGames) {
    const [homeLogo, awayLogo, broadcastGroups] = await Promise.all([
      logoFor(g.homeTeamId),
      logoFor(g.awayTeamId),
      buildBroadcastGroupsWithLogos(g.broadcastGroups),
    ]);
    built.push({
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      homeLogo,
      awayLogo,
      kickoffUTC: g.gameDateUTC,
      kickoffLocal: formatInZone(g.gameDateUTC, g.timezone),
      kickoffUK: formatInZone(g.gameDateUTC, "Europe/London"),
      localDate: localDateKey(g.gameDateUTC, g.timezone),
      channels: [],
      broadcastGroups,
      isFinal: g.isFinal,
    });
  }

  console.log("Fetching replay listings...");
  const replayFailures = [];
  const replaySourceCount = Object.keys(MLB_REPLAY_SOURCES).length + MLB_NATIONAL_REPLAY_SOURCES.length;
  const replaysByTeam = new Map();
  for (const [teamIdStr, scraper] of Object.entries(MLB_REPLAY_SOURCES)) {
    const teamId = Number(teamIdStr);
    try {
      replaysByTeam.set(teamId, await scraper());
    } catch (err) {
      // One broken station never blanks the rest — same principle as the
      // soccer scrapers; that game just shows no replay info this run.
      console.error(`[mlb-replays] ${MLB_TEAMS[teamId]?.name ?? teamId}: ${err.message}`);
      replaysByTeam.set(teamId, []);
      replayFailures.push(`${MLB_TEAMS[teamId]?.name ?? teamId}: ${err.message}`);
    }
  }
  const nationalReplays = [];
  for (const scraper of MLB_NATIONAL_REPLAY_SOURCES) {
    try {
      nationalReplays.push(...(await scraper()));
    } catch (err) {
      console.error(`[mlb-replays] national: ${err.message}`);
      replayFailures.push(`national: ${err.message}`);
    }
  }
  recordSource("mlb-replays", {
    label: "MLB replay listings (TV Passport + MASN + CHSN)",
    group: "MLB",
    ok: replayFailures.length < replaySourceCount,
    channelsOk: replaySourceCount - replayFailures.length,
    channelsTotal: replaySourceCount,
    error: replayFailures.join("; ") || null,
  });

  const nowMs = Date.now();
  const pastCutoff = nowMs - 7 * 86400000;
  const futureCutoff = nowMs + 7 * 86400000;

  const games = [];
  const recentGames = [];
  for (const g of built) {
    const t = Date.parse(g.kickoffUTC);
    if (t < pastCutoff || t > futureCutoff) continue;
    // Stable identity for the "watched" tracker (see api/watched.js) — same
    // key shape diffRuns() already uses below so one field serves both.
    g.watchKey = `mlb:${g.awayTeam}|${g.homeTeam}|${g.localDate}`;
    if (t >= nowMs) {
      games.push(g);
    } else if (g.isFinal) {
      // Past and not confirmed Final (e.g. a status-lag edge case) is
      // dropped rather than shown as if it happened — same "don't guess"
      // principle as the rest of this pipeline.
      recentGames.push(g);
    }
  }
  games.sort((a, b) => Date.parse(a.kickoffUTC) - Date.parse(b.kickoffUTC));
  recentGames.sort((a, b) => Date.parse(b.kickoffUTC) - Date.parse(a.kickoffUTC)); // most recent first

  // Attribute each replay listing to the game it re-airs, then attach a
  // single "Replay" broadcast-group per game (same {label, channels} shape
  // as broadcastGroups, each channel additionally carrying air times). A
  // game no source covers gets nothing — no placeholder, no guess.
  //
  // Matchup-shaped listings ({teams}) are attributed by air window: a replay
  // airs AFTER its game, so require the air time to fall 2-72h after the
  // game's start. The 2h minimum is what separates a replay from the
  // original broadcast on stations that leave repeat flags unset (see
  // spike/replays/tvpassport.js); 72h keeps "classics" programming between
  // the same clubs from ever attaching to a current series.
  const MIN_AIR_LAG_MS = 2 * 3600000;
  const MAX_AIR_LAG_MS = 72 * 3600000;
  const pairKey = (a, b) => [a, b].sort().join("|");
  const recentByPair = new Map();
  for (const g of recentGames) {
    const key = pairKey(g.homeTeam, g.awayTeam);
    if (!recentByPair.has(key)) recentByPair.set(key, []);
    recentByPair.get(key).push(g);
  }
  const upcomingByPair = new Map();
  for (const g of games) {
    const key = pairKey(g.homeTeam, g.awayTeam);
    if (!upcomingByPair.has(key)) upcomingByPair.set(key, []);
    upcomingByPair.get(key).push(g);
  }
  const replaysByGame = new Map();
  const attach = (game, listing) => {
    if (!replaysByGame.has(game)) replaysByGame.set(game, []);
    replaysByGame.get(game).push(listing);
  };
  // Airings we know are a replay of this matchup but can't safely pin to one
  // game (see the ambiguity guard below). They never touch a game card, but
  // they DO belong in the catch-up list — otherwise the evening view empties
  // out while dozens of watchable replays sit in the data unshown.
  const ambiguousAirings = [];
  function assignByMatchup(listing) {
    const key = pairKey(listing.teams[0], listing.teams[1]);
    const lagOk = (g) => {
      const lag = Date.parse(listing.airTimeUTC) - Date.parse(g.kickoffUTC);
      return lag >= MIN_AIR_LAG_MS && lag <= MAX_AIR_LAG_MS;
    };
    // Mid-series ambiguity guard: if a not-yet-final game of the same pair
    // ALSO starts >=2h before this airing (series play the same matchup on
    // consecutive nights), the airing most likely re-airs THAT game — don't
    // pin it to the older game. Tomorrow's build re-derives with that game
    // final and attributes it properly.
    if ((upcomingByPair.get(key) ?? []).some(lagOk)) {
      if ((recentByPair.get(key) ?? []).length || (upcomingByPair.get(key) ?? []).length) ambiguousAirings.push(listing);
      return;
    }
    const candidates = (recentByPair.get(key) ?? []).filter(lagOk);
    if (!candidates.length) return; // re-air of a game outside the window — nothing to attach to
    // Doubleheaders: both same-pair games can qualify — a same-day replay is
    // of the most recent one already played.
    attach(candidates.reduce((a, b) => (Date.parse(a.kickoffUTC) > Date.parse(b.kickoffUTC) ? a : b)), listing);
  }
  for (const [teamId, listings] of replaysByTeam) {
    const teamZone = MLB_TEAMS[teamId]?.timezone ?? "America/New_York";
    for (const r of listings) {
      if (r.teams) {
        assignByMatchup(r);
      } else {
        // originalGameDateKey shape (MASN): the source names the replayed
        // game's own local date directly — match it in the team's home zone.
        const game = recentGames.find(
          (g) => (g.homeTeamId === teamId || g.awayTeamId === teamId) && localDateKey(g.kickoffUTC, teamZone) === r.originalGameDateKey
        );
        if (game) attach(game, { channel: r.channel, zone: teamZone, airTimeUTC: r.airTimeUTC });
      }
    }
  }
  for (const r of nationalReplays) assignByMatchup(r);

  // Same visibility the fights build logs: how much of what was fetched
  // actually got attributed. A large gap is expected in the evening — an
  // airing scheduled for tomorrow that replays a game still being played
  // tonight is deliberately withheld until that game is final (see the
  // ambiguity guard above), and the next morning's build picks it up.
  const fetchedAirings = [...replaysByTeam.values()].reduce((n, l) => n + l.length, 0) + nationalReplays.length;
  const attributed = [...replaysByGame.values()].reduce((n, l) => n + l.length, 0);
  console.log(`Replay airings: ${fetchedAirings} fetched, ${attributed} attributed to a final game`);

  // "Which game was this" label for catch-up rows, from the game's own
  // venue-local date (g.localDate) — a Monday-night ET game is "Monday's
  // game" even though its first pitch lands after midnight UK time.
  const gameDayLabel = (localDate) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short" }).format(
      new Date(`${localDate}T12:00:00Z`)
    );

  const replaySchedule = [];
  for (const [game, listings] of replaysByGame) {
    listings.sort((a, b) => Date.parse(a.airTimeUTC) - Date.parse(b.airTimeUTC));
    const channels = [];
    const seen = new Set();
    for (const l of listings) {
      const dedupeKey = `${l.channel}|${l.airTimeUTC}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const logo = await cacheChannelLogo(l.channel);
      channels.push({
        name: l.channel,
        logo,
        timeLocal: formatInZone(l.airTimeUTC, l.zone),
        timeUK: formatInZone(l.airTimeUTC, "Europe/London"),
        airTimeUTC: l.airTimeUTC,
      });
      // Flat airing-ordered mirror of the same matches — the "Catch up"
      // view sorts by when a replay AIRS (one row per airing, a game
      // repeating per re-air), while replayGroups above stays grouped per
      // game for the Past view.
      replaySchedule.push({
        airTimeUTC: l.airTimeUTC,
        // When the airing finishes, so the catch-up view can keep a replay
        // listed while it's still on and you can join it part-way through.
        // TV Passport gives the real slot length; MASN's guide doesn't, so
        // a ballgame's typical three hours stands in.
        endsAtUTC: new Date(Date.parse(l.airTimeUTC) + (l.durationMinutes ?? 180) * 60000).toISOString(),
        timeUK: formatInZone(l.airTimeUTC, "Europe/London"),
        channel: { name: l.channel, logo },
        // Same key as the source game, so marking one watched (live or from
        // any re-air) flags every other re-air of the same game too.
        watchKey: game.watchKey,
        label: `${game.awayTeam} @ ${game.homeTeam}`,
        logos: [game.awayLogo, game.homeLogo],
        sublabel: `played ${gameDayLabel(game.localDate)}`,
      });
    }
    game.replayGroups = [{ label: "Replay", channels }];
  }
  // Matchup-only rows for the airings the guard wouldn't pin to a game.
  // Labelled by matchup with no game date, since which game it replays is
  // exactly what isn't known yet.
  const teamIdByName = new Map(Object.entries(MLB_TEAMS).map(([id, t]) => [t.name, Number(id)]));
  const seenAmbiguous = new Set();
  for (const a of ambiguousAirings) {
    const key = `${a.channel}|${a.airTimeUTC}`;
    if (seenAmbiguous.has(key) || replaySchedule.some((r) => `${r.channel.name}|${r.airTimeUTC}` === key)) continue;
    seenAmbiguous.add(key);
    const [away, home] = a.teams;
    replaySchedule.push({
      airTimeUTC: a.airTimeUTC,
      endsAtUTC: new Date(Date.parse(a.airTimeUTC) + (a.durationMinutes ?? 180) * 60000).toISOString(),
      timeUK: formatInZone(a.airTimeUTC, "Europe/London"),
      channel: { name: a.channel, logo: await cacheChannelLogo(a.channel) },
      label: `${away} @ ${home}`,
      logos: [await logoFor(teamIdByName.get(away)), await logoFor(teamIdByName.get(home))].filter(Boolean),
      sublabel: "recent game",
    });
  }
  replaySchedule.sort((a, b) => Date.parse(a.airTimeUTC) - Date.parse(b.airTimeUTC));

  const generatedAt = new Date().toISOString();
  const output = { generatedAt, games, recentGames, replaySchedule, standings };

  // A game is "the same game" across builds by its two teams and its
  // venue-local date — ids would be stabler, but this keeps the key
  // identical in shape to the other two sports' so one differ serves all.
  appendUpdates(
    "mlb",
    diffRuns(previous?.games ?? [], games, {
      keyOf: (g) => `${g.awayTeam}|${g.homeTeam}|${g.localDate}`,
      describe: (g) => `${g.awayTeam} @ ${g.homeTeam} (${g.localDate})`,
    })
  );

  fs.mkdirSync("public/data", { recursive: true });
  fs.writeFileSync("public/data/mlb.json", JSON.stringify(output, null, 2), "utf8");
  writeHealth();
  console.log(`\nWrote public/data/mlb.json (${games.length} upcoming, ${recentGames.length} recent)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

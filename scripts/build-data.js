// Builds public/data/fixtures.json directly from the scraped broadcast sites, which
// is the primary match list (not TheSportsDB — its free tier can't reliably
// list a full week of upcoming matches; see project notes). Scraped entries
// already carry team names, competition, kickoff time, and channels.
//
// All logos (team crests, competition badges, channel icons) are downloaded
// and self-hosted under public/logos/ rather than referenced by remote URL —
// see spike/image-cache.js for why (some source CDNs 403 hotlinked requests
// from a browser's real Referer header, which silently broke some team logos
// in production even though they'd loaded fine in earlier testing).

import fs from "fs";
import { scrapeBrazil } from "../spike/scrape-brazil.js";
import { scrapeNuxtPlatform } from "../spike/scrape-nuxt-platform.js";
import { fetchEurope } from "../spike/fetch-europe.js";
import { normalizeTeam } from "../spike/match.js";
import { resolveAlias } from "../spike/team-aliases.js";
import { classifyCompetition, CONTINENTAL_CUPS, EURO_COMPETITIONS, CANONICAL } from "../spike/competition-scope.js";
import { COMPETITION_LOGOS } from "../spike/logos.js";
import { cacheImage } from "../spike/image-cache.js";
import { channelDomainFor } from "../spike/channel-logos.js";
import { broadcastGroupsFor } from "../spike/euro-broadcast.js";
import { displayNameFor } from "../spike/team-display-names.js";
import { isRivalry } from "../spike/rivalries.js";
import {
  fetchUkFootballAirings,
  fetchNaFootballAirings,
  fetchSaFootballAirings,
  fetchIberiaFootballAirings,
  fetchTycAgendaAirings,
  fetchItalyFootballAirings,
  fetchGermanyFootballAirings,
  fetchLaLigaBroadcastAirings,
  fetchSpanishMatchChannels,
  fetchFootyOnTvAirings,
} from "../spike/replays/football-replays.js";
import { recordSource, writeHealth, setChannelDiagnostics } from "../spike/source-health.js";
import { noteDrop, noteAttributed, noteSupplemented, replayDiagnostics, logReplayDiagnostics } from "../spike/replay-diagnostics.js";
import { appendUpdates } from "../spike/updates.js";

const COMPETITION_COUNTRY = {
  "Campeonato Brasileiro Série A": "Brazil",
  "Copa do Brasil": "Brazil",
  "Liga Profesional de Fútbol": "Argentina",
  "Copa Argentina": "Argentina",
  "Liga MX": "Mexico",
};

// The European leagues each get their OWN country rather than a single
// "Europe" bucket. Lumping five leagues together was fine when Europe was
// one block of fixtures, but it hid the thing the country axis exists to
// answer — a La Liga match and a Bundesliga match are no more alike than a
// Brasileirão and a Liga MX one. The Champions League genuinely has no home
// country and keeps a continental label of its own.
const EURO_COMPETITION_COUNTRY = {
  [CANONICAL.PREMIER_LEAGUE]: "England",
  [CANONICAL.LA_LIGA]: "Spain",
  [CANONICAL.BUNDESLIGA]: "Germany",
  [CANONICAL.SERIE_A]: "Italy",
  [CANONICAL.LIGUE_1]: "France",
  [CANONICAL.CHAMPIONS_LEAGUE]: "Europe",
};

const TIMEZONES = {
  Brazil: "America/Sao_Paulo",
  Argentina: "America/Argentina/Buenos_Aires",
  Mexico: "America/Mexico_City",
};

// Not DST-aware — fine here since none of Brazil/Argentina/Mexico currently
// observe DST, so a fixed offset holds year-round (unlike Europe/UK below,
// which is why that conversion uses proper Intl timezone math instead).
const UTC_OFFSET_HOURS = { Brazil: -3, Argentina: -3, Mexico: -6 };

// European leagues DO observe DST, so unlike the fixed-offset map above,
// these are real IANA zones fed straight into formatInZone()'s Intl-based
// conversion. "Europe" itself is deliberately never a key in TIMEZONES
// above — every read of TIMEZONES[e.country] for a European event falls
// through via `?? e.localZone` to one of these instead (see buildEvent()
// and the events-building loop below for where localZone is resolved).
const EURO_TIMEZONES = {
  [CANONICAL.PREMIER_LEAGUE]: "Europe/London",
  [CANONICAL.LA_LIGA]: "Europe/Madrid",
  [CANONICAL.BUNDESLIGA]: "Europe/Berlin",
  [CANONICAL.SERIE_A]: "Europe/Rome",
  [CANONICAL.LIGUE_1]: "Europe/Paris",
  // Champions League deliberately absent — no single "home league" the way
  // a domestic competition has one; resolved per-match instead (see
  // resolveEuroZone()).
};

// The Referer each team-logo CDN requires to not 403 the request (see
// spike/image-cache.js) — keyed by the scraper's own `source` field.
const REFERER_BY_SOURCE = {
  "/jogos-hoje/": "https://www.futebolnatv.com.br/",
  "/jogos-amanha/": "https://www.futebolnatv.com.br/",
  argentina: "https://www.futbolenvivoargentina.com/",
  mexico: "https://www.futbolenvivomexico.com/",
};

function toUtcISO(dateAnchorISO, hhmm, country) {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const [y, mo, d] = dateAnchorISO.split("-").map(Number);
  const utcH = h - UTC_OFFSET_HOURS[country];
  return new Date(Date.UTC(y, mo - 1, d, utcH, m)).toISOString();
}

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

// YYYY-MM-DD in the given timezone — used for grouping "by date" using each
// match's own local day, not the UTC day (e.g. a match at 1am UK Tuesday that
// kicked off 9pm Monday local belongs in Monday's listing).
function localDateKey(isoUTC, timeZone) {
  if (!isoUTC || !timeZone) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(isoUTC));
}

// Ids of fixture sources that failed this run. Beyond feeding the health
// panel, the accumulate-history step needs to know — see mergeFreshChannels().
const failedFixtureSources = new Set();

// Each fixture source is isolated and its outcome recorded. Isolation
// matters twice over: it's this project's stated failure policy (one broken
// source must never take the page down), and it's what makes the health
// panel work at all — a build that aborts never gets to publish the status
// saying why. Observed live: a transient `[mexico] HTTP 520` used to kill
// the whole run before fixtures.json was written.
//
// A country returning nothing for one run doesn't lose its matches: the
// accumulate-history step below merges the previous run's events back in,
// so the page degrades to slightly stale rather than empty.
async function collectSource(id, label, fn) {
  console.log(`Fetching ${label}...`);
  try {
    const rows = await fn();
    recordSource(id, { label, group: "Football fixtures", ok: true, items: rows.length });
    return rows;
  } catch (err) {
    console.error(`[${id}] skipping entirely: ${err.message}`);
    failedFixtureSources.add(id);
    recordSource(id, { label, group: "Football fixtures", ok: false, error: err.message });
    return [];
  }
}

async function collectRaw() {
  const brazil = await collectSource("fixtures-brazil", "Brazil fixtures (futebolnatv)", async () =>
    (await scrapeBrazil()).map((e) => ({ ...e, siteCountry: "brazil" }))
  );
  const argentina = await collectSource("fixtures-argentina", "Argentina fixtures (futbolenvivo)", async () =>
    (await scrapeNuxtPlatform("argentina")).map((e) => ({ ...e, siteCountry: "argentina" }))
  );
  const mexico = await collectSource("fixtures-mexico", "Mexico fixtures (futbolenvivo)", async () =>
    (await scrapeNuxtPlatform("mexico")).map((e) => ({ ...e, siteCountry: "mexico" }))
  );
  const europe = await collectSource("fixtures-europe", "Europe fixtures (football-data.org)", async () =>
    (await fetchEurope({ token: process.env.FOOTBALL_DATA_TOKEN })).map((e) => ({ ...e, siteCountry: "europe" }))
  );
  return [...brazil, ...argentina, ...mexico, ...europe];
}

const FIXTURE_SOURCE_MARKET = {
  brazil: "Brazil",
  argentina: "Argentina",
  mexico: "Mexico",
};

function broadcastGroupsFromFixtureSource(entry) {
  const market = FIXTURE_SOURCE_MARKET[entry.siteCountry];
  if (!market || !entry.channels?.length) return null;
  return [{ label: market, channels: [...entry.channels] }];
}

function mergeBroadcastGroups(target, source) {
  if (!source?.length) return;
  target.broadcastGroups ??= [];
  for (const group of source) {
    let existing = target.broadcastGroups.find((candidate) => candidate.label === group.label);
    if (!existing) {
      existing = { label: group.label, channels: [] };
      target.broadcastGroups.push(existing);
    }
    for (const channel of group.channels ?? []) {
      if (!existing.channels.includes(channel)) existing.channels.push(channel);
    }
  }
}

// futebolnatv.com.br entries anchor to a known date directly; futbolenvivo*
// entries carry the date in their (otherwise time-unreliable) startDate meta.
function resolveDateAnchor(entry) {
  if (entry.dateAnchor) return entry.dateAnchor;
  if (entry.startDateMeta) return entry.startDateMeta.split("T")[0];
  return null;
}

async function buildEvent(entry, competition, country, localZone = null) {
  const dateAnchor = resolveDateAnchor(entry);
  // football-data.org gives an absolute UTC timestamp directly — no
  // dateAnchor/local-time-string parsing needed for those entries.
  const kickoffUTC = entry.kickoffUTC ?? (dateAnchor && country ? toUtcISO(dateAnchor, entry.kickoffLocal, country) : null);
  const referer = REFERER_BY_SOURCE[entry.source];
  const [homeLogo, awayLogo, competitionLogo] = await Promise.all([
    cacheImage(entry.homeLogo, { subdir: "teams", referer }),
    cacheImage(entry.awayLogo, { subdir: "teams", referer }),
    // Only European entries carry a competitionLogoUrl (a known, stable
    // emblem URL from football-data.org) — cacheImage()'s on-disk dedup
    // means downloading the same competition's emblem repeatedly (once per
    // match) only actually fetches once.
    entry.competitionLogoUrl ? cacheImage(entry.competitionLogoUrl, { subdir: "competitions" }) : Promise.resolve(null),
  ]);
  const broadcastGroups = entry.broadcastGroups ?? broadcastGroupsFromFixtureSource(entry);
  return {
    competition,
    country,
    localZone,
    homeTeam: entry.homeTeam,
    awayTeam: entry.awayTeam,
    homeLogo,
    awayLogo,
    competitionLogo,
    kickoffUTC,
    channels: [...entry.channels],
    // Raw {label, channels: [name,...]} shape — logos cached later in
    // toFinalEvent(), same two-phase pattern the flat channels list above
    // already uses. The three country fixture sources are promoted to
    // market groups too, so their channels are not visually indistinguishable
    // from an unlabeled mixed row.
    broadcastGroups,
    // Carried through to the final event so already-archived entries can be
    // re-classified on every run (see the accumulate step below) — without
    // this, an event scoped in under one version of classifyCompetition()
    // stays archived under that verdict forever, even after a scope bug is
    // fixed, because a since-out-of-scope raw entry is filtered out upstream
    // and never produces a fresh record to overwrite the stale one.
    rawCompetitionLabel: entry.competition ?? null,
    rawCompetitionSlug: entry.competitionSlug ?? null,
    rawCompetitionCode: entry.competitionCode ?? null,
  };
}

async function main() {
  const raw = await collectRaw();

  const classified = raw
    .map((entry) => ({ entry, competition: classifyCompetition(entry) }))
    .filter((x) => x.competition);

  // Known clubs per country, gathered from this week's domestic-league
  // scrapes, used to decide (a) whether a continental-cup match involves
  // Brazil/Argentina/Mexico at all, and (b) which country's clock to display
  // its kickoff time in (the home team's country — approximated as whichever
  // of our three countries has a recognized club in the match, since we don't
  // have a real venue-country lookup; a two-legged tie played in a 4th
  // country would still display in the recognized side's timezone). A club
  // that only appears in cup ties and not domestically this week would be
  // missed entirely — an acceptable gap for personal-scale use (a missed
  // match is safer than guessing wrong).
  const knownClubsByCountry = { Brazil: new Set(), Argentina: new Set(), Mexico: new Set() };
  // normalizedTeamName -> IANA zone, from the 5 tracked domestic European
  // leagues this run — used only to resolve a Champions League match's
  // "local" time (see resolveEuroZone() below), since CL has no single
  // home league the way a domestic competition does.
  const knownClubsByLeague = new Map();
  for (const { entry, competition } of classified) {
    const country = COMPETITION_COUNTRY[competition];
    if (country) {
      knownClubsByCountry[country].add(normalizeTeam(entry.homeTeam));
      knownClubsByCountry[country].add(normalizeTeam(entry.awayTeam));
    }
    const zone = EURO_TIMEZONES[competition];
    if (zone) {
      knownClubsByLeague.set(normalizeTeam(entry.homeTeam), zone);
      knownClubsByLeague.set(normalizeTeam(entry.awayTeam), zone);
    }
  }

  function resolveClubCountry(normalizedTeam) {
    for (const [country, clubs] of Object.entries(knownClubsByCountry)) {
      if (clubs.has(normalizedTeam)) return country;
    }
    return null;
  }

  function resolveContinentalCountry(entry) {
    return resolveClubCountry(normalizeTeam(entry.homeTeam)) ?? resolveClubCountry(normalizeTeam(entry.awayTeam));
  }

  // A continental-cup tie can pit two of our three tracked countries against
  // each other (e.g. an Argentine club vs a Brazilian club) — filing that
  // under just one country's section buries a match the user specifically
  // cares about. Returns a stable "Brazil vs Argentina"-style label (ordered
  // by COUNTRY_DISPLAY_ORDER so the same pairing always produces the same
  // string) when home and away resolve to two different tracked countries,
  // else null.
  const COUNTRY_DISPLAY_ORDER = ["Brazil", "Argentina", "Mexico"];
  function crossCountryLabel(entry) {
    const home = resolveClubCountry(normalizeTeam(entry.homeTeam));
    const away = resolveClubCountry(normalizeTeam(entry.awayTeam));
    if (!home || !away || home === away) return null;
    return COUNTRY_DISPLAY_ORDER.indexOf(home) < COUNTRY_DISPLAY_ORDER.indexOf(away) ? `${home} vs ${away}` : `${away} vs ${home}`;
  }

  // Champions League has no single "home league" the way a domestic
  // competition does — resolve via whichever tracked league the home team
  // belongs to, falling back to the away team, then to Europe/London as a
  // documented approximation (a CL tie can involve a club from an untracked
  // league, e.g. Eredivisie) — same fallback shape as resolveContinentalCountry.
  function resolveEuroZone(competition, entry) {
    if (competition === CANONICAL.CHAMPIONS_LEAGUE) {
      return (
        knownClubsByLeague.get(normalizeTeam(entry.homeTeam)) ?? knownClubsByLeague.get(normalizeTeam(entry.awayTeam)) ?? "Europe/London"
      );
    }
    return EURO_TIMEZONES[competition] ?? "Europe/London";
  }

  console.log("Caching team logos...");
  const events = [];
  for (const { entry, competition } of classified) {
    let country = COMPETITION_COUNTRY[competition] ?? null;
    let crossCountry = null;
    let localZone = null;
    if (CONTINENTAL_CUPS.has(competition)) {
      country = resolveContinentalCountry(entry);
      if (!country) continue; // no recognized BR/ARG/MX club involved
      crossCountry = crossCountryLabel(entry);
    } else if (EURO_COMPETITIONS.has(competition)) {
      country = EURO_COMPETITION_COUNTRY[competition] ?? "Europe";
      entry.channels = []; // no broadcast data in the API — grouped markets attached below instead
      entry.broadcastGroups = broadcastGroupsFor(competition, entry.kickoffUTC);
      localZone = resolveEuroZone(competition, entry);
    }
    const built = await buildEvent(entry, competition, country, localZone);
    if (!built.kickoffUTC) continue; // can't place it in time, drop rather than guess
    events.push({ ...built, crossCountry });
  }

  // Merge entries that are the same real-world match seen on multiple sites
  // (e.g. an Argentine league game listed on both the Argentina and Brazil
  // broadcast guides, each with that country's own channel).
  // Keyed on the *local* calendar date (in the match's own country), not the
  // UTC date — a late-evening Brazil kickoff (e.g. 21:30 BRT) is already the
  // next UTC day, so a UTC-date key would wrongly treat the same real match
  // reported at two slightly different times by two sources as two separate
  // fixtures on two different days. Sources do sometimes disagree on the
  // exact kickoff time by an hour or more (not something we can independently
  // verify) — merging keeps whichever time was seen first rather than
  // resolving the disagreement, which is still far less confusing than
  // showing the same match listed twice.
  const merged = new Map();
  for (const e of events) {
    // "Europe" is never a key in TIMEZONES (see EURO_TIMEZONES above) — falls
    // through to the per-event zone resolved in the events-building loop.
    const dateKey = localDateKey(e.kickoffUTC, TIMEZONES[e.country] ?? e.localZone);
    const key = `${normalizeTeam(e.homeTeam)}|${normalizeTeam(e.awayTeam)}|${dateKey}`;
    const existing = merged.get(key);
    if (!existing) {
      // Stashed as mergeKey and carried through to the final event object —
      // see eventKey() below for why re-deriving this later from the
      // *display* name (rather than reusing this raw-name-derived key) is
      // not reliable.
      merged.set(key, { ...e, mergeKey: key });
    } else {
      for (const ch of e.channels) if (!existing.channels.includes(ch)) existing.channels.push(ch);
      mergeBroadcastGroups(existing, e.broadcastGroups);
      existing.homeLogo ??= e.homeLogo;
      existing.awayLogo ??= e.awayLogo;
    }
  }

  console.log("Caching channel logos...");

  async function cacheChannelLogo(name) {
    const domain = channelDomainFor(name);
    return domain
      ? await cacheImage(`https://www.google.com/s2/favicons?domain=${domain}&sz=64`, {
          subdir: "channels",
          cacheKey: domain,
        })
      : null;
  }

  async function toFinalEvent(e) {
    const channels = [];
    for (const name of e.channels) {
      channels.push({ name, logo: await cacheChannelLogo(name) });
    }
    let broadcastGroups = null;
    if (e.broadcastGroups) {
      broadcastGroups = [];
      for (const group of e.broadcastGroups) {
        const groupChannels = [];
        for (const name of group.channels) groupChannels.push({ name, logo: await cacheChannelLogo(name) });
        broadcastGroups.push({ label: group.label, channels: groupChannels });
      }
    }
    const zone = TIMEZONES[e.country] ?? e.localZone;
    return {
      competition: e.competition,
      competitionLogo: COMPETITION_LOGOS[e.competition] ?? e.competitionLogo ?? null,
      country: e.country,
      crossCountry: e.crossCountry ?? null,
      homeTeam: displayNameFor(normalizeTeam(e.homeTeam), e.homeTeam),
      awayTeam: displayNameFor(normalizeTeam(e.awayTeam), e.awayTeam),
      homeLogo: e.homeLogo,
      awayLogo: e.awayLogo,
      kickoffUTC: e.kickoffUTC,
      kickoffLocal: formatInZone(e.kickoffUTC, zone),
      kickoffUK: formatInZone(e.kickoffUTC, "Europe/London"),
      localDate: localDateKey(e.kickoffUTC, zone),
      rivalry: isRivalry(normalizeTeam(e.homeTeam), normalizeTeam(e.awayTeam)),
      mergeKey: e.mergeKey,
      rawCompetitionLabel: e.rawCompetitionLabel,
      rawCompetitionSlug: e.rawCompetitionSlug,
      rawCompetitionCode: e.rawCompetitionCode,
      // Normalized from the *raw* team names (still available as e.homeTeam/
      // e.awayTeam here, before the display-name conversion two lines up) —
      // used by the roster check below. Deliberately not re-derived from the
      // display name later: a display name doesn't reliably normalize back
      // to the same key its raw form did (the exact bug mergeKey/eventKey()
      // already had to work around — see eventKey()'s comment).
      homeTeamKey: normalizeTeam(e.homeTeam),
      awayTeamKey: normalizeTeam(e.awayTeam),
      channels,
      broadcastGroups,
    };
  }

  const freshFinal = [];
  for (const e of merged.values()) {
    freshFinal.push(await toFinalEvent(e));
  }

  // Accumulate history across daily runs. The scrapers themselves only ever
  // return a narrow live window (today/yesterday/tomorrow for Brazil, a
  // forward-looking homepage for Argentina/Mexico — see their robots.txt
  // notes), so a 28-day "recently played" archive can't come from a single
  // day's scrape. Instead, each run folds today's fresh results on top of
  // whatever the previous run already wrote (fresh data wins on any overlap,
  // e.g. a channel confirmation landing on an already-known fixture), and the
  // window filter below lets anything older than 28 days quietly age out.
  const rosterLookup = buildRosterLookup(readJsonSafe("public/data/standings.json"));

  const previous = readJsonSafe("public/data/fixtures.json");
  const combined = new Map();
  for (const e of [...(previous?.events ?? []), ...(previous?.recentEvents ?? [])]) {
    // Re-run the stored keys through the alias table so an archived entry
    // picks up an alias added after it was written. Aliases map normalized
    // name -> normalized name, so this is idempotent for keys that are
    // already right, and unlike re-deriving from the display name (see
    // eventKey()'s comment on why that's unreliable) it can't invent a new
    // key. Without it an archived fixture keeps a pre-alias key forever —
    // which is what stopped "CDU Católica" from matching its bracket tie.
    if (e.homeTeamKey) e.homeTeamKey = resolveAlias(e.homeTeamKey);
    if (e.awayTeamKey) e.awayTeamKey = resolveAlias(e.awayTeamKey);
    // Re-derive the country from the competition for the same reason, and it
    // is not hypothetical: when the European leagues stopped sharing one
    // "Europe" bucket, every La Liga fixture already in the archive kept
    // saying Europe while fresh ones said Spain — the same competition filed
    // under two countries on one page. Only competitions with a fixed home
    // country are touched; a continental cup's country is resolved from the
    // clubs involved (see resolveContinentalCountry) and must not be
    // overwritten by a static lookup.
    const archivedCountry = COMPETITION_COUNTRY[e.competition] ?? EURO_COMPETITION_COUNTRY[e.competition];
    if (archivedCountry) e.country = archivedCountry;
    if (!stillInScope(e)) continue; // see stillInScope() — drops entries a scope-rule fix has since excluded
    if (!isOnRoster(e, rosterLookup)) {
      console.warn(`[roster-check] dropping archived: ${e.homeTeam} vs ${e.awayTeam} (${e.competition}) — team not in current standings`);
      continue;
    }
    combined.set(eventKey(e), e);
  }
  for (const e of freshFinal) {
    if (!isOnRoster(e, rosterLookup)) {
      console.warn(`[roster-check] dropping fresh: ${e.homeTeam} vs ${e.awayTeam} (${e.competition}) — team not in current standings`);
      continue;
    }
    const key = eventKey(e);
    mergeFreshChannels(e, combined.get(key));
    combined.set(key, e);
  }

  // Backfill logos for archived past matches whose logo caching failed the
  // day they were scraped — a past event is never rescraped after that (the
  // scrapers only ever return a current live window), so a transient miss
  // would otherwise stay broken forever even once another entry for the same
  // team has a working cached logo.
  const logoByTeam = new Map();
  for (const e of combined.values()) {
    if (e.homeLogo) logoByTeam.set(normalizeTeam(e.homeTeam), e.homeLogo);
    if (e.awayLogo) logoByTeam.set(normalizeTeam(e.awayTeam), e.awayLogo);
  }
  for (const e of combined.values()) {
    e.homeLogo ??= logoByTeam.get(normalizeTeam(e.homeTeam)) ?? null;
    e.awayLogo ??= logoByTeam.get(normalizeTeam(e.awayTeam)) ?? null;
  }

  const now = Date.now();
  const pastCutoff = now - 7 * 86400000;
  const futureCutoff = now + 7 * 86400000;

  const finalEvents = [];
  const recentEvents = [];
  const dedupedEvents = dedupeFuzzy([...combined.values()]);
  promoteBrazilFixtureChannels(dedupedEvents);
  for (const e of dedupedEvents) {
    const t = Date.parse(e.kickoffUTC);
    if (t < pastCutoff || t > futureCutoff) continue;
    // Stable identity for the "watched" tracker (see api/watched.js) —
    // reuses the same canonical key the archive/accumulate logic already
    // keys on, so a game and every one of its later replay rows agree on
    // one key regardless of which build first produced them.
    e.watchKey = `football:${eventKey(e)}`;
    if (t >= now) finalEvents.push(e);
    else recentEvents.push(e);
  }
  finalEvents.sort((a, b) => Date.parse(a.kickoffUTC) - Date.parse(b.kickoffUTC));
  recentEvents.sort((a, b) => Date.parse(b.kickoffUTC) - Date.parse(a.kickoffUTC)); // most recent first

  // Correlated against upcoming AND recent matches: a match played earlier
  // today is still in finalEvents until the next build reclassifies it, and
  // tonight's game being re-aired at midnight is exactly a catch-up row.
  console.log("Fetching football replay listings...");
  const {
    replaySchedule,
    brazilReplaySchedule,
    brazilGuideSchedule,
    argentinaReplaySchedule,
    argentinaGuideSchedule,
    mexicoReplaySchedule,
    mexicoGuideSchedule,
    spainReplaySchedule,
    spainGuideSchedule,
    allGuideSchedule,
  } = await buildFootballReplaySchedule([...finalEvents, ...recentEvents], cacheChannelLogo);

  const generatedAt = new Date().toISOString();
  const output = {
    generatedAt,
    events: finalEvents,
    recentEvents,
    replaySchedule,
    brazilReplaySchedule,
    brazilGuideSchedule,
    argentinaReplaySchedule,
    argentinaGuideSchedule,
    mexicoReplaySchedule,
    mexicoGuideSchedule,
    spainReplaySchedule,
    spainGuideSchedule,
    allGuideSchedule,
  };

  fs.mkdirSync("public/data", { recursive: true });

  const changelogEntry = buildChangelogEntry(generatedAt, previous?.events ?? [], finalEvents);
  appendChangelog(changelogEntry);
  // Same diff, also published to the shared per-sport updates feed the
  // Updates tab reads. changelog.json stays as it is — the football sidebar
  // panel still reads it, and there's no reason to break that.
  appendUpdates("football", { ...changelogEntry, total: finalEvents.length });

  fs.writeFileSync("public/data/fixtures.json", JSON.stringify(output, null, 2), "utf8");
  writeHealth();
  console.log(`\nWrote public/data/fixtures.json (${finalEvents.length} events)`);
  console.log(
    `Changelog: +${changelogEntry.added.length} -${changelogEntry.removed.length} ~${changelogEntry.channelsChanged.length}`
  );
}

// ---- "Catch up": football replay/highlights airings ----
// Same shape and semantics as the MLB and Fights verticals' replaySchedule,
// so the frontend's shared renderCatchUp() renders all three unchanged.

// A football broadcast runs ~2h, and the live listing starts at (or just
// before) kickoff — so an airing 2h+ after kickoff cannot be the live
// broadcast. The upper bound is 7 days because that is exactly how long a
// match stays in recentEvents: past it there is nothing left to attribute
// to. It needs to be that wide — Premier Sports re-airs the Brasileirão
// 3-5 days later (measured at 99h and 107h on 2026-08-12), far beyond the
// 72h window the MLB pipeline uses.
const REPLAY_MIN_MS = 2 * 3600000;
const REPLAY_MAX_MS = 7 * 86400000;

/**
 * Pins each airing to the match it re-airs. Exported pure so the rules are
 * covered by a regression test (spike/test-football-correlation.js) rather
 * than only by whatever happens to be on TV on build day.
 *
 * An airing matches a match when BOTH its team names resolve to that match's
 * team keys — compared as an unordered pair, because side order carries no
 * information here (beIN's data-team1/data-team2 are reversed relative to
 * their own episode titles) — and it airs inside the window above. Archive
 * programming and live broadcasts are never catch-up. Where several
 * meetings of the same two teams qualify, the most recent one wins.
 */
// `onDrop` is optional and purely observational: the build passes a sink so
// every discarded airing is accounted for per channel (see
// spike/replay-diagnostics.js), while the regression tests call this with two
// arguments and keep exercising it as a pure function.
export function correlateFootballAirings(airings, matches, onDrop = null) {
  const drop = (a, reason) => onDrop?.(a.channel, reason);
  const byPair = new Map();
  for (const m of matches) {
    if (!m.homeTeamKey || !m.awayTeamKey) continue;
    const key = [m.homeTeamKey, m.awayTeamKey].sort().join("|");
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(m);
  }
  const out = [];
  for (const a of airings) {
    if (a.live || a.archive) {
      drop(a, a.live ? "live" : "archive");
      continue;
    }
    const candidates = byPair.get(a.teams.map((t) => normalizeTeam(t)).sort().join("|"));
    if (!candidates) {
      drop(a, "untracked");
      continue;
    }
    const airMs = Date.parse(a.airTimeUTC);
    const match = candidates
      .filter((m) => {
        const delta = airMs - Date.parse(m.kickoffUTC);
        return delta >= REPLAY_MIN_MS && delta <= REPLAY_MAX_MS;
      })
      .sort((x, y) => Date.parse(y.kickoffUTC) - Date.parse(x.kickoffUTC))[0];
    // The two teams are tracked and did meet — just not inside the window
    // that separates a re-air from the live broadcast or from an old classic.
    if (!match) {
      drop(a, "window");
      continue;
    }
    out.push({ airing: a, match });
  }
  return out;
}

// A broadcast can open up to two hours before kick-off (pre-match shows), and
// REPLAY_MIN_MS is the floor above which an airing is a re-run — so this
// window is exactly the complement of the catch-up one, and no airing can
// ever be counted as both the live broadcast and a replay.
const LIVE_LEAD_MS = 2 * 3600000;

/**
 * Which channels carry each match LIVE, per market.
 *
 * Same listings the catch-up view already fetches, read the other way round:
 * an airing that names both teams and starts around kick-off IS the live
 * broadcast. That is what lets a fixture card say who shows it in Spain, the
 * UK, the US or Argentina without a single extra request.
 *
 * Unlike correlateFootballAirings this does NOT skip `live`-flagged airings —
 * those are precisely what it is looking for — but it still skips archive and
 * stale-season programming, since an old re-run near a kick-off time would
 * otherwise masquerade as coverage of tonight's match.
 */
export function correlateLiveAirings(airings, matches) {
  const byPair = new Map();
  for (const m of matches) {
    if (!m.homeTeamKey || !m.awayTeamKey) continue;
    const key = [m.homeTeamKey, m.awayTeamKey].sort().join("|");
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(m);
  }
  const out = [];
  for (const a of airings) {
    if (a.archive || !a.market) continue;
    const candidates = byPair.get(a.teams.map((t) => normalizeTeam(t)).sort().join("|"));
    if (!candidates) continue;
    const airMs = Date.parse(a.airTimeUTC);
    const match = candidates.find((m) => {
      const delta = airMs - Date.parse(m.kickoffUTC);
      return delta >= -LIVE_LEAD_MS && delta < REPLAY_MIN_MS;
    });
    if (match) out.push({ airing: a, match });
  }
  return out;
}

// Ordering, per the user: "first is the channels from the country where the match
// is being played, then spanish, then english, then the rest". The point is
// picking a stream — a Brazilian match may be carried badly at home and
// perfectly somewhere else — so the home feed leads, then the languages he
// actually speaks, then everything else.
const MARKET_LANGUAGE = {
  Spain: "es",
  Argentina: "es",
  "US & Canada (Spanish)": "es",
  UK: "en",
  "US & Canada (English)": "en",
  Canada: "en",
  Brazil: "pt",
  Portugal: "pt",
  France: "fr",
  Mexico: "es",
};
// An event's `country` is the competition's region, which is too coarse for
// the European leagues (all of them say "Europe"), so the competition's own
// home country wins where it is known. Mexico now has its own exact
// local-market feed, while Canada remains a useful English-language
// secondary market for matches covered there.
// Now that each European league carries its own country (see
// EURO_COMPETITION_COUNTRY), the home market falls out of the country
// directly and no longer needs a per-competition table. This is what finally
// gives Serie A an Italian home market — that gap existed only because every
// European fixture used to say "Europe".
const COUNTRY_HOME_MARKET = {
  Brazil: "Brazil",
  Argentina: "Argentina",
  England: "UK",
  Spain: "Spain",
  Italy: "Italy",
  Germany: "Germany",
  France: "France",
  Mexico: "Mexico",
};
const COMPETITION_HOME_MARKET = {};

// Two listings of the same channel rarely spell it identically — the Brazilian
// fixture scraper says "PREMIERE FC" where the EPG says "Premiere" — and the
// same name appearing twice on one card reads as a bug. Compared as token
// sets with the decorative words dropped, but **digits deliberately kept**:
// "ESPN 2 Brasil" and "ESPN Brasil" are different channels, and the existing
// normalizeChannelName (which strips numbers, for logo lookup) would collapse
// them.
const CHANNEL_NOISE_TOKENS = new Set(["fc", "hd", "tv"]);

function channelIdentity(name) {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t && !CHANNEL_NOISE_TOKENS.has(t))
    .join(" ");
}

// The per-country fixture scrapers name a channel bare ("ESPN") where the EPG
// qualifies it ("ESPN Argentina"), and both on one card is the same channel
// twice. Only a TRAILING country word is stripped, and only for this
// comparison: "ESPN 4 Brasil" keeps its 4 and stays distinct from "ESPN",
// which a looser prefix rule would have wrongly collapsed.
const CHANNEL_COUNTRY_SUFFIXES = new Set(["argentina", "brasil", "brazil", "mexico", "espana", "portugal", "uk", "usa"]);

function channelIdentityBare(id) {
  const tokens = id.split(" ");
  return tokens.length > 1 && CHANNEL_COUNTRY_SUFFIXES.has(tokens.at(-1)) ? tokens.slice(0, -1).join(" ") : id;
}

// Movistar's channels arrive prefixed differently by each source — "M+ Liga
// de Campeones" from futbolenlatv, "M. Liga de Campeones" from FormulaTV,
// bare "Vamos" from El País, and the brand spelled out in full as "Movistar
// LALIGA" by LaLiga's own API. channelIdentity already collapses "+" and "."
// to nothing, so the "M" forms agree, but neither the bare form nor the
// spelled-out one did — which is how "LaLiga TV" and "Movistar LALIGA", one
// channel, ended up as two chips on the same card.
//
// Both prefixes are stripped for identity only. Neither ever distinguishes
// two different channels in this market: what follows the prefix is the
// channel ("LaLiga", "Vamos", "Liga de Campeones"). Note this does NOT
// collapse "DAZN LaLiga" into "LaLiga" — DAZN is not a Movistar prefix and
// that genuinely is a different channel.
const MOVISTAR_PREFIXES = new Set(["m", "movistar"]);
function channelIdentityCore(id) {
  const bare = channelIdentityBare(id);
  const tokens = bare.split(" ");
  return tokens.length > 1 && MOVISTAR_PREFIXES.has(tokens[0]) ? tokens.slice(1).join(" ") : bare;
}

function orderMarkets(markets, match) {
  const home = COMPETITION_HOME_MARKET[match.competition] ?? COUNTRY_HOME_MARKET[match.country] ?? null;
  const rank = (m) => (m === home ? 0 : MARKET_LANGUAGE[m] === "es" ? 1 : MARKET_LANGUAGE[m] === "en" ? 2 : 3);
  // Alphabetical within a tier, so a card's groups never reshuffle between
  // builds just because a channel dropped in or out.
  return [...markets].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Attaches the live-broadcast groups to each match in place.
 *
 * The Brazil, Argentina and Mexico fixture scrapers now seed a labelled
 * market group with their full local channel list. Live-guide rows for those
 * markets merge into that group, while exact/static groups for other markets
 * are still replaced by the fresher EPG result: "DAZN LaLiga" is the channel,
 * "DAZN" is only the rightsholder.
 */
const MERGE_LIVE_MARKETS = new Set(["Brazil", "Argentina", "Mexico"]);
async function attachLiveBroadcasts(matches, airings, cacheChannelLogo) {
  const byMatch = new Map();
  for (const { airing, match } of correlateLiveAirings(airings, matches)) {
    if (!byMatch.has(match)) byMatch.set(match, new Map());
    const markets = byMatch.get(match);
    if (!markets.has(airing.market)) markets.set(airing.market, new Set());
    markets.get(airing.market).add(airing.channel);
  }
  let attached = 0;
  for (const [match, markets] of byMatch) {
    const already = new Set((match.channels ?? []).map((c) => channelIdentity(c.name)));
    const groups = [];
    for (const market of orderMarkets(markets.keys(), match)) {
      // Deduped against the flat row AND within the group itself: two sources
      // spelling one channel differently must not produce two chips. The
      // longest spelling wins, since it is the one that names the channel in
      // full ("M+ Liga de Campeones" over a bare "Liga de Campeones").
      const prior = (match.broadcastGroups ?? []).find((g) => g.label === market);
      const inherited = MERGE_LIVE_MARKETS.has(market) ? (prior?.channels ?? []).map((c) => c.name) : [];
      const bestByCore = new Map();
      for (const { name: n, inherited: keepInherited } of [
        ...inherited.map((name) => ({ name, inherited: true })),
        ...[...(markets.get(market) ?? [])].map((name) => ({ name, inherited: false })),
      ]) {
        const id = channelIdentity(n);
        if (!keepInherited && (already.has(id) || already.has(channelIdentityBare(id)) || already.has(channelIdentityCore(id)))) continue;
        const core = channelIdentityCore(id);
        const held = bestByCore.get(core);
        if (!held || n.length > held.length) bestByCore.set(core, n);
      }
      const names = [...bestByCore.values()].sort();
      if (!names.length) continue;
      const channels = [];
      for (const name of names) channels.push({ name, logo: await cacheChannelLogo(name) });
      groups.push({ label: market, channels });
    }
    if (!groups.length) continue;
    const kept = (match.broadcastGroups ?? []).filter((g) => !groups.some((n) => n.label === g.label));
    match.broadcastGroups = [...groups, ...kept];
    attached++;
  }
  console.log(`Live broadcast channels: ${attached} matches gained a market group from the EPG listings`);
}

function matchDayLabel(localDate) {
  if (!localDate) return null;
  const [y, m, d] = localDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short" }).format(
    new Date(Date.UTC(y, m - 1, d))
  );
}

async function buildFootballReplaySchedule(matches, cacheChannelLogo) {
  let airings = [];
  for (const [label, fetchFn] of [
    ["UK", fetchUkFootballAirings],
    ["NA", fetchNaFootballAirings],
    ["SA", fetchSaFootballAirings],
    ["Iberia", fetchIberiaFootballAirings],
    ["TyC agenda", fetchTycAgendaAirings],
    ["Italy", fetchItalyFootballAirings],
    ["Germany", fetchGermanyFootballAirings],
    ["LaLiga API", fetchLaLigaBroadcastAirings],
    ["Spain per-match", fetchSpanishMatchChannels],
    ["FootyOnTV", fetchFootyOnTvAirings],
  ]) {
    // A broken EPG source must never take the fixtures build down with it —
    // the same failure principle every other scraper here follows.
    try {
      airings = airings.concat(await fetchFn());
    } catch (err) {
      console.error(`[football-replays] ${label} leg failed entirely: ${err.message}`);
    }
  }

  const schedule = [];
  const seen = new Set();
  const strictBrazilKeys = new Set();
  for (const { airing, match } of correlateFootballAirings(airings, matches, noteDrop)) {
    const key = `${airing.channel}|${airing.airTimeUTC}`;
    if (seen.has(key)) {
      noteDrop(airing.channel, "duplicate");
      continue;
    }
    seen.add(key);
    if (airing.market === "Brazil") strictBrazilKeys.add(key);
    noteAttributed(airing.channel);
    // A football match needs ~2h of airtime, so a slot shorter than 75
    // minutes cannot be a full re-air whatever the listing calls itself —
    // Premiere schedules its "VT" (videotape) Brasileirão re-airs in 30
    // minute slots, which are condensed, and labelling those "Full replay"
    // would overpromise.
    const slotMinutes = airing.endsAtUTC ? (Date.parse(airing.endsAtUTC) - Date.parse(airing.airTimeUTC)) / 60000 : null;
    const condensed = airing.highlights || (slotMinutes !== null && slotMinutes < 75);
    schedule.push({
      airTimeUTC: airing.airTimeUTC,
      // Keeps a row listed until the programme actually ends, so you can
      // join something already under way. TV Passport publishes a real
      // duration; tvguide.co.uk doesn't, but the gap to the channel's next
      // programme is the same thing. Only if neither exists does a
      // football broadcast's typical two hours stand in.
      endsAtUTC: airing.endsAtUTC ?? new Date(Date.parse(airing.airTimeUTC) + 2 * 3600000).toISOString(),
      timeUK: formatInZone(airing.airTimeUTC, "Europe/London"),
      market: airing.market ?? null,
      channel: { name: airing.channel, logo: await cacheChannelLogo(airing.channel) },
      // Same key as the source match, so marking one watched (from the
      // fixture itself or from any one re-air) flags every other re-air of
      // the same game too — see api/watched.js.
      watchKey: match.watchKey,
      label: `${match.homeTeam} v ${match.awayTeam}`,
      logos: [match.homeLogo, match.awayLogo].filter(Boolean),
      // Says plainly which of the two it is — on these channels a condensed
      // highlights show is often the only re-air a match gets, and calling
      // that a "replay" would overpromise.
      sublabel: [condensed ? "Highlights" : "Full replay", match.competition, `played ${matchDayLabel(match.localDate)}`]
        .filter(Boolean)
        .join(" · "),
    });
  }
  schedule.sort((a, b) => Date.parse(a.airTimeUTC) - Date.parse(b.airTimeUTC));
  // Guia de TV marks Brazilian videotape broadcasts with the native `VT -`
  // prefix. Keep those rows even when their teams are not in the fixture
  // feed's tracked window: the channel has explicitly identified the
  // programme as a replay, so dropping it is exactly the coverage gap this
  // source is meant to close. These rows have no watch key or team logos
  // because there is no tracked parent match to attach them to.
  const brazilReplaySchedule = schedule.filter((r) => r.market === "Brazil");
  const argentinaReplaySchedule = schedule.filter((r) => r.market === "Argentina");
  const mexicoReplaySchedule = schedule.filter((r) => r.market === "Mexico");
  const spainReplaySchedule = schedule.filter((r) => r.market === "Spain");
  // A VT row is listed with NO parent fixture, so nothing else constrains
  // what it can be — and "two names either side of an x" is every sport.
  // Measured before this gate: 66 of 343 supplement rows were out of scope,
  // including Liga Portugal (the user spotted "Porto x União Torrense"), the
  // Eredivisie, the Saudi and Turkish leagues, a volleyball tie (Osasco x
  // Pinheiros, 7 airings) and two boxing cards. Requiring one club from the
  // tracked fixture set is the cheapest honest bound: it needs no league
  // list to maintain and it follows whatever this dashboard tracks.
  //
  // The consequence to know: a club with no fixture in the current window
  // fails it, so Série B re-airs go too. That is consistent — the dashboard
  // does not track Série B fixtures either, so those rows had no parent to
  // return to.
  const trackedClubKeys = new Set();
  for (const m of matches) {
    if (m.homeTeamKey) trackedClubKeys.add(m.homeTeamKey);
    if (m.awayTeamKey) trackedClubKeys.add(m.awayTeamKey);
  }
  const brazilReplaySupplement = [];
  for (const airing of airings) {
    if (airing.market !== "Brazil" || !airing.brazilReplay || airing.live || airing.archive || !airing.teams?.length) continue;
    if (!airing.teams.some((team) => trackedClubKeys.has(normalizeTeam(team)))) {
      noteDrop(airing.channel, "untracked");
      continue;
    }
    const key = `${airing.channel}|${airing.airTimeUTC}`;
    if (strictBrazilKeys.has(key)) continue;
    const slotMinutes = airing.endsAtUTC ? (Date.parse(airing.endsAtUTC) - Date.parse(airing.airTimeUTC)) / 60000 : null;
    const condensed = airing.highlights || (slotMinutes !== null && slotMinutes < 75);
    noteSupplemented(airing.channel);
    const row = {
      airTimeUTC: airing.airTimeUTC,
      endsAtUTC: airing.endsAtUTC ?? new Date(Date.parse(airing.airTimeUTC) + 2 * 3600000).toISOString(),
      timeUK: formatInZone(airing.airTimeUTC, "Europe/London"),
      market: "Brazil",
      channel: { name: airing.channel, logo: await cacheChannelLogo(airing.channel) },
      watchKey: null,
      label: `${airing.teams[0]} v ${airing.teams[1]}`,
      logos: [],
      sublabel: [condensed ? "Highlights" : "Full replay", "Brazil guide · VT listing"].join(" · "),
    };
    brazilReplaySupplement.push(row);
    brazilReplaySchedule.push(row);
  }
  brazilReplaySchedule.sort((a, b) => Date.parse(a.airTimeUTC) - Date.parse(b.airTimeUTC));
  const fullReplaySchedule = [...schedule, ...brazilReplaySupplement].sort((a, b) => Date.parse(a.airTimeUTC) - Date.parse(b.airTimeUTC));
  console.log(`Football replay airings: ${airings.length} fetched, ${schedule.length} pinned + ${brazilReplaySchedule.length - schedule.filter((r) => r.market === "Brazil").length} Brazil VT listings`);
  logReplayDiagnostics();
  setChannelDiagnostics(replayDiagnostics());
  const brazilGuideSchedule = await buildBrazilGuideSchedule(airings, matches, cacheChannelLogo);
  const argentinaGuideSchedule = await buildArgentinaGuideSchedule(airings, matches, cacheChannelLogo);
  const mexicoGuideSchedule = await buildMexicoGuideSchedule(airings, matches, cacheChannelLogo);
  const spainGuideSchedule = await buildSpainGuideSchedule(airings, matches, cacheChannelLogo);
  const allGuideSchedule = await buildAllGuideSchedule(airings, matches, cacheChannelLogo);
  await attachLiveBroadcasts(matches, airings, cacheChannelLogo);
  return {
    replaySchedule: fullReplaySchedule,
    brazilReplaySchedule,
    brazilGuideSchedule,
    argentinaReplaySchedule,
    argentinaGuideSchedule,
    mexicoReplaySchedule,
    mexicoGuideSchedule,
    spainReplaySchedule,
    spainGuideSchedule,
    allGuideSchedule,
  };
}

// The strict replay schedule contains only airings pinned to a tracked match.
// Brazil has two honest supplements: native VT rows for replays outside that
// fixture feed, and the full Portuguese guide including live broadcasts and
// future programme cards that are not replays.
async function buildBrazilGuideSchedule(airings, matches, cacheChannelLogo) {
  return buildMarketGuideSchedule(airings, matches, cacheChannelLogo, {
    market: "Brazil",
    guideLabel: "Brazil guide",
    nativeReplay: (airing) => airing.brazilReplay,
  });
}

// Argentina's DirecTV guide does not expose a native replay flag. Its
// matchup rows are still valuable as a complete local channel grid, while
// the normal two-hour-after-kickoff correlation keeps strict catch-up rows
// honest. TyC's own agenda rows are included as live/scheduled entries.
// A generic "Team vs Team" parser can also recognize an occasional baseball
// or basketball fixture on an ESPN/DSports feed. Keep those out of a football
// guide without requiring a competition keyword, because Argentine football
// rows are often just the two club names.
// "Sesi/Franca vs. Boca Juniors" is the case no text rule can reach: it is
// a Basketball Champions League Americas tie on DSports+, and DirecTV's
// row carries the two club names and NOTHING else — empty description,
// category "Series", no sport word anywhere. Boca's basketball side shares
// the football club's name, so only knowing the opponent is a basketball
// club stops it. Matched as the full "Sesi/Franca" token, never bare
// "franca" — França is Portuguese for France and would eat the national
// team's fixtures.
const ARGENTINA_NON_FOOTBALL_RE =
  /\b(?:baseball|basketball|mlb|nba|astros|yankees|red sox|dodgers|mets|cubs|padres|mariners|guardians|twins|orioles|cardinals|blue jays|braves|phillies|brewers|pirates|royals|tigers|angels|athletics|giants|nationals|diamondbacks|rockies|rays|white sox|olympiacos piraeus)\b|sesi\s*\/\s*franca/i;

async function buildArgentinaGuideSchedule(airings, matches, cacheChannelLogo) {
  return buildMarketGuideSchedule(airings, matches, cacheChannelLogo, {
    market: "Argentina",
    guideLabel: "Argentina guide",
  });
}

async function buildMexicoGuideSchedule(airings, matches, cacheChannelLogo) {
  return buildMarketGuideSchedule(airings, matches, cacheChannelLogo, {
    market: "Mexico",
    guideLabel: "Mexico guide",
  });
}

async function buildSpainGuideSchedule(airings, matches, cacheChannelLogo) {
  return buildMarketGuideSchedule(airings, matches, cacheChannelLogo, {
    market: "Spain",
    guideLabel: "Spain guide",
  });
}

async function buildAllGuideSchedule(airings, matches, cacheChannelLogo) {
  return buildMarketGuideSchedule(airings, matches, cacheChannelLogo, {
    guideLabel: "All channels",
    nativeReplay: (airing) => airing.brazilReplay,
  });
}

async function buildMarketGuideSchedule(airings, matches, cacheChannelLogo, { market = null, guideLabel, nativeReplay = () => false }) {
  const byPair = new Map();
  for (const match of matches) {
    if (!match.homeTeamKey || !match.awayTeamKey) continue;
    const key = [match.homeTeamKey, match.awayTeamKey].sort().join("|");
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(match);
  }
  // Same bound as the VT supplement: a guide row must name at least one club
  // from the tracked fixture set. These views are "what is on the channels",
  // but a channel grid parsed as "A v B" catches every sport and every
  // league — Colombian and Chilean football, Segunda, reserve teams, boxing,
  // tennis, rugby, even "Messi v Ronaldo". The user, 2026-08-26: "I don't care
  // about other leagues and sports."
  //
  // One tracked club, not two: plenty of real rows name a tracked club
  // alongside an untracked one (a Copa del Rey tie against a Segunda side),
  // and requiring both would drop "Real Madrid v R. Sociedad" the moment one
  // spelling fails to resolve. That makes team-aliases.js load-bearing here
  // in a way it was not before — an unresolved short form now costs the row,
  // not just its attribution.
  const trackedClubKeys = new Set();
  for (const match of matches) {
    if (match.homeTeamKey) trackedClubKeys.add(match.homeTeamKey);
    if (match.awayTeamKey) trackedClubKeys.add(match.awayTeamKey);
  }
  const now = Date.now();
  const futureCutoff = now + 7 * 86400000;
  const seen = new Set();
  const rows = [];
  for (const airing of airings) {
    if ((market && airing.market !== market) || airing.archive || !airing.teams?.length) continue;
    if (airing.market === "Argentina" && ARGENTINA_NON_FOOTBALL_RE.test(airing.series ?? "")) continue;
    if (!airing.teams.some((team) => trackedClubKeys.has(normalizeTeam(team)))) {
      // Counted only on the all-markets pass, since this function runs once
      // per market view over the same airings and would otherwise tally the
      // same drop five times. Silent filtering is the real hazard here: if a
      // club's short form ever stops resolving, its rows vanish with no
      // signal, so the drop goes through the same accounting that already
      // powers the health panel's "nothing listed from: <channel>" line.
      if (!market) noteDrop(airing.channel, "untracked");
      continue;
    }
    if (Date.parse(airing.airTimeUTC) > futureCutoff) continue;
    const endsAtUTC = airing.endsAtUTC ?? new Date(Date.parse(airing.airTimeUTC) + 2 * 3600000).toISOString();
    if (Date.parse(endsAtUTC) < now) continue;
    const key = airing.teams.map((team) => normalizeTeam(team)).sort().join("|");
    const candidates = byPair.get(key) ?? [];
    const match = [...candidates].sort(
      (a, b) => Math.abs(Date.parse(a.kickoffUTC) - Date.parse(airing.airTimeUTC)) - Math.abs(Date.parse(b.kickoffUTC) - Date.parse(airing.airTimeUTC))
    )[0];
    const label = match ? `${match.homeTeam} v ${match.awayTeam}` : `${airing.teams[0]} v ${airing.teams[1]}`;
    const dedupeKey = `${airing.channel}|${airing.airTimeUTC}|${label}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const delta = match ? Date.parse(airing.airTimeUTC) - Date.parse(match.kickoffUTC) : null;
    const slotMinutes = airing.endsAtUTC ? (Date.parse(airing.endsAtUTC) - Date.parse(airing.airTimeUTC)) / 60000 : null;
    const isReplay = nativeReplay(airing) || (delta !== null && delta >= REPLAY_MIN_MS);
    const condensed = airing.highlights || (slotMinutes !== null && slotMinutes < 75);
    const kind = airing.live
      ? "Live / scheduled"
      : isReplay
        ? condensed
          ? "Highlights"
          : "Full replay"
        : delta !== null && delta < REPLAY_MIN_MS
          ? "Live / scheduled"
          : guideLabel;
    rows.push({
      airTimeUTC: airing.airTimeUTC,
      endsAtUTC,
      timeUK: formatInZone(airing.airTimeUTC, "Europe/London"),
      market: airing.market ?? null,
      channel: { name: airing.channel, logo: await cacheChannelLogo(airing.channel) },
      watchKey: match?.watchKey ?? null,
      label,
      logos: match ? [match.homeLogo, match.awayLogo].filter(Boolean) : [],
      sublabel: [kind, match?.competition, match && delta >= REPLAY_MIN_MS ? `played ${matchDayLabel(match.localDate)}` : null]
        .filter(Boolean)
        .join(" · "),
    });
  }
  rows.sort((a, b) => Date.parse(a.airTimeUTC) - Date.parse(b.airTimeUTC));
  console.log(`${guideLabel} listings: ${rows.length} current/upcoming football rows`);
  return rows;
}

function readJsonSafe(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function eventKey(e) {
  // Prefer the canonical key computed once at merge time, from raw
  // pre-display-name team strings (see the merge step above). Re-deriving it
  // by re-normalizing the *display* name instead is NOT reliable: a display
  // name doesn't always normalize back to the same alias-resolved key its
  // own raw form used — e.g. "Estudiantes de La Plata" normalizes to
  // "estudiantes la plata", not the "estudiantes lp" key the raw
  // "Estudiantes"/"Estudiantes LP" forms resolve to (confirmed this is true
  // for most of team-display-names.js's entries, not a one-off). That
  // mismatch let an already-merged match silently re-diverge into two
  // entries on the very next accumulate-history step. Falls back to the old
  // recompute for any entry written before this field existed.
  return e.mergeKey ?? `${normalizeTeam(e.homeTeam)}|${normalizeTeam(e.awayTeam)}|${e.localDate}`;
}

// Re-runs classification against an already-archived event's own raw input
// (stored at capture time — see buildEvent()) so a classifyCompetition() bug
// fix retroactively purges anything that's now out of scope, instead of the
// stale verdict staying archived forever. An entry written before this field
// existed has no raw input to recheck — keep it rather than guess.
function stillInScope(e) {
  if (e.rawCompetitionLabel == null && e.rawCompetitionSlug == null && e.rawCompetitionCode == null) return true;
  const verdict = classifyCompetition({
    competition: e.rawCompetitionLabel,
    competitionSlug: e.rawCompetitionSlug,
    competitionCode: e.rawCompetitionCode,
  });
  return verdict === e.competition;
}

// Domestic leagues we scrape a *complete* roster for via standings.json —
// safe to use as an authoritative "is this team really in this competition"
// check. Continental cups (Libertadores/Sudamericana) are deliberately
// excluded: we only scrape the groups containing a recognized BR/AR/MX club,
// so a foreign opponent from an untracked group would be wrongly flagged as
// out of scope even though the match itself is entirely legitimate. Bracket
// cups (Copa do Brasil/Copa Argentina) have no fixed roster at all.
const ROSTER_CHECKED_COMPETITIONS = new Set(["Campeonato Brasileiro Série A", "Liga Profesional de Fútbol", "Liga MX"]);

// Catches what stillInScope() can't: a *source* mislabeling a match (not our
// classifyCompetition() rules being wrong), verified directly against a real
// team roster instead of trusting the raw label at face value.
function buildRosterLookup(standings) {
  const lookup = new Map();
  for (const table of standings?.tables ?? []) {
    if (!ROSTER_CHECKED_COMPETITIONS.has(table.competition)) continue;
    const teams = table.groups.flatMap((g) => g.rows.map((r) => normalizeTeam(r.team)));
    // A near-empty roster means the standings scrape itself failed or was
    // partial that day (has happened — ESPN's bot-wall) — never use an
    // incomplete roster to drop real matches; skip the check for that
    // competition on this run rather than risk wiping out a real fixture
    // list over a transient scrape failure elsewhere in the pipeline.
    if (teams.length < 10) continue;
    lookup.set(table.competition, new Set(teams));
  }
  return lookup;
}

// "Fresh wins on overlap" in the accumulate step assumes the fresh entry is
// complete. It isn't when a source failed — and the damage isn't confined to
// that source's own country, because the ARG/MX broadcast guides cross-list
// some CONMEBOL matches. Proven by fault injection: with Mexico throwing,
// "Palmeiras vs Cerro Porteño" lost ESPN 4 and "Atlético Tucumán vs
// Independiente" lost TyC Sports Internacional — the fresh entry for those
// fixtures was poorer than the archived one and overwrote it, and the
// changelog reported 22 fixtures as having "changed channels".
//
// So on a run where any fixture source failed, an overlapping event keeps the
// union of its archived and fresh channels. Deliberately gated on the failure
// rather than on "fresh has fewer channels than archived": the latter would
// fire on healthy runs too, and a channel genuinely dropped upstream would
// then stick forever. On a healthy run this is a no-op and removals still
// propagate exactly as before.
function mergeFreshChannels(fresh, archived) {
  if (!archived || !failedFixtureSources.size) return;
  for (const ch of archived.channels ?? []) {
    if (!fresh.channels.some((c) => c.name === ch.name)) fresh.channels.push(ch);
  }
  mergeBroadcastGroups(fresh, archived.broadcastGroups);
}

function isOnRoster(e, rosterLookup) {
  const roster = rosterLookup.get(e.competition);
  if (!roster) return true; // not a roster-checked competition, or no usable roster this run — don't guess
  if (e.homeTeamKey == null || e.awayTeamKey == null) return true; // written before this field existed — grandfather in
  return roster.has(e.homeTeamKey) && roster.has(e.awayTeamKey);
}

// Safety net beyond the mergeKey/alias system: catches any residual
// duplicate where the same real match is still represented by two entries
// under different keys — e.g. a stale pre-mergeKey entry, or any future gap
// in the alias table not yet discovered. Same date, same competition, and
// each side's team name is a substring of the other's (handles "Estudiantes"
// vs "Estudiantes de La Plata" even with no shared key at all).
function dedupeFuzzy(events) {
  const result = [];
  for (const e of events) {
    const dupIndex = result.findIndex(
      (other) =>
        other.localDate === e.localDate &&
        other.competition === e.competition &&
        namesOverlap(other.homeTeam, e.homeTeam) &&
        namesOverlap(other.awayTeam, e.awayTeam)
    );
    if (dupIndex === -1) {
      result.push(e);
      continue;
    }
    const existing = result[dupIndex];
    // Keep whichever entry has the more informative (longer) team names —
    // "Estudiantes de La Plata" over "Estudiantes" — merging in any channels
    // only the other one had.
    const existingLen = existing.homeTeam.length + existing.awayTeam.length;
    const candidateLen = e.homeTeam.length + e.awayTeam.length;
    const keep = candidateLen > existingLen ? e : existing;
    const other = keep === e ? existing : e;
    for (const ch of other.channels) {
      if (!keep.channels.some((c) => c.name === ch.name)) keep.channels.push(ch);
    }
    mergeBroadcastGroups(keep, other.broadcastGroups);
    result[dupIndex] = keep;
  }
  return result;
}

// The Brazilian guide only exposes yesterday/today/tomorrow. That means a
// future domestic fixture can legitimately arrive first through the
// Argentina/Mexico cross-listings with a flat channel row, before futebolnatv
// publishes its own card. Preserve the local Brazilian channels we can
// identify from that row instead of waiting for the narrow guide window.
const BRAZIL_DOMESTIC_COMPETITIONS = new Set(["Campeonato Brasileiro Série A", "Copa do Brasil"]);
function isBrazilLocalFixtureChannel(name) {
  const id = channelIdentity(name);
  return (
    /^(?:globo|globo internacional|sportv(?: \d+)?|premiere(?: \d+)?|caze|record|band|bandsports|sbt|ge|flamengo)$/.test(id) ||
    /^(?:onefootball|onefootball ppv|ppv onefootball)$/.test(id) ||
    /^(?:amazon )?prime video/.test(id) ||
    /^(?:disney|disney premium|hbo max|apple tv|x sports|space|tnt|paramount|espn(?: \d+)?)$/.test(id)
  );
}

function promoteBrazilFixtureChannels(events) {
  for (const event of events) {
    if (event.country !== "Brazil" || !BRAZIL_DOMESTIC_COMPETITIONS.has(event.competition)) continue;
    event.broadcastGroups ??= [];
    const brazil = event.broadcastGroups.find((g) => g.label === "Brazil");
    const grouped = new Set(event.broadcastGroups.flatMap((g) => (g.channels ?? []).map((c) => channelIdentity(c.name))));
    const candidates = (event.channels ?? []).filter((c) => isBrazilLocalFixtureChannel(c.name) && (!brazil || !grouped.has(channelIdentity(c.name))));
    if (!candidates.length) continue;
    if (brazil) {
      brazil.channels.push(...candidates.map((c) => ({ ...c })));
    } else {
      event.broadcastGroups.unshift({ label: "Brazil", channels: candidates.map((c) => ({ ...c })) });
    }
  }
}

function namesOverlap(a, b) {
  if (a === b || a.includes(b) || b.includes(a)) return true;
  // Also catch pairs that only match once run through the alias table —
  // e.g. "At. Paranaense" vs "Athletico Paranaense", which share no
  // substring but both normalize to "athletico paranaense". This is what
  // lets an already-archived entry self-heal once a new alias is added,
  // instead of being stuck under its old pre-alias key forever (an archived
  // event's mergeKey is never recomputed — see eventKey() above).
  return normalizeTeam(a) === normalizeTeam(b);
}

function describeEvent(e) {
  return `${e.homeTeam} vs ${e.awayTeam} (${e.competition}) — ${e.kickoffLocal}`;
}

// Compares this run's events against the previous run's, so the "recent
// updates" panel in the UI can show what the automated refresh actually did
// — added/removed fixtures, or channel confirmations landing on an existing
// one — without anyone having to dig through GitHub Actions logs or git
// history to answer "is this thing actually updating?".
function buildChangelogEntry(timestamp, previousEvents, currentEvents) {
  const prevByKey = new Map(previousEvents.map((e) => [eventKey(e), e]));
  const currByKey = new Map(currentEvents.map((e) => [eventKey(e), e]));

  const added = [];
  const removed = [];
  const channelsChanged = [];

  for (const [key, e] of currByKey) {
    if (!prevByKey.has(key)) {
      added.push(describeEvent(e));
    } else {
      const prevChannels = prevByKey.get(key).channels.map((c) => c.name).sort();
      const currChannels = e.channels.map((c) => c.name).sort();
      if (JSON.stringify(prevChannels) !== JSON.stringify(currChannels)) {
        channelsChanged.push(`${describeEvent(e)}: [${currChannels.join(", ") || "TBC"}]`);
      }
    }
  }
  for (const [key, e] of prevByKey) {
    if (!currByKey.has(key)) removed.push(describeEvent(e));
  }

  return { timestamp, totalEvents: currentEvents.length, added, removed, channelsChanged };
}

const CHANGELOG_MAX_ENTRIES = 5;

function appendChangelog(entry) {
  const existing = readJsonSafe("public/data/changelog.json") ?? [];
  const updated = [entry, ...existing].slice(0, CHANGELOG_MAX_ENTRIES);
  fs.writeFileSync("public/data/changelog.json", JSON.stringify(updated, null, 2), "utf8");
}

// Run only when executed directly — spike/test-football-correlation.js
// imports correlateFootballAirings from here without triggering a build.
import { pathToFileURL } from "url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

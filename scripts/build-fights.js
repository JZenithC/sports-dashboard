// Builds public/data/fights.json — the Fights (UFC + boxing) counterpart to
// mlb.json. Own script/output per the one-broken-pipeline-never-breaks-
// another rule. Sources (all validated live before this was written — see
// the Fights section of CLAUDE.md):
//   UFC:    ESPN's public site API (spike/fetch-ufc.js)
//   Boxing: BoxingScene's schedule flight payload (spike/scrape-boxingscene.js)
//   Replays ("catch up"): CBS Sports Network + Fight Network via TV
//           Passport, and Sky Sports / TNT Sports via tvguide.co.uk
//           (spike/replays/fight-replays.js)
//
// Replay correlation, same don't-guess posture as MLB's:
//  - a numbered-UFC airing matches only the event with that exact number
//    ("UFC Reloaded ... UFC 330 ..." -> UFC 330) — an exact key;
//  - anything else matches only when BOTH main-event surnames appear in
//    the airing's title/description;
//  - and every match requires the airing to start 6h-14d AFTER the event's
//    own start: a full card runs 4-6h, so 6h excludes the live broadcast
//    itself (tvguide.co.uk has no live flag — "Live UFC" is just a title),
//    and 14d keeps decades-old library re-airs ("UFC 222") from attaching.
// An airing that matches nothing attaches to nothing.
import fs from "fs";
import { fetchUfcEvents, fetchPflEvents } from "../spike/fetch-ufc.js";
import { fetchBoxingEvents } from "../spike/scrape-boxingscene.js";
import { fetchGlobalBoxingEvents } from "../spike/scrape-global-boxing.js";
import { fetchZuffaBoxingBroadcasts } from "../spike/scrape-zuffa-boxing.js";
import { fetchSherdogEvents } from "../spike/scrape-sherdog.js";
import {
  fetchNaFightAirings,
  fetchUkFightAirings,
  fetchUkLiveFightListings,
  fetchNaLiveFightListings,
} from "../spike/replays/fight-replays.js";
import { cacheImage } from "../spike/image-cache.js";
import { channelDomainFor } from "../spike/channel-logos.js";
import { recordSource, writeHealth } from "../spike/source-health.js";
import { appendUpdates, diffRuns } from "../spike/updates.js";

// UK rightsholders that can't come from the US-market sources, applied
// per event by ukChannelsFor() below:
//  - UFC numbered cards + Fight Nights -> TNT Sports, EPG-validated
//    (2026-08-11): TNT Sports 1 lists "Live UFC" in UFC 330's exact
//    broadcast windows.
//  - Dana White's Contender Series gets NO UK entry — validated the night
//    a DWCS card aired (2026-08-11): TNT's schedule showed padel and
//    cricket in its exact window, so there is no UK linear channel to
//    claim.
//  - PFL -> DAZN (exclusive UK/Europe rights deal, press-confirmed
//    2026-08-12; consistent with PFL's absence from TNT/Sky EPGs).
// Boxing needs no static entry — BoxingScene's per-event network list
// already carries UK carriers (Sky Sports, DAZN) where they exist.
function ukChannelsFor(e) {
  if (e.org === "UFC" && !/Contender Series/i.test(e.name)) return ["TNT Sports"];
  if (e.org === "PFL") return ["DAZN"];
  return null;
}

const PAST_WINDOW_MS = 14 * 86400000;
// 90 rather than 30 days: fight cards are announced months out, and a
// 30-day horizon was hiding cards the sources already had complete with
// dates AND channels (Canelo vs Mbilli, Whittaker vs Wallace, Smith vs
// Puello were all sitting in the pipeline unshown).
const FUTURE_WINDOW_MS = 90 * 86400000;
const FUTURE_WINDOW_DAYS = 90;
const MIN_REPLAY_LAG_MS = 6 * 3600000;
const MAX_REPLAY_LAG_MS = PAST_WINDOW_MS;

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

function ukDateKey(isoUTC) {
  return isoUTC ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(isoUTC)) : null;
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

// Broadcast sources often publish a channel name but not a click-through
// URL. These are official service homepages, not guessed event streams: they
// let the viewer check the live/replay catalogue without claiming that a
// particular event is available in every country.
const CHANNEL_URLS = new Map([
  ["dazn", "https://www.dazn.com/"],
  ["dazn ppv", "https://www.dazn.com/"],
  ["espn+", "https://plus.espn.com/"],
  ["espn", "https://www.espn.com/boxing/"],
  ["sky sports", "https://www.skysports.com/"],
  ["sky sports action", "https://www.skysports.com/"],
  ["sky sports main event", "https://www.skysports.com/"],
  ["tnt sports", "https://www.tntsports.co.uk/boxing/"],
  ["tnt sports 1", "https://www.tntsports.co.uk/boxing/"],
  ["tnt sports 2", "https://www.tntsports.co.uk/boxing/"],
  ["probox tv", "https://www.proboxtv.com/"],
  ["paramount+", "https://www.paramountplus.com/"],
  ["amazon prime", "https://www.primevideo.com/"],
  ["fight network", "https://www.fightnetwork.com/"],
  ["tiktok live", "https://www.tiktok.com/"],
]);
const channelUrlFor = (name) => CHANNEL_URLS.get(String(name ?? "").trim().toLowerCase()) ?? null;

// Org marks (UFC/PFL) and fighter country flags both come from ESPN's feed
// URLs; posters come from BoxingScene. All are self-hosted through the same
// image cache the rest of the project uses, keyed so repeat builds don't
// re-download: org by name, flag by its country code, poster by event slug.
function cacheOrgLogo(org, url) {
  return url ? cacheImage(url, { subdir: "orgs", cacheKey: org.toLowerCase() }) : Promise.resolve(null);
}
function cacheFlag(url) {
  if (!url) return Promise.resolve(null);
  const code = /countries\/\d+\/([a-z]+)\.\w+$/i.exec(url)?.[1];
  return cacheImage(url, { subdir: "flags", ...(code ? { cacheKey: code.toLowerCase() } : {}) });
}
// Deliberately NOT keyed by event slug: promoters swap a card's artwork
// (announcement art -> final poster) when an opponent or co-main changes,
// and a slug key would mask that forever since cacheImage returns any
// existing file for the key. Falling back to the default URL content-hash
// means replacement artwork downloads itself on the next build; the
// superseded file just sits unused, which is the cheaper trade.
function cachePoster(url) {
  return url ? cacheImage(url, { subdir: "posters" }) : Promise.resolve(null);
}

const stripDiacritics = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const surnameOf = (fighter) => stripDiacritics(fighter.trim().split(/\s+/).pop() ?? "");

// The sortable instant for an event — events whose source lists a date but
// no time sort at that day's end so they never look "started" prematurely.
const startMsOf = (e) => Date.parse(e.dateUTC ?? `${e.dateOnly}T23:59:00Z`);

// Pure correlation step, exported so the matching rules are testable
// against real airing titles without live timing luck (a fresh build day
// can legitimately have zero matches — see spike/test-fight-correlation.js).
export function correlateFightAirings(airings, recentEvents) {
  const matches = [];
  for (const a of airings) {
    const airMs = Date.parse(a.airTimeUTC);
    const title = stripDiacritics(a.title);
    const numMatch = /\bufc\s+(\d{2,3})\b/.exec(title);
    let matched = null;
    for (const e of recentEvents) {
      const lag = airMs - startMsOf(e);
      if (lag < MIN_REPLAY_LAG_MS || lag > MAX_REPLAY_LAG_MS) continue;
      if (numMatch && e.org === "UFC") {
        if (new RegExp(`^ufc ${numMatch[1]}\\b`).test(stripDiacritics(e.name))) {
          matched = e;
          break;
        }
        continue; // a numbered airing only ever matches its own number
      }
      const surnames = (e.mainEventFighters ?? []).map(surnameOf).filter(Boolean);
      if (surnames.length >= 2 && surnames.every((s) => title.includes(s))) {
        matched = e;
        break;
      }
    }
    if (matched) matches.push({ airing: a, event: matched });
  }
  return matches;
}

async function main() {
  const previous = readJsonSafe("public/data/fights.json");
  const prevEvents = [...(previous?.upcoming ?? []), ...(previous?.recent ?? [])];

  // Keep the previous run's events for an org rather than blanking the tab
  // when its fetch fails — same keep-previous principle as build-mlb's
  // standings fallback.
  async function fetchOrKeepPrevious(label, org, fetcher) {
    console.log(`Fetching ${label} events...`);
    try {
      const rows = await fetcher();
      recordSource(`fights-${org.toLowerCase()}`, { label: `${label} schedule`, group: "Fights", ok: true, items: rows.length });
      return rows;
    } catch (err) {
      console.error(`[fights] ${label} fetch failed, keeping previous: ${err.message}`);
      recordSource(`fights-${org.toLowerCase()}`, { label: `${label} schedule`, group: "Fights", ok: false, error: err.message });
      return prevEvents.filter((e) => e.org === org).map((e) => e.source ?? e).filter(Boolean);
    }
  }
  const ufc = await fetchOrKeepPrevious("UFC", "UFC", () => fetchUfcEvents({ pastDays: 14, futureDays: FUTURE_WINDOW_DAYS }));
  const pfl = await fetchOrKeepPrevious("PFL", "PFL", () => fetchPflEvents({ pastDays: 14, futureDays: FUTURE_WINDOW_DAYS }));
  const boxing = await fetchOrKeepPrevious("boxing", "Boxing", () => fetchBoxingEvents());
  // Every MMA promotion the ESPN feeds don't reach (ONE, Rizin, ACA, LFA,
  // Cage Fury, Brave, Pancrase...). Shares the "MMA" org with EPG-derived
  // events, so it rides the same carry-forward.
  const sherdog = await fetchOrKeepPrevious("Sherdog MMA", "MMA", () => fetchSherdogEvents({ pastDays: 14, futureDays: FUTURE_WINDOW_DAYS }));

  // BoxingScene lists upcoming cards only, so a card that happened
  // yesterday vanishes from the source — carry past boxing events forward
  // from the previous build (that's what makes boxing replays matchable).
  // EPG-derived events (below) ride the same carry since they share the
  // Boxing org.
  // Orgs whose events only ever come from schedule scrapes/EPG (UFC and PFL
  // arrive complete from the feeds' own past window, so they need no carry).
  const CARRIED_ORGS = new Set(["Boxing", "MMA"]);
  // Sherdog joins the same pool the EPG merge and carry-forward operate on,
  // so an EPG listing that matches one of its cards by surnames attaches its
  // channel there rather than creating a second copy.
  boxing.push(...sherdog);
  const boxingSlugs = new Set(boxing.map((e) => e.slug));
  for (const prev of prevEvents) {
    const src = prev.source ?? null;
    if (!src || !CARRIED_ORGS.has(src.org) || boxingSlugs.has(src.slug)) continue;
    const start = startMsOf(src);
    if (start < Date.now() && Date.now() - start <= PAST_WINDOW_MS) {
      boxing.push(src);
      boxingSlugs.add(src.slug);
    }
  }

  // ---- independent boxing broadcast enrichment ----
  // BoxingScene's network array is intentionally retained, but it is a
  // mixed-market list. These sources add market-labelled rows only where a
  // permitted source says them explicitly:
  //  - Global Boxing News: current UK schedule + official service links;
  //  - UFC's Zuffa Boxing guide: official country matrix for that promotion.
  // A market row never creates a card by itself unless its source also has a
  // dated, parseable event; the UFC guide is enrichment-only because its
  // watch article does not publish a machine-readable date.
  async function fetchBoxingEnrichment(id, label, fetcher) {
    try {
      const rows = await fetcher();
      recordSource(id, { label, group: "Fights", ok: true, items: rows.length });
      return rows;
    } catch (err) {
      console.error(`[fights] ${label} failed: ${err.message}`);
      recordSource(id, { label, group: "Fights", ok: false, error: err.message });
      return [];
    }
  }
  const globalBoxing = await fetchBoxingEnrichment(
    "fights-boxing-global",
    "Global Boxing News schedule (UK)",
    () => fetchGlobalBoxingEvents()
  );
  const zuffaGuides = await fetchBoxingEnrichment(
    "fights-zuffa-worldwide",
    "UFC Zuffa Boxing country guide",
    () => fetchZuffaBoxingBroadcasts()
  );

  const eventPairKey = (fighters) => (fighters ?? []).map(surnameOf).filter(Boolean).sort().join("|");
  const sameFightCard = (a, b) => {
    const aKey = eventPairKey(a.mainEventFighters);
    const bKey = eventPairKey(b.mainEventFighters);
    if (!aKey || aKey !== bKey) return false;
    const aStart = startMsOf(a);
    const bStart = startMsOf(b);
    return Number.isNaN(aStart) || Number.isNaN(bStart) || Math.abs(aStart - bStart) <= 36 * 3600000;
  };
  const addBroadcastRows = (target, rows) => {
    const existing = target.broadcastMarkets ?? [];
    const merged = new Map(existing.map((row) => [`${row.market}|${row.name}|${row.url ?? ""}`, row]));
    for (const row of rows ?? []) {
      if (!row?.market || !row?.name) continue;
      merged.set(`${row.market}|${row.name}|${row.url ?? ""}`, row);
    }
    target.broadcastMarkets = [...merged.values()];
    target.broadcasts = [...new Set([...(target.broadcasts ?? []), ...target.broadcastMarkets.map((row) => row.name)])];
  };

  for (const enrichment of globalBoxing) {
    const target = boxing.find((event) => sameFightCard(event, enrichment));
    if (target) {
      addBroadcastRows(target, enrichment.broadcastMarkets);
      target.broadcastSourceUrl ??= enrichment.broadcastSourceUrl;
      continue;
    }
    // Only Global Boxing News has enough information to create a new card;
    // it is still subject to the same 90-day/14-day window below.
    if (enrichment.mainEventFighters?.length === 2 && enrichment.dateUTC) {
      const added = { ...enrichment, slug: enrichment.slug ?? `gbn-${eventPairKey(enrichment.mainEventFighters)}` };
      boxing.push(added);
      boxingSlugs.add(added.slug);
    }
  }
  for (const guide of zuffaGuides) {
    const target = boxing.find((event) => sameFightCard(event, guide));
    if (target) {
      addBroadcastRows(target, guide.broadcastMarkets);
      target.broadcastSourceUrl ??= guide.broadcastSourceUrl;
      target.promotion ??= guide.promotion;
    }
    // The Paramount announcement is promotion-wide, not an event listing.
    // Apply only to cards whose own source identifies them as Zuffa Boxing;
    // never spread these rights to an unrelated Paramount+ boxing card.
    for (const event of boxing) {
      const isZuffa = /zuffa\s+boxing/i.test(`${event.promotion ?? ""} ${event.posterAttribution ?? ""}`);
      if (!isZuffa || !guide.promotionMarkets?.length) continue;
      addBroadcastRows(event, guide.promotionMarkets);
      event.promotion ??= guide.promotion;
    }
  }

  // ---- EPG-derived boxing events ----
  // The weekly-fight-night reality: BoxingScene tracks marquee cards only
  // (verified — a live Sky Sports card appeared on none of its pages), so
  // live boxing listings on the tracked UK/NA channels become events in
  // their own right. A listing with a parseable "A v B" matchup either
  // MERGES into a known card (same main-event surnames within 36h — its
  // channel is added to that card's broadcasts) or becomes a new Boxing
  // event. No clean matchup -> no event, never a guess.
  console.log("Fetching live fight listings...");
  let liveListings = [];
  try {
    liveListings = [...(await fetchUkLiveFightListings()), ...(await fetchNaLiveFightListings())];
    recordSource("fights-live-listings", { label: "EPG-derived fight cards", group: "Fights", ok: true, items: liveListings.length });
  } catch (err) {
    console.error(`[fights] live fight listings failed: ${err.message}`);
    recordSource("fights-live-listings", { label: "EPG-derived fight cards", group: "Fights", ok: false, error: err.message });
  }
  const parseMatchup = (text) => {
    const parts = (text ?? "")
      .split(/\s+vs?\.?\s+/i)
      // Listings tack the source event onto the second name ("Yana
      // Kunitskaya from UFC 222") — that's provenance, not part of a
      // fighter's name.
      .map((s) => s.replace(/\s+from\s+.*$/i, "").trim())
      .filter(Boolean);
    return parts.length === 2 && parts.every((p) => p.length >= 3) ? parts : null;
  };
  const surnamePairKey = (fighters) => fighters.map(surnameOf).sort().join("|");
  // Grouped by matchup ONLY (no date component): tvguide's "Live" title
  // prefix survives on repeat airings, so one card shows up across several
  // days — the earliest airing is the event's real start, later ones are
  // its re-airs (which the replay correlation then attaches).
  const epgGroups = new Map();
  for (const l of liveListings) {
    let fighters = parseMatchup(l.matchup);
    let series = l.series;
    if (!fighters) {
      fighters = parseMatchup(l.series);
      series = null;
    }
    if (!fighters) {
      // Promotion cards ("One Fight Night 46") name the headline bout only
      // in the blurb; when they do, the short line is the event's own name
      // and makes the better title.
      const m = /headlined by\s+(.+?)\s+vs?\.?\s+(.+?)(?:\s+for\b|\s+at\b|[.,]|$)/i.exec(l.description ?? "");
      if (m) {
        fighters = [m[1].trim(), m[2].trim()];
        series = l.matchup?.trim() || l.series;
      }
    }
    if (!fighters) continue;
    const key = surnamePairKey(fighters);
    if (!epgGroups.has(key)) {
      // A title that already contains both names ("Zuffa Boxing Aaron
      // McKenna v Etinosa Oliha") is its own display name; otherwise
      // compose one.
      const name = series && fighters.every((f) => series.includes(f)) ? series : `${series ? `${series}: ` : ""}${fighters.join(" vs ")}`;
      epgGroups.set(key, {
        fighters,
        name,
        org: l.org ?? "Boxing",
        dateUTC: l.airTimeUTC,
        channels: new Set(),
        markets: new Map(),
      });
    }
    const g = epgGroups.get(key);
    if (Date.parse(l.airTimeUTC) < Date.parse(g.dateUTC)) g.dateUTC = l.airTimeUTC;
    g.channels.add(l.channel);
    if (l.market) g.markets.set(`${l.market}|${l.channel}`, { market: l.market, name: l.channel });
  }
  let epgMerged = 0;
  let epgNew = 0;
  for (const g of epgGroups.values()) {
    const gKey = surnamePairKey(g.fighters);
    // Known-event match spans the whole past window: a carried-forward card
    // from days ago must absorb this week's "Live"-titled repeats rather
    // than let them spawn a duplicate. Same-pair rematches inside 14 days
    // don't happen in boxing.
    const known = boxing.find(
      (b) =>
        (b.mainEventFighters?.length ?? 0) >= 2 &&
        surnamePairKey(b.mainEventFighters) === gKey &&
        Math.abs(startMsOf(b) - Date.parse(g.dateUTC)) <= PAST_WINDOW_MS
    );
    if (known) {
      addBroadcastRows(
        known,
        [...g.markets.values()].length
          ? [...g.markets.values()]
          : [...g.channels].map((name) => ({ market: "UK", name }))
      );
      epgMerged++;
      continue;
    }
    const slug = `epg-${gKey.replace(/[^a-z0-9|]/gi, "")}-${g.dateUTC.slice(0, 10)}`;
    if (boxingSlugs.has(slug)) continue;
    boxingSlugs.add(slug);
    boxing.push({
      org: g.org,
      slug,
      name: g.name,
      dateUTC: g.dateUTC,
      dateOnly: g.dateUTC.slice(0, 10),
      venue: null,
      city: null,
      mainEventFighters: g.fighters,
      broadcasts: [...g.channels],
      broadcastMarkets: [...g.markets.values()],
    });
    epgNew++;
  }
  // A promotion's card can arrive twice: once from a schedule source with
  // no channel (Sherdog's "One on Prime Video 46") and once from an EPG
  // listing that names a different product for the same show ("One Fight
  // Night 46"). Surname matching can't join them — the schedule copy has no
  // announced bout — so they're matched on promotion word + event number
  // within a day, and the EPG copy wins since it carries a channel and a
  // real start time.
  const promoKey = (name) => {
    const word = /^([a-z]+)/i.exec(name.trim())?.[1]?.toLowerCase();
    const num = /\b(\d{1,4})\b/.exec(name)?.[1];
    return word && num ? `${word}|${num}` : null;
  };
  const epgKeys = new Map();
  for (const e of boxing) {
    if (!e.slug?.startsWith("epg-")) continue;
    const k = promoKey(e.name);
    if (k) epgKeys.set(k, startMsOf(e));
  }
  let deduped = 0;
  for (let i = boxing.length - 1; i >= 0; i--) {
    const e = boxing[i];
    if (!e.slug?.startsWith("sherdog-")) continue;
    const k = promoKey(e.name);
    if (k && epgKeys.has(k) && Math.abs(epgKeys.get(k) - startMsOf(e)) <= 36 * 3600000) {
      boxing.splice(i, 1);
      deduped++;
    }
  }

  console.log(
    `Live fight listings: ${liveListings.length} -> ${epgMerged} merged into known cards, ${epgNew} new event(s), ${deduped} schedule duplicate(s) dropped`
  );

  const nowMs = Date.now();
  const upcomingSrc = [];
  const recentSrc = [];
  for (const e of [...ufc, ...pfl, ...boxing]) {
    const start = startMsOf(e);
    if (Number.isNaN(start)) continue;
    if (start >= nowMs && start - nowMs <= FUTURE_WINDOW_MS) upcomingSrc.push(e);
    else if (start < nowMs && nowMs - start <= PAST_WINDOW_MS) recentSrc.push(e);
  }
  upcomingSrc.sort((a, b) => startMsOf(a) - startMsOf(b));
  recentSrc.sort((a, b) => startMsOf(b) - startMsOf(a));

  console.log("Fetching replay airings...");
  let airings = [];
  try {
    airings = [...(await fetchNaFightAirings()), ...(await fetchUkFightAirings())];
    recordSource("fights-replays", { label: "Fight replay listings (UK + US)", group: "Fights", ok: true, items: airings.length });
  } catch (err) {
    console.error(`[fights] replay airings failed: ${err.message}`);
    recordSource("fights-replays", { label: "Fight replay listings (UK + US)", group: "Fights", ok: false, error: err.message });
  }

  // ---- correlation ----
  const matchedAirings = correlateFightAirings(airings, recentSrc);
  const replaysByEvent = new Map();
  for (const { airing, event } of matchedAirings) {
    if (!replaysByEvent.has(event)) replaysByEvent.set(event, []);
    replaysByEvent.get(event).push(airing);
  }

  console.log(`Replay airings: ${airings.length} fetched, ${matchedAirings.length} matched to recent events`);

  // ---- shape for the frontend (renderEvent card model) ----
  async function broadcastGroupsFor(e) {
    const groups = [];
    const namedRows = new Set();
    const addGroup = (label, rows) => {
      const cleanRows = [];
      for (const row of rows ?? []) {
        const name = typeof row === "string" ? row : row?.name;
        if (!name) continue;
        cleanRows.push({ name, url: typeof row === "object" ? row.url ?? channelUrlFor(name) : channelUrlFor(name) });
        namedRows.add(name);
      }
      if (cleanRows.length) groups.push({ label, rows: cleanRows });
    };

    // These rows are market-labelled by a source that actually published
    // the distribution. They are not inferred from a platform's brand.
    const byMarket = new Map();
    for (const row of e.broadcastMarkets ?? []) {
      if (!row?.market || !row?.name) continue;
      if (!byMarket.has(row.market)) byMarket.set(row.market, []);
      byMarket.get(row.market).push(row);
    }
    for (const [market, rows] of byMarket) addGroup(market, rows);

    const usNames = e.broadcasts ?? [];
    const uk = ukChannelsFor(e);
    if (e.org === "UFC" || e.org === "PFL") {
      if (usNames.length) addGroup("US", usNames.filter((name) => !namedRows.has(name)));
      if (uk) addGroup("UK", uk.filter((name) => !namedRows.has(name)));
    } else if (usNames.length) {
      // BoxingScene's list mixes markets, so preserve it under an explicit
      // source label rather than presenting it as worldwide or US-only.
      addGroup("Listed by source", usNames.filter((name) => !namedRows.has(name)));
    }
    const out = [];
    for (const g of groups) {
      const channels = [];
      for (const row of g.rows) channels.push({ name: row.name, url: row.url, logo: await cacheChannelLogo(row.name) });
      out.push({ label: g.label, channels });
    }
    // Null rather than an empty array: it makes renderEvent fall through to
    // its plain channel row, which shows "Channel TBC" — the same honest
    // placeholder football fixtures use when no broadcaster is known yet.
    return out.length ? out : null;
  }

  async function toCard(e) {
    // Plenty of cards (ONE's Friday Fights, Japanese promotions) have no
    // announced headline bout — those render as a title-only card rather
    // than a fake "Event Name vs TBA" matchup.
    const [f1 = null, f2 = null] = e.mainEventFighters ?? [];
    const [flag1, flag2] = e.mainEventFlagUrls ?? [];
    // Every fight card gets exactly one identity graphic: a boxing card's
    // own poster where the source has one, otherwise the org's mark (UFC's
    // covers Contender Series too — ESPN has no separate DWCS league, and
    // it genuinely is a UFC property). Boxing cards with neither fall back
    // to an emoji badge in the frontend rather than an empty slot.
    const [orgLogo, poster] = await Promise.all([
      cacheOrgLogo(e.org, e.orgLogoUrl),
      cachePoster(e.posterUrl),
    ]);
    const eventTagParts = [
      e.org === "Boxing" ? "Boxing" : e.name.split(":")[0],
      [e.venue, e.city].filter(Boolean).join(", ") || null,
      e.org !== "Boxing" && e.boutCount ? `${e.boutCount}-fight card` : null,
      e.org !== "Boxing" && e.mainCardUTC ? `main card ${formatInZone(e.mainCardUTC, "Europe/London")} UK` : null,
    ].filter(Boolean);
    return {
      org: e.org,
      eventName: e.name,
      eventTag: eventTagParts.join(" · "),
      homeTeam: f1,
      awayTeam: f2,
      cardTitle: f1 && f2 ? null : e.name, // drives the title-only layout
      // Country flags in the badge slots — the sport's own convention, and
      // the only fighter imagery any permitted source offers (the ESPN feed
      // has no headshots). Boxing fighters have no flag data, so those
      // cards keep the monogram badges renderEvent already falls back to.
      homeLogo: await cacheFlag(flag1),
      awayLogo: await cacheFlag(flag2),
      orgName: e.org,
      orgLogo,
      // The rest of the card, headline excluded (it's already the matchup
      // above). Sources list bouts headline-last for MMA and headline-first
      // for boxing, so the main event is matched by name rather than by
      // position.
      undercard: (e.bouts ?? [])
        .filter((b) => !(f1 && f2 && [b.a, b.b].every((n) => [f1, f2].some((f) => surnameOf(f) === surnameOf(n)))))
        .map((b) => ({ title: `${b.a} v ${b.b}`, weightClass: b.weightClass ?? null })),
      poster: poster ? { src: poster, attribution: e.posterAttribution ?? null } : null,
      kickoffUTC: e.dateUTC ?? `${e.dateOnly}T23:59:00Z`,
      kickoffLocal: null, // venue-local time isn't derivable (no tz in the sources) — never faked
      kickoffUK: e.dateUTC ? formatInZone(e.dateUTC, "Europe/London") : null,
      localDate: ukDateKey(e.dateUTC ?? `${e.dateOnly}T12:00:00Z`),
      channels: [],
      broadcastGroups: await broadcastGroupsFor(e),
      source: e, // carried so the next build can roll past boxing cards forward
      // Stable identity for the "watched" tracker (see api/watched.js) —
      // same shape diffRuns() already keys on below.
      watchKey: `fights:${e.org}|${f1}|${f2}|${ukDateKey(e.dateUTC ?? `${e.dateOnly}T12:00:00Z`)}`,
    };
  }

  const upcoming = [];
  for (const e of upcomingSrc) upcoming.push(await toCard(e));
  const recent = [];
  const cardByEvent = new Map();
  for (const e of recentSrc) {
    const card = await toCard(e);
    cardByEvent.set(e, card);
    recent.push(card);
  }

  for (const [event, list] of replaysByEvent) {
    list.sort((a, b) => Date.parse(a.airTimeUTC) - Date.parse(b.airTimeUTC));
    const byMarket = new Map();
    for (const a of list) {
      const key = `${a.channel}|${a.airTimeUTC}`;
      const market = a.market ?? "Replay";
      if (!byMarket.has(market)) byMarket.set(market, { seen: new Set(), channels: [] });
      const group = byMarket.get(market);
      if (group.seen.has(key)) continue;
      group.seen.add(key);
      group.channels.push({
        name: a.channel,
        logo: await cacheChannelLogo(a.channel),
        timeUK: formatInZone(a.airTimeUTC, "Europe/London"),
        airTimeUTC: a.airTimeUTC,
      });
    }
    cardByEvent.get(event).replayGroups = [...byMarket.entries()].map(([label, group]) => ({ label, channels: group.channels }));
  }

  // Flat, airing-ordered catch-up schedule (the "what can I watch next"
  // view) — one row per airing, the same event repeating per re-air.
  const replaySchedule = [];
  const seenSched = new Set();
  for (const { airing, event } of matchedAirings) {
    const key = `${airing.channel}|${airing.airTimeUTC}`;
    if (seenSched.has(key)) continue;
    seenSched.add(key);
    replaySchedule.push({
      airTimeUTC: airing.airTimeUTC,
      // See build-mlb.js: keeps an airing listed until it actually ends.
      // TV Passport supplies the slot length; tvguide.co.uk has no duration
      // field, so a full fight card's typical four hours stands in.
      endsAtUTC: new Date(Date.parse(airing.airTimeUTC) + (airing.durationMinutes ?? 240) * 60000).toISOString(),
      timeUK: formatInZone(airing.airTimeUTC, "Europe/London"),
      channel: { name: airing.channel, logo: await cacheChannelLogo(airing.channel) },
      market: airing.market ?? null,
      // Same key as the source card, so marking one watched (live or from
      // any re-air) flags every other re-air of the same event too.
      watchKey: cardByEvent.get(event)?.watchKey,
      label: event.name,
      // Same little-crest treatment MLB's catch-up rows get, using whichever
      // identity graphic this event carries.
      logos: [cardByEvent.get(event)?.orgLogo ?? cardByEvent.get(event)?.poster?.src].filter(Boolean),
      sublabel: `${event.org} · ${formatInZone(event.dateUTC, "Europe/London") ?? event.dateOnly}`,
    });
  }
  // Fight programming that names a real matchup but matches no event we
  // track — an MVP Boxing re-air, a BKFC card, a Sky "Fight Night" — is
  // still something you can watch, and dropping it left the catch-up list
  // looking empty next to what's actually on UK television. Listed by
  // matchup with the programme name as context, never claiming to be a
  // specific tracked event. Airings with no matchup at all (UFC Countdown,
  // The Ultimate Fighter, Ultimate Knockouts compilations) stay out: they're
  // studio/preview shows, not a card you can catch up on.
  const matchedAiringKeys = new Set(matchedAirings.map(({ airing }) => `${airing.channel}|${airing.airTimeUTC}`));
  const upcomingSurnamePairs = new Set(
    upcomingSrc
      .filter((e) => (e.mainEventFighters ?? []).length >= 2)
      .map((e) => e.mainEventFighters.map(surnameOf).sort().join("|"))
  );
  const seenExtra = new Set();
  for (const a of airings) {
    const key = `${a.channel}|${a.airTimeUTC}`;
    if (matchedAiringKeys.has(key) || seenExtra.has(key)) continue;
    const fighters =
      parseMatchup(a.matchup) ??
      parseMatchup((a.series ?? "").split(":").pop()) ??
      (() => {
        const m = /headlined by\s+(.+?)\s+vs?\.?\s+(.+?)(?:\s+for\b|\s+at\b|[.,]|$)/i.exec(a.description ?? "");
        return m ? [m[1].trim(), m[2].trim()] : null;
      })();
    if (!fighters) continue;
    // The live broadcast of a card already shown as an upcoming event isn't
    // a catch-up item — it's on that card.
    if (upcomingSurnamePairs.has(fighters.map(surnameOf).sort().join("|"))) continue;
    seenExtra.add(key);
    replaySchedule.push({
      airTimeUTC: a.airTimeUTC,
      endsAtUTC: new Date(Date.parse(a.airTimeUTC) + (a.durationMinutes ?? 240) * 60000).toISOString(),
      timeUK: formatInZone(a.airTimeUTC, "Europe/London"),
      channel: { name: a.channel, logo: await cacheChannelLogo(a.channel) },
      market: a.market ?? null,
      label: fighters.join(" v "),
      sublabel: (a.series ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || "Fight card",
    });
  }

  replaySchedule.sort((a, b) => Date.parse(a.airTimeUTC) - Date.parse(b.airTimeUTC));

  const output = { generatedAt: new Date().toISOString(), upcoming, recent, replaySchedule };

  // Cards are keyed by promotion + the two headline fighters + date: an
  // event's name gets rewritten between builds (a Sherdog product name
  // giving way to the EPG's), but that trio stays put.
  appendUpdates(
    "fights",
    diffRuns(previous?.upcoming ?? [], upcoming, {
      keyOf: (e) => `${e.org}|${e.homeTeam}|${e.awayTeam}|${e.localDate}`,
      describe: (e) => `${e.eventName ?? e.cardTitle ?? `${e.homeTeam} v ${e.awayTeam}`} (${e.localDate})`,
    })
  );
  fs.mkdirSync("public/data", { recursive: true });
  fs.writeFileSync("public/data/fights.json", JSON.stringify(output, null, 2), "utf8");
  writeHealth();
  console.log(`\nWrote public/data/fights.json (${upcoming.length} upcoming, ${recent.length} recent, ${replaySchedule.length} scheduled replays)`);
}

// Run only when executed directly — spike/test-fight-correlation.js imports
// correlateFightAirings from here without triggering a build.
import { pathToFileURL } from "url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

// Fight (UFC/boxing) replay airings across North American and UK linear
// channels — the "catch up" data source for the Fights vertical. Both legs
// were validated live 2026-08-11 (see the Fights section of CLAUDE.md):
//
// North America — TV Passport, reusing the same listing layer the MLB
// replay scraper runs on (spike/replays/tvpassport.js):
//  - CBS Sports Network airs "UFC Reloaded" full-event replays with
//    data-league="UFC" and the EVENT NUMBER in the episode title
//    ("UFC 322 Della Maddalena vs Makhachev") — an exact correlation key.
//  - Fight Network is a 24/7 fight channel (full-event replays of boxing /
//    BKFC / MMA confirmed in its listings).
//  - ESPN2 was checked and deliberately NOT included: its fight programming
//    is gone with the 2026 rights move.
//
// UK — tvguide.co.uk via the shared channel-listings layer in
// spike/replays/tvguide.js (which the football replay scraper also reads,
// so overlapping channels are fetched once per build).
//
// This module only collects candidate airings (filtered to fight
// programming); deciding WHICH event an airing replays — and whether it's
// a replay at all rather than the live broadcast — is build-fights.js's
// correlation job, same separation the MLB pipeline uses.
import { scrapeTvpassportListings } from "./tvpassport.js";
import { scrapeTvguideChannel } from "./tvguide.js";

const TVP_STATIONS = [
  { path: "cbs-sports-network-usa/3115", channel: "CBS Sports Network", market: "United States", zone: "America/New_York" },
  { path: "fight-network-canada/3433", channel: "Fight Network", market: "Canada", zone: "America/New_York" }, // the Canada feed is the one whose listings were validated; the USA feed carried nothing on the check day
];

const FIGHT_TITLE_RE = /\bUFC\b|boxing|fight night|\bBKFC\b|\bBKB\b|\bPFL\b|\bMMA\b|contender series/i;

// Replay airings and live listings are read from the SAME pages — memoize
// per process so a build run fetches each station/channel exactly once.
const tvpCache = new Map();
function tvpListingsFor(path) {
  if (!tvpCache.has(path)) tvpCache.set(path, scrapeTvpassportListings({ path }));
  return tvpCache.get(path);
}
let ukRowsPromise = null;
function ukFightRowsOnce() {
  ukRowsPromise ??= fetchUkFightRows();
  return ukRowsPromise;
}

export async function fetchNaFightAirings() {
  const out = [];
  for (const st of TVP_STATIONS) {
    try {
      for (const { attrs, airTimeUTC } of await tvpListingsFor(st.path)) {
        if (attrs.live === "1") continue;
        const title = [attrs.showName, attrs.episodeTitle].filter(Boolean).join(" ").trim();
        if (!(attrs.league === "UFC" || FIGHT_TITLE_RE.test(title))) continue;
        out.push({
          channel: st.channel,
          market: st.market,
          zone: st.zone,
          airTimeUTC,
          durationMinutes: Number(attrs.duration) || null,
          title,
          series: attrs.showName ?? "",
          matchup: attrs.episodeTitle ?? "",
          description: attrs.description ?? "",
        });
      }
    } catch (err) {
      // One broken station never blanks the rest — same principle as every
      // other scraper here.
      console.error(`[fight-replays] ${st.channel}: ${err.message}`);
    }
  }
  return out;
}

// TNT is here because it demonstrably still carries UFC in the UK as of
// Aug 2026 — its EPG lists "Live UFC" in UFC 330's exact prelim/main-card
// windows plus Countdown/Breakdown shoulder programming, despite press
// reports of a Paramount UK takeover (see CLAUDE.md: EPG evidence beats
// secondhand articles). Sky Sports Action/Main Event carry boxing and its
// re-airs. 5Action was checked (Paramount-terrestrial theory) and showed
// no fight programming — not scraped.
const TVGUK_CHANNELS = [
  { slug: "sky-sports-action-hd", channel: "Sky Sports Action" },
  { slug: "sky-sports-main-event-hd", channel: "Sky Sports Main Event" },
  { slug: "sky-sports-mix", channel: "Sky Sports Mix" }, // validated carrying fight programming (note: no "-hd" suffix, unlike its siblings)
  { slug: "tnt-sports-1-hd", channel: "TNT Sports 1" },
  { slug: "tnt-sports-2-hd", channel: "TNT Sports 2" },
];

// All fight-related rows from the UK channels, live and not — tvguide.co.uk
// has no live flag, but live broadcasts consistently carry a "Live" title
// prefix (validated: "Live Zuffa Boxing ...", "Live UFC"). `subShort` is
// the row's compact description ("Aaron McKenna v Etinosa Oliha") — the
// cleanest matchup text the page offers.
async function fetchUkFightRows() {
  const rows = [];
  for (const ch of TVGUK_CHANNELS) {
    try {
      // Six days ahead so the coming weekend — when fight cards actually
      // air — is always in reach, whatever weekday the build runs on.
      for (const r of await scrapeTvguideChannel({ slug: ch.slug, days: 6 })) {
        if (!FIGHT_TITLE_RE.test(`${r.title} ${r.subAll}`)) continue;
        rows.push({
          channel: ch.channel,
          market: "UK",
          zone: "Europe/London",
          airTimeUTC: r.airTimeUTC,
          title: r.title,
          subShort: r.subShort,
          subAll: r.subAll,
          isLive: /^Live\b/i.test(r.title),
        });
      }
    } catch (err) {
      console.error(`[fight-replays] ${ch.channel}: ${err.message}`);
    }
  }
  return rows;
}

export async function fetchUkFightAirings() {
  // No liveness filter here: tvguide keeps the "Live ..." programme title
  // on REPEAT airings too, so title text can't separate live from re-air —
  // the correlation step's airs-6h-after-the-event guard does that
  // (build-fights.js), and it needs the "Live"-titled repeats included.
  const rows = await ukFightRowsOnce();
  return rows.map((r) => ({
    channel: r.channel,
    market: r.market,
    zone: r.zone,
    airTimeUTC: r.airTimeUTC,
    title: `${r.title} ${r.subAll}`.trim(),
    // Components kept separate as well: correlation uses the combined text,
    // but an airing that matches no known event still needs a clean matchup
    // and programme name to be listed on its own (see build-fights.js).
    series: r.title.replace(/^Live[:\s]+/i, "").trim(),
    matchup: r.subShort,
    description: r.subAll,
  }));
}

// ---- live listings: the EPG-derived event feed ----
// "Years ago there were fight nights every week on TV" — for a viewer,
// what's on IS the schedule, so live fight listings on the tracked channels
// become events in their own right (build-fights.js merges them with
// BoxingScene's marquee cards or adds them as new events). This covers the
// promotions no league feed reaches: boxing of course, but also ONE
// Championship, BKFC, BKB and the like — only UFC/PFL/Contender Series are
// excluded, because their events already arrive from the ESPN feeds and
// must not be duplicated.
//
// Liveness is decided by the "Live" title prefix (UK) or TV Passport's
// data-live flag (NA), and that guard is load-bearing: a channel airing an
// old bout labels it plainly ("Fight Night" / "Action from the IBF and WBO
// World Super-Featherweight title bout") where a live card reads "Live
// Zuffa Boxing". Without the guard, archive re-airs would invent events.
// Repeat airings DO keep the "Live" prefix though, so a matchup can appear
// on several days — the caller groups by matchup and treats the EARLIEST
// airing as the event's true start.
const FEED_COVERED_RE = /\bUFC\b|\bPFL\b|contender series/i;
const MMA_RE = /\bMMA\b|cage|one championship/i;

// Two honest buckets, since these listings carry no promotion metadata:
// anything that reads as mixed martial arts, and everything else (boxing,
// bare-knuckle) — enough for the card's label without pretending to know
// more than the listing says.
const orgFromText = (text) => (MMA_RE.test(text) ? "MMA" : "Boxing");

export async function fetchUkLiveFightListings() {
  const rows = await ukFightRowsOnce();
  return rows
    .filter((r) => r.isLive && !FEED_COVERED_RE.test(`${r.title} ${r.subShort}`))
    .map((r) => ({
      channel: r.channel,
      market: "UK",
      airTimeUTC: r.airTimeUTC,
      series: r.title.replace(/^Live[:\s]+/i, "").trim(),
      matchup: r.subShort,
      // Full blurb: promotion cards often name the headline bout only here
      // ("...headlined by A v B for the ... title"), with the short line
      // carrying just the event's name ("One Fight Night 46").
      description: r.subAll,
      org: orgFromText(`${r.title} ${r.subShort}`),
    }));
}

export async function fetchNaLiveFightListings() {
  const out = [];
  for (const st of TVP_STATIONS) {
    try {
      for (const { attrs, airTimeUTC } of await tvpListingsFor(st.path)) {
        if (attrs.live !== "1") continue;
        const showText = `${attrs.showType ?? ""} ${attrs.showName ?? ""} ${attrs.episodeTitle ?? ""}`;
        if (!FIGHT_TITLE_RE.test(showText) || FEED_COVERED_RE.test(showText)) continue;
        out.push({
          channel: st.channel,
          market: st.market,
          airTimeUTC,
          series: attrs.showName ?? "Fight Night",
          matchup: attrs.episodeTitle ?? "",
          description: attrs.description ?? "",
          org: orgFromText(showText),
        });
      }
    } catch (err) {
      console.error(`[fight-replays] ${st.channel} live: ${err.message}`);
    }
  }
  return out;
}

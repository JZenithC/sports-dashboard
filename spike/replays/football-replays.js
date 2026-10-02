// Football replay/highlights airings across UK and North American linear
// channels — the "catch up" data source for the Football vertical, built on
// the same two EPG layers the other sports already use (spike/replays/
// tvguide.js for the UK, spike/replays/tvpassport.js for NA).
//
// This module only COLLECTS candidate airings and extracts the matchup from
// each. Deciding which tracked match an airing replays is
// correlateFootballAirings() in scripts/build-data.js, the same separation
// the MLB and fight pipelines use.
//
// Channel lists below are the ones a live sweep on 2026-08-12 found actually
// carrying the competitions this dashboard tracks. Ruled out the same day,
// with the evidence, so they don't get re-tried on a hunch:
//  - GolTV USA — tags a league but never any teams (every listing is
//    "Primeira Liga Soccer — " with an empty episode title), so nothing can
//    be correlated. It also carries only Portuguese/Ecuadorian/Peruvian/
//    Uruguayan leagues, none of them tracked.
//  - ESPN Deportes — no soccer matches at all, just talk shows (Fútbol
//    picante, Equipo F) plus MLB.
//  - Fox Soccer Plus — real structured soccer, but Canadian Premier League,
//    CONCACAF U-20 and the Saudi league; nothing tracked here.
//  - FS1 / FS2 — Leagues Cup only.
//  - Telemundo and NBC Universo — zero soccer listings in the sweep.
//  - **GatoTV (gatotv.com) — REMOVED 2026-08-12 after it published wrong
//    times.** It looked ideal (permissive robots, server-rendered, start AND
//    end times, broad AR/MX coverage) and supplied ~40 rows, but it renders
//    every listing in the REQUESTER'S geo-detected timezone and declares
//    that zone nowhere in the page. Treating its times as channel-country
//    local put every Argentine and Mexican row 4 hours late — it was caught
//    against a live channel lineup (a 7pm listing the lineup showed at
//    3pm). Three independent checks confirmed the visitor-zone reading:
//    TyC's Atletico Tucuman listing lands exactly on TV Passport's live
//    flag, the Estudiantes airing lands exactly on that 3pm, and an
//    Argentine and a Mexican channel show the same 19:00Z kickoff at the
//    same clock time (20:00 / 19:45 pre-show) rather than 4h/6h apart.
//    Since the zone follows the requesting IP, a CI runner would be wrong
//    differently again, and there is nothing in the page to read — so this
//    falls under the same rule tvpassport.js already states: no declared
//    zone, don't guess. Do not reinstate without a zone the page declares.
import { scrapeTvpassportListings } from "./tvpassport.js";
import { scrapeTvguideChannel } from "./tvguide.js";
import { scrapeGuiadetvChannel } from "./guiadetv.js";
import { scrapeDirectvArChannel } from "./directv-ar.js";
import { scrapeSportTvChannel } from "./sporttv-pt.js";
import { scrapeElPaisChannel } from "./elpais.js";
import { scrapeFormulaTvChannel } from "./formulatv.js";
import { scrapeTycAgenda } from "./tycsports.js";
import { scrapeSuperGuidaTvChannel } from "./superguidatv.js";
import { scrapeTvinfoChannel } from "./tvinfo.js";
import { fetchLaLigaBroadcasts } from "./laliga-api.js";
import { scrapeFutbolEnLaTv } from "./futbolenlatv.js";
import { FOOTY_ON_TV_MARKETS, scrapeFootyOnTvListings } from "./footyontv.js";
import { recordSource } from "../source-health.js";
import { noteFetched, noteParsed, noteDrop } from "../replay-diagnostics.js";

// Per-layer health, so the app can show WHICH guide broke rather than just
// "fewer rows than usual". A layer counts as ok if any channel returned —
// a couple of channels erroring is degraded, not down.
function reportLayer(id, label, group, channels, failures) {
  recordSource(id, {
    label,
    group,
    ok: failures.length < channels.length,
    channelsOk: channels.length - failures.length,
    channelsTotal: channels.length,
    error: failures.length ? failures.map((f) => `${f.channel}: ${f.message}`).join("; ") : null,
  });
}

// Replays run out to ~5 days behind on the secondary channels (Premier
// Sports re-airs Brasileirão 3-5 days later, measured), so three days of
// listings ahead is the useful horizon — beyond that an airing would be
// past the 7-day correlation window anyway.
const UK_DAYS = 3;

const TVGUK_CHANNELS = [
  { slug: "sky-sports-premier-league-hd", channel: "Sky Sports Premier League" },
  { slug: "sky-sports-football-hd", channel: "Sky Sports Football" },
  { slug: "sky-sports-main-event-hd", channel: "Sky Sports Main Event" },
  { slug: "tnt-sports-1-hd", channel: "TNT Sports 1" },
  { slug: "tnt-sports-2-hd", channel: "TNT Sports 2" },
  { slug: "tnt-sports-3-hd", channel: "TNT Sports 3" },
  { slug: "tnt-sports-4-hd", channel: "TNT Sports 4" },
  // Premier Sports carries the Brasileirão and LaLiga re-airs in the UK —
  // note the slugs need the "-hd" suffix (the bare ones 404).
  { slug: "premier-sports-1-hd", channel: "Premier Sports 1" },
  { slug: "premier-sports-2-hd", channel: "Premier Sports 2" },
];

// TV Passport is the ONLY permitted source left that reaches Argentine and
// Mexican channels with a trustworthy clock — it declares the zone it
// rendered in, which is exactly what GatoTV didn't. Every station below was
// swept individually on 2026-08-12 and kept only if it produced real soccer
// listings naming both teams; the sweep covered all 64 Latin-American-located
// stations in the 19,619-station index plus the US Spanish-language feeds.
//
// Checked and NOT kept, so they aren't re-tried: Canal 5, Las Estrellas,
// Galavisión, Azteca (7/Uno/Internacional and the five XH* Mexico City and
// border feeds) and Telefe Argentina all carry 40-70 listings a day but
// ZERO tagged soccer — TV Passport has no match detail for them. AyM Sports
// has plenty of soccer but only Liga de Expansión (Mexican second tier),
// which isn't tracked. ESPN2 US, GolTV, ESPN Deportes and Fox Soccer Plus
// were all ruled out earlier (see the header comment).
const TVP_STATIONS = [
  // beIN's whole family carries CONMEBOL — 3 through 7 each take a
  // different simultaneous Libertadores/Sudamericana tie, which is why
  // listing only the two main feeds missed most of the slate.
  { path: "bein-sport-usa/10853", channel: "beIN Sports", zone: "America/New_York" },
  { path: "bein-sport-en-espanol/10855", channel: "beIN Sports en Español", zone: "America/New_York" },
  { path: "bein-sports-3/37182", channel: "beIN Sports 3", zone: "America/New_York" },
  { path: "bein-sports-4/37183", channel: "beIN Sports 4", zone: "America/New_York" },
  { path: "bein-sports-5/37184", channel: "beIN Sports 5", zone: "America/New_York" },
  { path: "bein-sports-6/37185", channel: "beIN Sports 6", zone: "America/New_York" },
  { path: "bein-sports-7/37186", channel: "beIN Sports 7", zone: "America/New_York" },
  // The Canadian English feed is NOT a duplicate of the US one — 9 of its
  // 14 soccer airings match, but the other 5 are extra CONMEBOL ties it
  // carries alone (Deportes Tolima v Independiente del Valle, Independiente
  // Santa Fe v River Plate). Its Spanish sibling IS an exact duplicate
  // (18/18 identical to beIN en Español) and is deliberately absent.
  { path: "bein-sport-canada/13246", channel: "beIN Sports Canada", zone: "America/Toronto" },
  // Mexico — the domestic ESPN feeds, which do carry Libertadores and the
  // European friendlies/UEFA ties.
  { path: "espn-mexico-214a/35922", channel: "ESPN México", zone: "America/New_York" },
  { path: "espn2-mexico/33343", channel: "ESPN 2 México", zone: "America/New_York" },
  { path: "tudn/11145", channel: "TUDN", zone: "America/New_York" }, // Liga MX + condensed "en 60" replays
  { path: "fox-deportes/1827", channel: "Fox Deportes", zone: "America/New_York" },
  { path: "univision--eastern-feed/1305", channel: "Univision", zone: "America/New_York" },
  { path: "unimas--network-eastern/10775", channel: "UniMás", zone: "America/New_York" },
  // Argentina
  { path: "tyc-sports/4578", channel: "TyC Sports", zone: "America/New_York" }, // Liga Profesional, Copa Argentina
  { path: "cbs-sports-network-usa/3115", channel: "CBS Sports Network", zone: "America/New_York" }, // UEFA; already fetched for fights, so free here
  // The one entry here NOT justified by current listings: USA Network holds
  // the US Premier League rights, and the PL season starts 2026-08-15, so it
  // carried zero soccer on the sweep day. Included deliberately so PL
  // re-airs appear the moment the season opens — the correlation gate means
  // an empty channel can't produce a wrong row, only no rows. If it is still
  // contributing nothing a week into the season, drop it.
  { path: "usa-network--east-feed/640", channel: "USA Network", zone: "America/New_York" },
];

// Programming that looks like football on the tracked channels. Deliberately
// broad — anything that survives still has to name two teams that match a
// tracked fixture before it can appear anywhere.
const FOOTBALL_RE =
  /premier league|\bEFL\b|\bSPFL\b|la ?liga|bundesliga|serie a|ligue 1|champions league|europa league|conference league|\bUEFA\b|copa|libertadores|sudamericana|brasileir|liga mx|coppa|german cup|\bfa cup\b|carabao|scottish|f[uú]tbol|\bfootball\b|\bsoccer\b/i;

// "Football" means the other game on some of these channels, and TNT/Sky
// carry plenty of it.
// Basketball and volleyball are here for a measured reason. A Latin
// American listing is often just "A vs. B" with no competition word — which
// is exactly why these layers carry no positive football gate — so a
// basketball or volleyball fixture between two clubs parses as a football
// matchup unless the sport is named somewhere in the row. Both terms come
// from real leaked rows (Sky Sport Arena's "Italia v Germania Volley
// Maschile Test Match"), and the Spanish/Portuguese forms are included
// because the Latin sources are the ones that leak. None of these words can
// appear in a football listing.
const NOT_FOOTBALL_RE =
  /\bNFL\b|college football|fantasy football|\bAFL\b|\bNRL\b|gaelic|\bMLB\b|\bNBA\b|\bUFC\b|\bb[aá]squet|\bbasketball\b|\bbaloncesto\b|\bvolley\b|\bv[oó]ley\b|\bv[oô]lei\b|\bvoleibol\b/i;

// Archive programming, which is the real hazard here: these channels fill
// their off-hours with old matches, and a "Rangers v Celtic from the
// 2020/21 season" re-air would otherwise attach itself to a Rangers v Celtic
// played last week. Every pattern below is taken from a real listing string
// captured on 2026-08-11/12.
const ARCHIVE_RE =
  /\b(?:19|20)\d{2}\/\d{2}\b|\b(?:from|in)\s+(?:the\s+)?(?:19|20)\d{2}\b|greatest games|\bretro\b|\bclassic\b|season review|premier league years|\blegends\b|100 club|cult heroes|rivalries|football's greatest|sporting greats|\bhistoria\b|best .*goals/i;

// Condensed re-airs are still catch-up — for football they're often the ONLY
// re-air a match gets — but the row should say which it is rather than
// implying a full replay.
// Spanish and Portuguese terms matter as much as the English ones now that
// the Latin American guides are in: "Melhores Momentos" and "Resumo/Resumen"
// are what a condensed re-air is called there, and TUDN's "en 60" is a
// one-hour cut of a full match.
const HIGHLIGHTS_RE =
  /highlight|\bhlts\b|\ben\s+(?:60|30)\b|90 in 30|\bgoals\b|round[- ]?up|melhores momentos|resum[oe]n?\b|\bgols\b|compacto/i;

// Trailing context the listings append after the matchup ("in the final",
// "from 2010", "(Kick-off 5.15pm)"), and the lead-ins they prepend.
function cleanMatchupText(text) {
  return (
    (text || "")
      .replace(/^(?:action|highlights|coverage|live coverage|all the action|a chance to see)\s+(?:from|of)\s+/i, "")
      .replace(/\s*\([^)]*\)\s*/g, " ")
      // Normalise the "vs." separator BEFORE the sentence stripper below, or
      // "Fluminense vs. Independiente Rivadavia" gets cut at the full stop
      // and loses the second team entirely.
      .replace(/\bvs\.\s/gi, "vs ")
      // Second sentence onward is prose, never the matchup. The lookbehind
      // is load-bearing: it requires a real word before the full stop, so
      // abbreviated club names keep their second half ("Santos vs. Ath.
      // Paranaense", "Remo vs. Atl. Mineiro", "D. A. Coruña") instead of
      // being cut at the abbreviation's own period.
      .replace(/(?<=\w{4})\.\s+.*$/, "")
      // "at" is only ever trailing venue context here ("at Wembley Stadium",
      // "at Ninian Park") — never a separator. The one source that wrote
      // "A at B" was Fox Soccer Plus, which carries no tracked competition
      // and isn't scraped.
      .replace(/\s+(?:in|from|at)\s+(?:the\s+)?.*$/i, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// "A v B" (UK listings), "A vs. B" (TV Passport / GatoTV) and "A x B" (the
// Brazilian convention on Guia de TV) — the three forms these sources use
// between them. Returns the pair unordered-safe: callers compare as a set,
// because beIN's data-team1/data-team2 are reversed relative to their own
// episode title (verified on several listings), so side order carries no
// information.
//
// Allowing "x" as a separator is safe even though it's a common letter: a
// split has to yield exactly two halves, and correlation then requires BOTH
// halves to resolve to the same tracked match's teams. Prose that happens to
// contain a separator (ESPN Chile titles bouts of marketing copy like "PSG
// busca el bicampeonato vs. los ganadores de la Europa League") parses into
// a pair that matches nothing and is dropped.
export function parseFootballMatchup(text) {
  const cleaned = cleanMatchupText(text);
  const parts = cleaned.split(/\s+(?:vs?\.?|x)\s+/i);
  if (parts.length !== 2) return null;
  const [a, b] = parts.map((s) => s.trim());
  if (a.length < 2 || b.length < 2) return null;
  return [a, b];
}

/**
 * German listings, which append and prepend more furniture than any other
 * source here. "Fußball: 2. Bundesliga" / "Highlights XXL: KSV - STP, 2.
 * Spieltag" needs all three of these steps before a matchup survives:
 *
 *  1. Take the text after the LAST colon — the same shape El País and
 *     SuperGuidaTV use, and what strips the "Highlights XXL:" / "90in30:" /
 *     "Finale:" lead-ins.
 *  2. Cut at the first comma, which is where the round and venue context
 *     starts ("- FC St. Pauli, 2. Spieltag", "- Karlsruher SC, tipico
 *     Topspiel der Woche, 2. Spieltag").
 *  3. Drop a trailing country tag ("Aston Villa/ ENG").
 *
 * The spaced hyphen is then rewritten to a separator the shared parser
 * knows. Rewriting it HERE rather than teaching `parseFootballMatchup` about
 * dashes is deliberate: a dash is genuinely ambiguous in the UK listings,
 * and only the structured continental guides guarantee this shape. It is
 * safe on German club names because they never space their own hyphens —
 * "Rot-Weiss Essen" and "Bayer 04 Leverkusen" survive intact, the same
 * reasoning that makes SPORT TV's "AL-DIRIYAH" safe.
 */
export function parseGermanMatchup(text) {
  const raw = (text || "").trim();
  if (!raw) return null;
  const afterColon = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw;
  const beforeComma = afterColon.split(",")[0];
  const cleaned = beforeComma.replace(/\s*\/\s*[A-Z]{2,3}\s*$/, "").trim();
  return parseFootballMatchup(cleaned.replace(/\s+-\s+/, " vs "));
}

// Which market each layer's channels belong to. Every airing carries this so
// the fixture cards can say who shows a match LIVE in each country — the same
// listings that power catch-up already contain the live broadcast, so this
// costs no extra requests. The user, 2026-08-13: "it would be nice if our app
// shows which channels in Spain show any of the matches… same as channels
// from UK, US, and spanish speaking channels from america."
const MARKET_UK = "UK";
// TV Passport's index is split by language rather than left as one "US"
// bucket, because the ordering on a fixture card puts Spanish-language
// markets ahead of English-language ones — and the US Spanish feeds (TUDN,
// Univision, beIN en Español) are exactly the ones that matters for.
const MARKET_NA_EN = "US & Canada (English)";
const MARKET_NA_ES = "US & Canada (Spanish)";
const NA_SPANISH_CHANNELS = new Set([
  "beIN Sports en Español",
  "ESPN México",
  "ESPN 2 México",
  "TUDN",
  "Fox Deportes",
  "Univision",
  "UniMás",
  "TyC Sports",
]);
const MARKET_AR = "Argentina";
const MARKET_BR = "Brazil";
const MARKET_MX = "Mexico";
const MARKET_PT = "Portugal";
const MARKET_ES = "Spain";
const MARKET_IT = "Italy";
const MARKET_DE = "Germany";

// TV Passport's Mexico-labelled station pages are currently the permitted
// source for Mexican linear channels. Keep those two feeds in the Mexico
// market instead of hiding them under the broader US/Canada Spanish bucket;
// the other Spanish-language feeds are genuinely US/Canada services.
const LOCAL_MEXICO_CHANNELS = new Set(["ESPN México", "ESPN 2 México"]);

export function marketForNorthAmericanChannel(channel) {
  if (LOCAL_MEXICO_CHANNELS.has(channel)) return MARKET_MX;
  return NA_SPANISH_CHANNELS.has(channel) ? MARKET_NA_ES : MARKET_NA_EN;
}

// Accounting only — never a behaviour gate.
//
// The UK and NA layers pre-filter on FOOTBALL_RE, but the Latin and Iberian
// guides deliberately do not: a Brazilian listing is often just "Palmeiras x
// Santos" with no competition word, so demanding a football keyword there
// would throw away real matches. The cost is that those layers hand every
// non-excluded row to the parser, including telenovelas and news — and
// counting all of those as "football that failed to parse" made Globo look
// 100% broken when it is simply a general-entertainment channel. So a row
// that fails to parse is only recorded as `unparsed` if it actually looks
// like football; otherwise it was never football to begin with.
function noteUnparsed(channel, text) {
  noteDrop(channel, FOOTBALL_RE.test(text) ? "unparsed" : "notFootball");
}

export async function fetchUkFootballAirings() {
  const out = [];
  const failures = [];
  for (const ch of TVGUK_CHANNELS) {
    try {
      for (const r of await scrapeTvguideChannel({ slug: ch.slug, days: UK_DAYS })) {
        noteFetched("football-uk-tvguide", ch.channel);
        const text = `${r.title} ${r.subAll}`;
        if (!FOOTBALL_RE.test(text) || NOT_FOOTBALL_RE.test(text)) {
          noteDrop(ch.channel, "notFootball");
          continue;
        }
        const teams = parseFootballMatchup(r.subShort) ?? parseFootballMatchup(r.title);
        if (!teams) {
          noteDrop(ch.channel, "unparsed");
          continue;
        }
        noteParsed(ch.channel);
        out.push({
          channel: ch.channel,
          airTimeUTC: r.airTimeUTC,
          // tvguide publishes no duration, but the gap to the next programme
          // on the channel IS the slot length — better than a stand-in.
          endsAtUTC: r.nextStartUTC,
          teams,
          series: r.title,
          market: MARKET_UK,
          archive: ARCHIVE_RE.test(text),
          highlights: HIGHLIGHTS_RE.test(text),
        });
      }
    } catch (err) {
      // One broken channel never blanks the rest.
      console.error(`[football-replays] ${ch.channel}: ${err.message}`);
      failures.push({ channel: ch.channel, message: err.message });
    }
  }
  reportLayer("football-uk-tvguide", "UK listings (tvguide.co.uk)", "Football replays", TVGUK_CHANNELS, failures);
  return out;
}

// ---- South America: the local channels that actually re-air these ----
// Argentina and Mexico via GatoTV, Brazil via Guia de TV. Each entry below
// was confirmed to carry real matchups for tracked competitions in a live
// sweep on 2026-08-12; see each layer's module comment for why those two
// sources and not the several that were ruled out.
// Argentina, via DirecTV's guide API (spike/replays/directv-ar.js). Every
// entry swept on 2026-08-12 across all 261 channels in the lineup; kept
// only those whose titles actually name both teams. ESPN Premium was
// 15 matchups out of 15 programmes, Fox Sports 10 of 13, TNT Sports 7 of
// 16 — the three that carry a lot of football.
// Dropped as checked-and-empty: Fox Sports 3 (MLB only that day), DSports
// 4/6/7 (no matchups) and DXTV (rugby).
const DIRECTV_AR_CHANNELS = [
  { channelNum: "604", channelName: "ESPP", channel: "ESPN Premium" },
  { channelNum: "605", channelName: "FOXA", channel: "Fox Sports Argentina" },
  { channelNum: "603", channelName: "TNTS", channel: "TNT Sports Argentina" },
  { channelNum: "608", channelName: "FXS2", channel: "Fox Sports 2 Argentina" },
  { channelNum: "620", channelName: "TYCS", channel: "TyC Sports" },
  { channelNum: "621", channelName: "ESPN", channel: "ESPN Argentina" },
  { channelNum: "622", channelName: "ESP2", channel: "ESPN 2 Argentina" },
  { channelNum: "623", channelName: "ESPN3S", channel: "ESPN 3 Argentina" },
  { channelNum: "610", channelName: "DTSA", channel: "DSports" },
  { channelNum: "612", channelName: "DTS2", channel: "DSports 2" },
  { channelNum: "613", channelName: "DTS+", channel: "DSports+" },
  { channelNum: "614", channelName: "DTS3", channel: "DSports 3" },
  { channelNum: "631", channelName: "DTSR", channel: "DSports R" },
];

// Brazil. One request per channel covers eight days here, so this is by far
// the cheapest leg of the pipeline despite being the richest — Premiere
// alone listed 232 matchups on the check day.
const GUIADETV_CHANNELS = [
  { slug: "premiere-fc", channel: "Premiere" },
  { slug: "premiere-2", channel: "Premiere 2" },
  { slug: "premiere-3", channel: "Premiere 3" },
  { slug: "premiere-4", channel: "Premiere 4" },
  { slug: "premiere-5", channel: "Premiere 5" },
  { slug: "premiere-6", channel: "Premiere 6" },
  { slug: "sportv", channel: "SporTV" },
  { slug: "sportv-2", channel: "SporTV 2" },
  { slug: "sportv-3", channel: "SporTV 3" },
  { slug: "espn", channel: "ESPN Brasil" },
  { slug: "espn-2", channel: "ESPN 2 Brasil" },
  { slug: "espn-3", channel: "ESPN 3 Brasil" },
  { slug: "espn-4", channel: "ESPN 4 Brasil" },
  { slug: "globo-sp", channel: "Globo" },
  { slug: "band", channel: "Band" },
  { slug: "record-tv", channel: "Record TV" },
  { slug: "nsports", channel: "nsports" },
];

// Brazilian listings mark a videotaped (replayed) airing with a "VT - "
// prefix and a live one with "AO VIVO" — a native replay/live flag, which
// neither of the other two EPGs provides.
const VT_PREFIX_RE = /^VT\s*-\s*/i;
const AO_VIVO_RE = /^AO VIVO\b/i;
// Future programme cards add scheduling furniture before the matchup instead
// of putting it in a separate field: "Hoje a partir das 21:00 - A x B" and
// "Dia 29/08 - A x B". Keep that furniture out of team 1 or every such row
// becomes an apparently untracked matchup. These are real formats from the
// Premiere/SporTV pages, not a generic Portuguese-language guess.
const BRAZIL_SCHEDULE_LEAD_RE = /^(?:(?:hoje|amanh(?:ã|a))\s+a\s+partir\s+das?\s+\d{1,2}:\d{2}|dia\s+\d{1,2}\/\d{1,2})\s*-\s*/i;

export function cleanBrazilListingTitle(title) {
  return (title || "")
    .replace(VT_PREFIX_RE, "")
    .replace(AO_VIVO_RE, "")
    .replace(/^\s+/, "")
    .replace(BRAZIL_SCHEDULE_LEAD_RE, "")
    .replace(/^pr(?:é|e)-hora\s*:\s*/i, "")
    .trim();
}

export function isBrazilReplayListing(title) {
  return VT_PREFIX_RE.test(title || "");
}

export async function fetchSaFootballAirings() {
  const out = [];
  const guiaFailures = [];
  const dtvFailures = [];
  for (const ch of DIRECTV_AR_CHANNELS) {
    try {
      for (const r of await scrapeDirectvArChannel({ channelNum: ch.channelNum, channelName: ch.channelName, days: 3 })) {
        noteFetched("football-sa-directv-ar", ch.channel);
        const text = `${r.title} ${r.description}`;
        if (NOT_FOOTBALL_RE.test(text)) {
          noteDrop(ch.channel, "notFootball");
          continue;
        }
        // Titles sometimes carry a competition prefix before the matchup
        // ("CONMEBOL Sudamericana: La Unión vs. Aucas", "Final: Estados
        // Unidos vs. Polonia"), so the part after the last colon is tried
        // first and the whole title second.
        const teams = parseFootballMatchup(r.title.split(":").pop()) ?? parseFootballMatchup(r.title);
        if (!teams) {
          noteUnparsed(ch.channel, text);
          continue;
        }
        noteParsed(ch.channel);
        out.push({
          channel: ch.channel,
          airTimeUTC: r.airTimeUTC,
          endsAtUTC: r.endsAtUTC,
          teams,
          series: r.title,
          market: MARKET_AR,
          archive: ARCHIVE_RE.test(text),
          highlights: HIGHLIGHTS_RE.test(text),
        });
      }
    } catch (err) {
      console.error(`[football-replays] ${ch.channel}: ${err.message}`);
      dtvFailures.push({ channel: ch.channel, message: err.message });
    }
  }
  reportLayer("football-sa-directv-ar", "Argentina listings (DirecTV)", "Football replays", DIRECTV_AR_CHANNELS, dtvFailures);
  for (const ch of GUIADETV_CHANNELS) {
    try {
      for (const r of await scrapeGuiadetvChannel(ch.slug)) {
        noteFetched("football-sa-guiadetv", ch.channel);
        if (NOT_FOOTBALL_RE.test(r.title)) {
          noteDrop(ch.channel, "notFootball");
          continue;
        }
        const cleanedTitle = cleanBrazilListingTitle(r.title);
        // "Pré-Hora: A x B" is a pre-match label used by one Brazilian
        // channel. Prefer the text after its last colon, but retain the whole
        // title as a fallback for ordinary club names containing punctuation.
        const teams =
          parseFootballMatchup(cleanedTitle.includes(":") ? cleanedTitle.slice(cleanedTitle.lastIndexOf(":") + 1) : cleanedTitle) ??
          parseFootballMatchup(cleanedTitle);
        if (!teams) {
          noteUnparsed(ch.channel, `${r.title} ${r.description ?? ""}`);
          continue;
        }
        noteParsed(ch.channel);
        out.push({
          channel: ch.channel,
          airTimeUTC: r.airTimeUTC,
          endsAtUTC: r.endsAtUTC,
          teams,
          series: cleanedTitle,
          market: MARKET_BR,
          live: AO_VIVO_RE.test(r.title),
          // Guia de TV's native VT marker is reliable even when the match is
          // outside the fixture feed's tracked competitions/window. Preserve
          // it so Brazil catch-up can still expose the actual channel airing.
          brazilReplay: isBrazilReplayListing(r.title),
          archive: ARCHIVE_RE.test(`${r.title} ${r.description}`),
          highlights: HIGHLIGHTS_RE.test(`${r.title} ${r.description}`),
        });
      }
      await new Promise((res) => setTimeout(res, 350));
    } catch (err) {
      console.error(`[football-replays] ${ch.channel}: ${err.message}`);
      guiaFailures.push({ channel: ch.channel, message: err.message });
    }
  }
  reportLayer("football-sa-guiadetv", "Brazil listings (Guia de TV)", "Football replays", GUIADETV_CHANNELS, guiaFailures);
  return out;
}

// ---- Iberia: Portugal via SPORT TV's own API, Spain via El País ----
// Portugal, swept across all 8 SPORT TV channels on 2026-08-13: SPORT.TV6
// and SPORT.TV7 carried ZERO football over two days and are deliberately
// absent; the six below produced 73 parseable matchups between them, mostly
// Libertadores, Sudamericana and the UEFA qualifying rounds.
const SPORTTV_CHANNELS = [
  { channelId: 727, channel: "SPORT TV 1" },
  { channelId: 728, channel: "SPORT TV 2" },
  { channelId: 729, channel: "SPORT TV 3" },
  { channelId: 5406, channel: "SPORT TV 4" },
  { channelId: 5422, channel: "SPORT TV 5" },
  { channelId: 7133, channel: "SPORT TV+" },
];

// SPORT TV's own emission-type flag. This is the only source in the project
// where the broadcaster states which is which, so it is trusted directly
// instead of being inferred from slot length.
const PT_EMISSION = {
  DIRETO: "live",
  Recorded: "replay",
  "Long Summary": "highlights",
};

// Preview and post-match analysis shows carry the matchup in their title but
// are studio programming, not the match — the same reason UFC Countdown and
// The Verdict stay out of the fights view.
const PT_STUDIO_PREFIX_RE = /^(?:ANTEVIS[ÃA]O|RESCALDO)\s+/i;

// Liga Portugal is dropped outright, and this is a correctness guard rather
// than a scope decision. The competition isn't tracked, so these airings can
// never legitimately appear — but "VITÓRIA SC" (Guimarães) normalizes to
// "vitoria", which is EC Vitória's key in the Brasileirão, because
// normalizeTeam strips the SC suffix. The alias table cannot fix that: the
// suffix is stripped BEFORE resolveAlias runs, so a "vitoria sc" key would be
// dead code exactly like the old "atletico-mg" one. Liga Portugal is SPORT TV
// 1's main content, so leaving it in would keep a stream of Portuguese club
// names one coincidence away from attaching to a Brazilian fixture.
const PT_UNTRACKED_RE = /liga portugal/i;

// Spain. Only BeIN Sports carried tracked competitions in a full sweep of all
// 142 channels in the grid on 2026-08-13 (6 rows, five of them Supercopa de
// Europa re-airs). The rest are listed because they hold plausible rights to
// tracked competitions and cost NOTHING extra to read — one request returns
// the whole country's grid — and because the correlation gate means a channel
// carrying nothing relevant can only produce no rows, never a wrong one.
// Movistar's own channels are the real gap: Movistar Fútbol, BeIN LaLiga,
// Canal+ Liga and Futbol Replay are all listed in canales.json with zero
// programmes. movistarplus.es has its own API, but its hosts do not resolve
// from here at all, so its robots.txt could not be read — unverifiable
// permission, not a rejection on merit. Re-check if it ever resolves.
// Gol and Movistar Deportes moved to the FormulaTV list below, which carries
// them with explicit UTC offsets and real end times. A channel must never
// appear in both lists: the schedule dedupes on channel+air time, so the same
// airing arriving from two guides with a minute's drift would list twice.
const ELPAIS_CHANNELS = [
  { idCanal: 840, channel: "beIN Sports España" },
  { idCanal: 9, channel: "Teledeporte" },
  { idCanal: 672, channel: "Esport3" },
];

// Spain's real football tier, via FormulaTV. Every slug below was swept over
// three days on 2026-08-13 and kept only if it listed genuine matchups:
// Gol 21, LaLiga TV 18, DAZN LaLiga 17, Liga de Campeones 16, Vamos 10,
// Movistar Deportes 10, DAZN 1 10. Rejected as checked-and-empty the same
// day: Movistar Plus+ (38 programmes, no matchups), Deportes 2 and 3 (real
// programmes, but none naming teams), DAZN 2, and LaLiga TV Hypermotion —
// that last one has 14 matchups but it is a Segunda División channel, and
// Segunda isn't tracked, so every row would be discarded downstream anyway.
//
// Copa del Rey, LaLiga TV 2 and Fútbol Replay list nothing at all right now.
// They are kept deliberately: all three return a real channel page (HTTP 200
// with the proper title, not a 404), so they are off-air between seasons
// rather than dead slugs, and Copa del Rey is explicitly in scope. The
// correlation gate means a silent channel can only produce no rows, never a
// wrong one.
const FORMULATV_CHANNELS = [
  { slug: "gol-television", channel: "Gol" },
  { slug: "movistar-laliga", channel: "LaLiga TV" },
  { slug: "laliga-2-movistar-plus", channel: "LaLiga TV 2" },
  { slug: "dazn-laliga", channel: "DAZN LaLiga" },
  { slug: "liga-de-campeones-movistar-plus", channel: "M. Liga de Campeones" },
  { slug: "liga-de-campeones-2-movistar-plus", channel: "M. Liga de Campeones 2" },
  { slug: "liga-de-campeones-3-movistar-plus", channel: "M. Liga de Campeones 3" },
  { slug: "copa-del-rey-movistar-plus", channel: "M. Copa del Rey" },
  { slug: "vamos", channel: "Vamos" },
  { slug: "deportes-movistar-plus", channel: "Movistar Deportes" },
  { slug: "dazn-1", channel: "DAZN 1" },
  { slug: "futbol-replay", channel: "Fútbol Replay" },
];

// Both Spanish guides tag every listing with its season — "(T25/26)" for a
// split European season, "(T2026)" for a calendar-year one. That marker is
// the ONLY thing separating a live match from last season's re-run, and on
// these channels it matters more than anywhere else in the project: on the
// day this was built, all 20 of LaLiga TV's listings were (T25/26) archive,
// and on the Saturday the season opened the same channel carried both
// (T25/26) repeats and the (T26/27) live game. ARCHIVE_RE cannot catch these
// because it looks for four-digit years ("2021/22"), so without this guard a
// re-run of last season's Real Madrid - Celta would attach itself to this
// season's fixture between the same two clubs.
const SEASON_SPLIT_RE = /\(T(\d{2}\/\d{2})\)/;
const SEASON_YEAR_RE = /\(T(\d{4})\)/;

export function isStaleSeason(text, now = new Date()) {
  const year = now.getUTCFullYear();
  // European seasons run August to May, so from July onward the new one is
  // current; before that, the season that started last calendar year is.
  const startYear = now.getUTCMonth() + 1 >= 7 ? year : year - 1;
  const pad = (n) => String(n % 100).padStart(2, "0");
  const split = SEASON_SPLIT_RE.exec(text);
  if (split) return split[1] !== `${pad(startYear)}/${pad(startYear + 1)}`;
  const calendar = SEASON_YEAR_RE.exec(text);
  if (calendar) return calendar[1] !== String(year);
  return false;
}

export async function fetchIberiaFootballAirings() {
  const out = [];
  const ptFailures = [];
  const esFailures = [];
  for (const ch of SPORTTV_CHANNELS) {
    try {
      for (const r of await scrapeSportTvChannel({ channelId: ch.channelId, days: 3 })) {
        noteFetched("football-pt-sporttv", ch.channel);
        if (r.sport !== "futebol") {
          noteDrop(ch.channel, "notFootball");
          continue;
        }
        const kind = PT_EMISSION[r.emission];
        // Magazine shows, SEM TRANSMISSÃO filler, preview/analysis programmes
        // and Liga Portugal are all "not the football we track" rather than a
        // parse failure, so they share that bucket.
        if (!kind || PT_STUDIO_PREFIX_RE.test(r.title) || PT_UNTRACKED_RE.test(`${r.event} ${r.title}`)) {
          noteDrop(ch.channel, "notFootball");
          continue;
        }
        // "CRUZEIRO X FLAMENGO - OITAVOS DE FINAL 1ª MÃO" — the round follows
        // a spaced hyphen, which club names never contain (AL-DIRIYAH has no
        // spaces around its own).
        const teams = parseFootballMatchup(r.title.split(/\s+-\s+/)[0]);
        if (!teams) {
          noteUnparsed(ch.channel, `${r.title} ${r.event}`);
          continue;
        }
        noteParsed(ch.channel);
        out.push({
          channel: ch.channel,
          airTimeUTC: r.airTimeUTC,
          endsAtUTC: r.endsAtUTC,
          teams,
          series: r.event || r.title,
          market: MARKET_PT,
          live: kind === "live",
          archive: ARCHIVE_RE.test(`${r.title} ${r.event}`),
          highlights: kind === "highlights",
        });
      }
    } catch (err) {
      console.error(`[football-replays] ${ch.channel}: ${err.message}`);
      ptFailures.push({ channel: ch.channel, message: err.message });
    }
  }
  reportLayer("football-pt-sporttv", "Portugal listings (SPORT TV)", "Football replays", SPORTTV_CHANNELS, ptFailures);

  for (const ch of ELPAIS_CHANNELS) {
    try {
      for (const r of await scrapeElPaisChannel({ idCanal: ch.idCanal, days: 3 })) {
        noteFetched("football-es-elpais", ch.channel);
        const text = `${r.title} ${r.description}`;
        if (NOT_FOOTBALL_RE.test(text)) {
          noteDrop(ch.channel, "notFootball");
          continue;
        }
        // "Copa Sudamericana (T2026): Santa Fe - River Plate" — competition
        // first, matchup after the last colon, sides split by a spaced
        // hyphen. The hyphen is rewritten to "vs" rather than taught to the
        // shared parser, because a dash is a genuinely ambiguous separator in
        // the UK listings and only this source guarantees the structure.
        const after = r.title.includes(":") ? r.title.slice(r.title.lastIndexOf(":") + 1) : r.title;
        const teams = parseFootballMatchup(after.replace(/\s+-\s+/, " vs "));
        if (!teams) {
          noteUnparsed(ch.channel, text);
          continue;
        }
        noteParsed(ch.channel);
        out.push({
          channel: ch.channel,
          airTimeUTC: r.airTimeUTC,
          endsAtUTC: r.endsAtUTC,
          teams,
          series: r.title,
          market: MARKET_ES,
          archive: ARCHIVE_RE.test(text) || isStaleSeason(r.title),
          highlights: HIGHLIGHTS_RE.test(text),
        });
      }
    } catch (err) {
      console.error(`[football-replays] ${ch.channel}: ${err.message}`);
      esFailures.push({ channel: ch.channel, message: err.message });
    }
  }
  reportLayer("football-es-elpais", "Spain listings (El País)", "Football replays", ELPAIS_CHANNELS, esFailures);

  const ftvFailures = [];
  for (const ch of FORMULATV_CHANNELS) {
    try {
      for (const r of await scrapeFormulaTvChannel({ slug: ch.slug, days: 3 })) {
        noteFetched("football-es-formulatv", ch.channel);
        const text = `${r.title} ${r.matchup}`;
        if (NOT_FOOTBALL_RE.test(text)) {
          noteDrop(ch.channel, "notFootball");
          continue;
        }
        // The matchup arrives already isolated in its own field, so unlike
        // every other source there is no competition prefix to strip — only
        // the spaced hyphen to convert, exactly as for El País.
        const teams = parseFootballMatchup(r.matchup.replace(/\s+-\s+/, " vs "));
        if (!teams) {
          noteUnparsed(ch.channel, text);
          continue;
        }
        noteParsed(ch.channel);
        out.push({
          channel: ch.channel,
          airTimeUTC: r.airTimeUTC,
          endsAtUTC: r.endsAtUTC,
          teams,
          series: r.title,
          market: MARKET_ES,
          archive: ARCHIVE_RE.test(text) || isStaleSeason(r.title),
          highlights: HIGHLIGHTS_RE.test(text),
        });
      }
    } catch (err) {
      console.error(`[football-replays] ${ch.channel}: ${err.message}`);
      ftvFailures.push({ channel: ch.channel, message: err.message });
    }
  }
  reportLayer("football-es-formulatv", "Spain listings (FormulaTV)", "Football replays", FORMULATV_CHANNELS, ftvFailures);
  return out;
}

/**
 * TyC Sports' own agenda — a schedule with broadcasters rather than a
 * programme guide, so every row is a LIVE listing and none of it is catch-up.
 * Marked `live: true` for exactly that reason: correlateLiveAirings wants
 * these, correlateFootballAirings must never treat one as a re-air.
 *
 * This is the only source that surfaces TyC's own football, because TyC
 * publishes its matches with no channel label and a `tycsportsplay` class
 * instead (see spike/replays/tycsports.js).
 */
export async function fetchTycAgendaAirings() {
  const out = [];
  try {
    const rows = await scrapeTycAgenda();
    for (const r of rows) {
      noteFetched("football-ar-tycagenda", "TyC agenda");
      if (!r.channels.length) {
        // Over half the rows name no broadcaster at all (MLS, most foreign
        // leagues) — nothing to attribute, and not a parse failure.
        noteDrop("TyC agenda", "notFootball");
        continue;
      }
      noteParsed("TyC agenda");
      for (const channel of r.channels) {
        out.push({
          channel,
          airTimeUTC: r.airTimeUTC,
          endsAtUTC: null,
          teams: r.teams,
          series: r.competition,
          market: MARKET_AR,
          live: true,
        });
      }
    }
    recordSource("football-ar-tycagenda", {
      label: "Argentina schedule (TyC agenda)",
      group: "Football replays",
      ok: true,
      items: out.length,
      channelsOk: 1,
      channelsTotal: 1,
    });
  } catch (err) {
    console.error(`[football-replays] TyC agenda: ${err.message}`);
    recordSource("football-ar-tycagenda", {
      label: "Argentina schedule (TyC agenda)",
      group: "Football replays",
      ok: false,
      error: err.message,
      channelsOk: 0,
      channelsTotal: 1,
    });
  }
  return out;
}

// Italy. Channel ids come from the iptv-org site index, not guesswork — the
// URL needs a slug AND a numeric id, and a slug alone 404s. Swept live on
// 2026-08-15: Sky Sport Calcio 18 matchups, Sky Sport Football 19, Sky Sport
// Arena 19, Sky Sport Uno 13, DAZN Italia 9. Sky Sport 251-254 are the Serie
// A matchday overflow channels and listed nothing between seasons — kept for
// the same reason Copa del Rey's channel is, since Serie A opens 22 Aug and
// the correlation gate means a silent channel can only produce no rows.
const SUPERGUIDATV_CHANNELS = [
  { path: "sky-sport-calcio/sky-sport/572", channel: "Sky Sport Calcio" },
  { path: "sky-sport-football-hd/sky-sport/39", channel: "Sky Sport Football" },
  { path: "sky-sport-uno/sky-sport/37", channel: "Sky Sport Uno" },
  { path: "sky-sport-arena/sky-sport/38", channel: "Sky Sport Arena" },
  { path: "dazn/dazn/459", channel: "DAZN Italia" },
  { path: "sky-sport-251/sky-sport/584", channel: "Sky Sport 251" },
  { path: "sky-sport-252/sky-sport/585", channel: "Sky Sport 252" },
  { path: "sky-sport-253/sky-sport/586", channel: "Sky Sport 253" },
];

// Italian listings append series/episode furniture and a live marker to the
// title — "Hannover 96 - Wolfsburg... (Diretta) (St. 2026 - Ep. 4)". Stripped
// before parsing, or the matchup never survives.
const IT_NOISE_RE = /\s*\((?:Diretta|Replica|St\.[^)]*|Ep\.[^)]*|\d+[^)]*)\)\s*/gi;
const IT_LIVE_RE = /\(Diretta\)/i;

export async function fetchItalyFootballAirings() {
  const out = [];
  const failures = [];
  for (const ch of SUPERGUIDATV_CHANNELS) {
    try {
      for (const r of await scrapeSuperGuidaTvChannel({ path: ch.path, days: 3 })) {
        noteFetched("football-it-superguidatv", ch.channel);
        const text = `${r.title} ${r.category}`;
        if (NOT_FOOTBALL_RE.test(text)) {
          noteDrop(ch.channel, "notFootball");
          continue;
        }
        // "Uefa Supercup: Psg - Aston Villa" puts the competition first, the
        // same shape El País uses, so the part after the last colon is tried
        // and the spaced hyphen rewritten to a separator the parser knows.
        const cleaned = r.title.replace(IT_NOISE_RE, " ").replace(/\.{2,}/g, " ").replace(/\s+/g, " ").trim();
        const after = cleaned.includes(":") ? cleaned.slice(cleaned.lastIndexOf(":") + 1) : cleaned;
        const teams = parseFootballMatchup(after.replace(/\s+-\s+/, " vs "));
        if (!teams) {
          noteUnparsed(ch.channel, text);
          continue;
        }
        noteParsed(ch.channel);
        out.push({
          channel: ch.channel,
          airTimeUTC: r.airTimeUTC,
          endsAtUTC: r.endsAtUTC,
          teams,
          series: cleaned,
          market: MARKET_IT,
          live: IT_LIVE_RE.test(r.title),
          archive: ARCHIVE_RE.test(text) || isStaleSeason(text),
          highlights: HIGHLIGHTS_RE.test(text),
        });
      }
    } catch (err) {
      console.error(`[football-replays] ${ch.channel}: ${err.message}`);
      failures.push({ channel: ch.channel, message: err.message });
    }
  }
  reportLayer("football-it-superguidatv", "Italy listings (SuperGuidaTV)", "Football replays", SUPERGUIDATV_CHANNELS, failures);
  return out;
}

// Germany, via tvinfo.de. Four days per request, so this whole layer costs
// one fetch per channel.
//
// Swept every sports channel in tvinfo's 159-channel index before choosing
// these. Kept on real matchups:
//   - DAZN — Germany's biggest football rightsholder: Bundesliga Fri/Sun
//     plus Serie A, and already listing Coppa Italia and the Trophée des
//     Champions between seasons.
//   - Sky Fussball Bundesliga — Sky's Bundesliga feed, and the only Sky
//     sports channel tvinfo carries for Germany (Sky Sport Bundesliga 1-10
//     and Sky Sport Top Event are absent from its index entirely).
//   - Sport1 — free-to-air, carries friendlies and Bundesliga round-ups.
//   - Sky Sport Austria — a genuinely different feed, not a duplicate: it
//     had the UEFA Supercup and the Austrian Bundesliga where the German
//     channels had neither. Austria shares Germany's clock, so the same
//     zone applies.
//   - Sportdigital1+ — mostly niche rights, kept because it lists whole
//     matchups and the correlation gate means a channel carrying nothing
//     tracked can only produce no rows, never a wrong one.
// Rejected as checked-and-empty: Eurosport and Eurosport 2 (48 and 65
// programmes across four days, ZERO football — cycling, snooker and
// athletics), and DF1 (general entertainment; its only football over four
// days was the women's Supercup final).
const TVINFO_CHANNELS = [
  { slug: "dazn", channel: "DAZN Deutschland" },
  { slug: "sky-fussball-bundesliga", channel: "Sky Fussball Bundesliga" },
  { slug: "sport1", channel: "Sport1" },
  { slug: "sky-sport-austria", channel: "Sky Sport Austria" },
  { slug: "sportdigitalplus", channel: "Sportdigital1+" },
];

// These channels carry a lot that is not association football, and the
// German for it collides badly: "American Football League Europe" and
// "European Football Alliance" are gridiron, and DAZN's schedule is half
// esports. This is a local guard rather than an addition to the shared
// NOT_FOOTBALL_RE, because every term here is specific to this source.
const DE_NOT_FOOTBALL_RE =
  /american football|football alliance|\bELF\b|padel|counter-strike|fortnite|rocket league|trackmania|crossfire|\besports?\b|\bLIV Golf\b|ironman|snooker|radsport|leichtathletik|motorsport|darts|handball|basketball|eishockey|tennis|volleyball|formel\s*\d|contender series|inside the ring|\bTest Day\b|nascar|truck racing|world series|championship \d{4}|gran turismo|vuelta/i;

// Sky and DAZN mark a live broadcast with a bare "LIVE" before the colon
// ("European Football Alliance LIVE: ...", "Fußball Live - Testspiel").
const DE_LIVE_RE = /\bLIVE\b/;

// German listings tag the season bare ("Coppa Italia 26/27", "Saudi Pro
// League 26/27") where the Spanish guides parenthesise it ("(T25/26)"), and
// ARCHIVE_RE sees neither — it looks for four-digit years like "2021/22".
// Without this a re-run of last season's Serie A would attach itself to this
// season's fixture between the same two clubs, which is the exact failure
// the Spanish season guard was built for. Normalising the bare form into the
// parenthesised one reuses that guard rather than duplicating its
// rollover logic, and keeps the change off the other eight layers.
function isStaleGermanSeason(text) {
  return isStaleSeason((text || "").replace(/\b(\d{2}\/\d{2})\b/, "(T$1)"));
}

export async function fetchGermanyFootballAirings() {
  const out = [];
  const failures = [];
  for (const ch of TVINFO_CHANNELS) {
    try {
      for (const r of await scrapeTvinfoChannel({ slug: ch.slug, days: 4 })) {
        noteFetched("football-de-tvinfo", ch.channel);
        const text = `${r.title} ${r.subtitle}`;
        if (NOT_FOOTBALL_RE.test(text) || DE_NOT_FOOTBALL_RE.test(text)) {
          noteDrop(ch.channel, "notFootball");
          continue;
        }
        // tvinfo runs the same two opposite layouts GatoTV does: Sky puts
        // the competition in the title ("Fußball: 2. Bundesliga") and the
        // matchup in the subtitle, while a one-off event inverts it. Both
        // fields are tried, or a title-only probe under-reports badly.
        const teams = parseGermanMatchup(r.subtitle) ?? parseGermanMatchup(r.title);
        if (!teams) {
          noteUnparsed(ch.channel, text);
          continue;
        }
        noteParsed(ch.channel);
        out.push({
          channel: ch.channel,
          airTimeUTC: r.airTimeUTC,
          endsAtUTC: r.endsAtUTC,
          teams,
          series: `${r.title}${r.subtitle ? ` — ${r.subtitle}` : ""}`,
          market: MARKET_DE,
          live: DE_LIVE_RE.test(text),
          archive: ARCHIVE_RE.test(text) || isStaleGermanSeason(text),
          highlights: HIGHLIGHTS_RE.test(text),
        });
      }
    } catch (err) {
      console.error(`[football-replays] ${ch.channel}: ${err.message}`);
      failures.push({ channel: ch.channel, message: err.message });
    }
  }
  reportLayer("football-de-tvinfo", "Germany listings (tvinfo)", "Football replays", TVINFO_CHANNELS, failures);
  return out;
}

/**
 * LaLiga's own API — the official Spanish broadcaster for every La Liga
 * fixture, not just the ones inside a TV guide's 3-day horizon.
 *
 * Emitted as live airings pinned to the kickoff itself, so they land in the
 * Spain market group and REPLACE the static "DAZN, Movistar Plus+"
 * rightsholder pair with the actual channel. Marked live for the same reason
 * the TyC agenda is: this is a schedule, never a re-air.
 */
export async function fetchLaLigaBroadcastAirings() {
  const out = [];
  try {
    for (const m of await fetchLaLigaBroadcasts()) {
      noteFetched("football-es-laliga-api", "LaLiga API");
      if (!m.channels.length) {
        noteDrop("LaLiga API", "notFootball"); // fixture published before its broadcaster was assigned
        continue;
      }
      noteParsed("LaLiga API");
      for (const channel of m.channels) {
        out.push({
          channel,
          airTimeUTC: m.kickoffUTC,
          endsAtUTC: null,
          teams: m.teams,
          series: "LaLiga EA Sports",
          market: MARKET_ES,
          live: true,
        });
      }
    }
    recordSource("football-es-laliga-api", {
      label: "Spain broadcasters (LaLiga API)",
      group: "Football replays",
      ok: true,
      items: out.length,
      channelsOk: 1,
      channelsTotal: 1,
    });
  } catch (err) {
    console.error(`[football-replays] LaLiga API: ${err.message}`);
    recordSource("football-es-laliga-api", {
      label: "Spain broadcasters (LaLiga API)",
      group: "Football replays",
      ok: false,
      error: err.message,
      channelsOk: 0,
      channelsTotal: 1,
    });
  }
  return out;
}

// Spanish channels for every competition, via futbolenlatv.es. One request
// per competition, covering past and future rather than a guide's 3 days.
//
// La Liga is deliberately absent: LaLiga's own API is authoritative for it,
// and listing both would put two spellings of the same channel on one card.
const FUTBOLENLATV_COMPETITIONS = [
  "copa-libertadores",
  "copa-sudamericana",
  "brasileirao",
  "liga-argentina",
  "liga-mexico",
  "premier-league",
  "bundesliga",
  "calcio-serie-a",
  "ligue-1",
  "liga-campeones",
  "europa-league",
  "copa-del-rey",
];

// Channel labels carry the operator's own dial numbers and a watch-now call
// to action — "M+ Liga de Campeones (M60 O115)", "DAZN (Ver en directo)",
// "Movistar Plus+ (M7): VER PARTIDO". None of that is the channel's name.
function cleanSpanishChannel(name) {
  return (name || "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*:\s*VER PARTIDO\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchSpanishMatchChannels() {
  const out = [];
  const failures = [];
  for (const slug of FUTBOLENLATV_COMPETITIONS) {
    try {
      for (const m of await scrapeFutbolEnLaTv(slug)) {
        noteFetched("football-es-futbolenlatv", "futbolenlatv");
        const channels = [...new Set(m.channels.map(cleanSpanishChannel).filter(Boolean))];
        if (!channels.length) {
          noteDrop("futbolenlatv", "notFootball");
          continue;
        }
        noteParsed("futbolenlatv");
        for (const channel of channels) {
          out.push({
            channel,
            airTimeUTC: m.kickoffUTC,
            endsAtUTC: null,
            teams: m.teams,
            series: m.round,
            market: MARKET_ES,
            live: true, // a schedule, never a re-air
          });
        }
      }
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      console.error(`[football-replays] futbolenlatv ${slug}: ${err.message}`);
      failures.push({ channel: slug, message: err.message });
    }
  }
  reportLayer(
    "football-es-futbolenlatv",
    "Spain per-match channels (futbolenlatv)",
    "Football replays",
    FUTBOLENLATV_COMPETITIONS.map((c) => ({ channel: c })),
    failures
  );
  return out;
}

// FootyOnTV is a match-level live schedule across the local markets that the
// existing EPG layers only partially reach. It is intentionally kept
// separate from the replay collectors: the site lists where a match airs,
// not later re-runs, so these rows enrich live market groups only.
export async function fetchFootyOnTvAirings() {
  const out = [];
  const failures = [];
  for (const market of FOOTY_ON_TV_MARKETS) {
    try {
      const rows = await scrapeFootyOnTvListings({ markets: [market], days: 2 });
      for (const row of rows) {
        noteFetched("football-global-footyontv", market.label);
        noteParsed(market.label);
        out.push({
          channel: row.channel,
          airTimeUTC: row.kickoffUTC,
          endsAtUTC: null,
          teams: row.teams,
          series: row.competition || "FootyOnTV listing",
          market: market.label,
          live: true,
        });
      }
    } catch (err) {
      console.error(`[football-replays] FootyOnTV ${market.label}: ${err.message}`);
      failures.push({ channel: market.label, message: err.message });
    }
  }
  reportLayer("football-global-footyontv", "Live listings (FootyOnTV)", "Football replays", FOOTY_ON_TV_MARKETS, failures);
  return out;
}

export async function fetchNaFootballAirings() {
  const out = [];
  const failures = [];
  for (const st of TVP_STATIONS) {
    try {
      for (const { attrs, airTimeUTC } of await scrapeTvpassportListings({ path: st.path })) {
        noteFetched("football-na-tvpassport", st.channel);
        const text = `${attrs.showType ?? ""} ${attrs.showName ?? ""} ${attrs.episodeTitle ?? ""}`;
        if (!FOOTBALL_RE.test(text) || NOT_FOOTBALL_RE.test(text)) {
          noteDrop(st.channel, "notFootball");
          continue;
        }
        // Structured team attributes exist on full-match listings; condensed
        // shows ("Liga MX en 60", "90 in 30") carry the matchup only in the
        // episode title, so both paths are needed.
        // Structured team attributes when present; otherwise the episode
        // title, trying the part after the last colon first — beIN prefixes
        // its condensed re-airs with the competition ("Copa Libertadores
        // 2026: Fluminense vs Independiente Rivadavia"), which otherwise
        // ends up glued onto the first team's name and matches nothing.
        const teams =
          attrs.team1 && attrs.team2
            ? [attrs.team1, attrs.team2]
            : (parseFootballMatchup((attrs.episodeTitle ?? "").split(":").pop()) ??
              parseFootballMatchup(attrs.episodeTitle ?? ""));
        if (!teams) {
          noteDrop(st.channel, "unparsed");
          continue;
        }
        noteParsed(st.channel);
        out.push({
          channel: st.channel,
          airTimeUTC,
          endsAtUTC: attrs.duration
            ? new Date(Date.parse(airTimeUTC) + Number(attrs.duration) * 60000).toISOString()
            : null,
          teams,
          series: attrs.showName ?? "",
          market: marketForNorthAmericanChannel(st.channel),
          // data-live is the one TV Passport flag proven reliable (see
          // tvpassport.js) — a live broadcast is not a catch-up item.
          live: attrs.live === "1",
          archive: ARCHIVE_RE.test(text),
          highlights: HIGHLIGHTS_RE.test(text),
        });
      }
    } catch (err) {
      console.error(`[football-replays] ${st.channel}: ${err.message}`);
      failures.push({ channel: st.channel, message: err.message });
    }
  }
  reportLayer("football-na-tvpassport", "US listings (TV Passport)", "Football replays", TVP_STATIONS, failures);
  return out;
}

// MMA schedules via ESPN's public site API — the fights counterpart to
// statsapi.mlb.com: free, unauthenticated, single authoritative JSON source
// for events, bouts, and US broadcast names. Serves both leagues the
// dashboard tracks (UFC incl. Dana White's Contender Series, and PFL —
// both added at the user's request 2026-08-12). Validated live (2026-08-11/12,
// see the Fights section of CLAUDE.md):
//  - `?dates=YYYYMMDD-YYYYMMDD` range queries work for past and future, on
//    both league codes (mma/ufc and mma/pfl).
//  - Bouts arrive in ascending billing order with the MAIN EVENT LAST —
//    cross-checked on completed cards of both leagues (the event name
//    carries the last bout's surnames, e.g. "PFL Charlotte: Battle vs.
//    Rosta" -> last bout Rosta vs Battle).
//  - Bout start times cluster into 2-3 waves (prelims / main card); the
//    LATEST distinct wave held the headliners on the completed cards
//    checked, so mainCardUTC = latest wave, and the event's own `date` is
//    the overall start.
//  - `broadcasts` reflects the real 2026 US carriers and differs by league
//    (UFC/DWCS: Paramount+; PFL: ESPN + ESPN+ — PFL stayed on ESPN when
//    UFC left) — always trusted from the feed, never hardcoded.
//  - Imagery (added 2026-08-12): the response carries `leagues[].logos[]`
//    (org marks) and a per-athlete `flag.href` (country flag). Both URLs
//    are taken FROM the feed — guessed CDN paths like
//    /i/leaguelogos/mma/500/ufc.png 404, while the feed's
//    /i/teamlogos/leagues/500/ufc.png resolves. There are NO fighter
//    headshots in this endpoint (athlete objects carry only fullName,
//    displayName, shortName, flag, accolades), so cards use flags, not
//    faces.
const API_BASE = "https://site.api.espn.com/apis/site/v2/sports/mma";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

function yyyymmdd(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

async function fetchEspnMmaEvents(league, org, { pastDays, futureDays }) {
  const now = Date.now();
  const range = `${yyyymmdd(new Date(now - pastDays * 86400000))}-${yyyymmdd(new Date(now + futureDays * 86400000))}`;
  const res = await fetch(`${API_BASE}/${league}/scoreboard?dates=${range}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // Org mark, straight from the feed's own league entry.
  const logos = data.leagues?.[0]?.logos ?? [];
  const orgLogoUrl = (logos.find((l) => (l.rel ?? []).includes("default")) ?? logos[0])?.href ?? null;

  const events = [];
  for (const e of data.events ?? []) {
    const comps = e.competitions ?? [];
    if (!comps.length) continue;

    const venue = comps[0].venue ?? null;
    const bouts = comps.map((c) => ({
      fighters: (c.competitors ?? []).map((x) => x.athlete?.displayName).filter(Boolean),
      // Country flags, aligned index-for-index with `fighters`. ESPN serves
      // a `blank.png` placeholder for fighters with no known nationality —
      // dropped to null so the card falls back to a monogram badge rather
      // than rendering an empty rectangle.
      flags: (c.competitors ?? []).map((x) => {
        const href = x.athlete?.flag?.href ?? null;
        return href && !/\/blank\.\w+$/i.test(href) ? href : null;
      }),
      weightClass: c.type?.abbreviation ?? null,
      waveUTC: c.date ?? null,
    }));

    // Latest distinct bout wave = main card start; only meaningful when the
    // card actually has more than one wave.
    const waves = [...new Set(bouts.map((b) => b.waveUTC).filter(Boolean))].sort();
    const mainCardUTC = waves.length > 1 ? waves[waves.length - 1] : null;

    const broadcasts = [...new Set(comps.flatMap((c) => (c.broadcasts ?? []).flatMap((b) => b.names ?? [])))];

    events.push({
      org,
      espnId: e.id,
      name: e.name, // "UFC 330: Makhachev vs. Machado Garry" / "PFL Tampa: Cyborg vs. Vieira" / "Dana White's Contender Series: ..."
      dateUTC: e.date,
      mainCardUTC,
      venue: venue?.fullName ?? null,
      city: venue?.address?.city ?? null,
      country: venue?.address?.country ?? null,
      mainEventFighters: bouts[bouts.length - 1]?.fighters ?? [],
      mainEventFlagUrls: bouts[bouts.length - 1]?.flags ?? [],
      // Full card, headline last (ESPN's own billing order), so the UI can
      // show what else is on rather than the main event alone.
      bouts: bouts
        .filter((b) => b.fighters.length === 2)
        .map((b) => ({ a: b.fighters[0], b: b.fighters[1], weightClass: b.weightClass })),
      orgLogoUrl,
      boutCount: bouts.length,
      broadcasts,
    });
  }
  return events;
}

/** UFC events, Contender Series included (in scope since 2026-08-12). */
export function fetchUfcEvents({ pastDays = 14, futureDays = 30 } = {}) {
  return fetchEspnMmaEvents("ufc", "UFC", { pastDays, futureDays });
}

/** PFL events — same feed family, validated to share the UFC data shape. */
export function fetchPflEvents({ pastDays = 14, futureDays = 30 } = {}) {
  return fetchEspnMmaEvents("pfl", "PFL", { pastDays, futureDays });
}

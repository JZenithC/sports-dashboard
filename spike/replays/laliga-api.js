// LaLiga's own public API — the official, per-match Spanish broadcaster.
//
// This is the best Spanish source in the project and it replaces a fallback
// rather than adding to one: before this, any La Liga match more than two
// days out showed the static rightsholder pair ("DAZN, Movistar Plus+")
// because FormulaTV's horizon is today + 2. This publishes the real channel
// for every fixture of the season, and lists things no third-party guide
// carries — "DAZN EN ABIERTO" (the free-to-air match) and "Orange Fútbol 1".
//
// Permission:
//  - www.laliga.com's robots has `Allow: /en-ES/` and `Disallow: /en-*/*`.
//    Those patterns are the SAME LENGTH, so they are equally specific, and
//    RFC 9309 resolves an equally-specific conflict in favour of the least
//    restrictive rule — the /en-ES/ page is allowed. (`/es-ES/` genuinely is
//    not: it is absent from the Allow list.)
//  - apim.laliga.com returns 403 for /robots.txt. A 4xx is a SERVED response
//    meaning "no robots file", which RFC 9309 treats as no restrictions —
//    materially different from the unreachable hosts this project refuses to
//    touch (Orange's EPG, Movistar), where nothing answers at all and the
//    policy is therefore unknown.
//
// **The subscription key is read from the page at runtime, never committed.**
// It is a public client key shipped to every visitor in the calendar page's
// __NEXT_DATA__, not a credential — but reading it live means we always use
// the current one and no key sits in this repo.
//
// **`date` carries an explicit +00:00 offset**, so there is no timezone
// inference whatsoever. Corroborated against our own fixtures anyway: Sevilla
// v Rayo at 19:30Z and Espanyol v Levante at 17:00Z both match to the minute.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";
const CALENDAR_URL = "https://www.laliga.com/en-ES/laliga-easports/calendar";

let configPromise = null;

async function apiConfig() {
  configPromise ??= (async () => {
    const res = await fetch(CALENDAR_URL, { headers: { "User-Agent": UA, Accept: "text/html" } });
    if (!res.ok) throw new Error(`calendar page HTTP ${res.status}`);
    const html = await res.text();
    const base = /"backendUrl":"([^"]+)"/.exec(html)?.[1];
    const key = /"backendSubscription":"([^"]+)"/.exec(html)?.[1];
    if (!base || !key) throw new Error("could not read backendUrl/backendSubscription from the calendar page");
    return { base, key };
  })();
  return configPromise;
}

async function api(path, params = {}) {
  const { base, key } = await apiConfig();
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("subscription-key", key);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json();
}

/**
 * Every LaLiga fixture in the current and next gameweeks, with the channels
 * showing it in Spain.
 *
 * Returns { kickoffUTC, teams: [home, away], channels: [names] }. A gameweek
 * is about a week, so current + next comfortably covers this dashboard's
 * 7-day forward window; `countryCode` is what makes the API attach channels
 * at all, and without it the field comes back empty.
 */
export async function fetchLaLigaBroadcasts({ countryCode = "ES", extraWeeks = 2 } = {}) {
  const subs = await api("/api/v1/subscriptions", { limit: 100 });
  const list = subs.subscriptions ?? [];
  // Pick the current LALIGA EA SPORTS season rather than hardcoding a slug,
  // so this needs no maintenance when the season rolls over.
  const season = list
    .filter((s) => /LALIGA EA SPORTS/i.test(s.name ?? ""))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0];
  if (!season) throw new Error("no LALIGA EA SPORTS subscription found");
  const current = Number(season.current_gameweek?.week ?? season.current_gameweek?.name ?? 1) || 1;

  const out = [];
  const seen = new Set();
  for (let week = current; week < current + extraWeeks; week++) {
    let payload;
    try {
      payload = await api("/api/v1/matches", {
        subscriptionSlug: season.slug,
        week,
        limit: 100,
        orderField: "date",
        orderType: "asc",
        contentLanguage: "en",
        countryCode,
      });
    } catch {
      continue; // a gameweek past the end of the season simply has nothing
    }
    for (const m of payload.matches ?? []) {
      if (!m.date || !m.home_team?.nickname || !m.away_team?.nickname) continue;
      const key = `${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kickoffUTC: new Date(m.date).toISOString(),
        teams: [m.home_team.nickname, m.away_team.nickname],
        channels: (m.channels ?? []).map((c) => c.name).filter(Boolean),
      });
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return out;
}

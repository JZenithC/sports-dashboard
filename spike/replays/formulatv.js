// FormulaTV's per-channel TV guide (formulatv.com) — the layer that finally
// reaches Spain's actual football tier: LaLiga TV, DAZN LaLiga, Movistar's
// Liga de Campeones channels, Copa del Rey, Vamos and Gol.
//
// This is the source El País could not be. Its grid lists Movistar Fútbol,
// BeIN LaLiga, Canal+ Liga and Futbol Replay with ZERO programmes, so Spain
// was stuck with beIN Sports alone; and the two obvious alternatives are both
// unusable on permission rather than merit — movistarplus.es (and its
// ottcache.dof6.com API) does not resolve from here at all, and Orange TV's
// epg host closes the connection on /robots.txt while happily serving 1.3MB
// of programme JSON.
//
// Why this source is safe to build on:
//  - robots.txt disallows only /admin/, /admin-n/, /buscar/ and /1007950/,
//    with no AI-agent directives anywhere in the file; /programacion/ — the
//    only path used here — is allowed. (Read in full: tvguia.es looked fine
//    until its ClaudeBot block turned up further down.)
//  - Every channel page embeds a schema.org JSON-LD array, so this is a
//    machine-readable data contract, not presentation markup that reshuffles
//    on a redesign — the same reason Sherdog's microdata was trusted.
//  - **`startDate`/`endDate` carry an explicit UTC offset** ("+02:00"), so
//    there is no timezone inference. Corroborated twice against our own
//    fixture data anyway: DAZN LaLiga lists Alavés - Getafe at 19:00+02:00
//    (17:00Z) against a 17:30Z kickoff, and LaLiga TV lists Sevilla - Rayo at
//    21:24+02:00 (19:24Z) against a 19:30Z kickoff — both the live broadcast
//    opening just before kick-off.
//  - `description` is the bare matchup ("Villarreal - At. Madrid") while
//    `name` carries the competition and season, so the two never have to be
//    untangled from one string.
//
// One broadcast day per request, reachable ~2 days ahead (a third day
// 404s), which is why the caller asks for three.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";
const BASE = "https://www.formulatv.com/programacion";
const ZONE = "Europe/Madrid";

const pageCache = new Map();

function madridDate(dayOffset) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(Date.now() + dayOffset * 86400000));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function fetchDay(slug, dayOffset) {
  // Today lives at the bare channel URL and 404s under its own date — only
  // future days take the dated path. Getting this wrong 404s every day-0
  // fetch and silently empties the whole layer.
  const url = dayOffset === 0 ? `${BASE}/${slug}/` : `${BASE}/${slug}/${madridDate(dayOffset)}/`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const block = /<script type="application\/ld\+json">(\[[\s\S]*?\])<\/script>/.exec(html);
  if (!block) return []; // a channel that is simply off-air today, not a failure
  try {
    const json = JSON.parse(block[1]);
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

/** Listings for one FormulaTV channel across `days` consecutive Madrid days. */
export async function scrapeFormulaTvChannel({ slug, days = 3 }) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < days; i++) {
    const key = `${slug}|${i}`;
    if (!pageCache.has(key)) pageCache.set(key, fetchDay(slug, i));
    for (const e of await pageCache.get(key)) {
      if (!e?.startDate || !e.name) continue;
      const airTimeUTC = new Date(e.startDate).toISOString();
      const dedupe = `${airTimeUTC}|${e.name}`;
      if (seen.has(dedupe)) continue; // a broadcast day spills into the next date's page
      seen.add(dedupe);
      out.push({
        airTimeUTC,
        endsAtUTC: e.endDate ? new Date(e.endDate).toISOString() : null,
        // The name is prefixed with the listing's own start time
        // ("06:00 - LALIGA EA SPORTS (T25/26): ..."), which is noise here.
        title: String(e.name).replace(/^\d{1,2}:\d{2}\s*-\s*/, ""),
        matchup: e.description ?? "",
      });
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  out.sort((a, b) => Date.parse(a.airTimeUTC) - Date.parse(b.airTimeUTC));
  return out;
}

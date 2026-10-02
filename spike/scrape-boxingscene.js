// Boxing schedule via BoxingScene (boxingscene.com/schedule) — validated
// live 2026-08-11 (see the Fights section of CLAUDE.md): robots.txt is
// permissive with no AI-agent blocks and /schedule allowed.
//
// The page is a Next.js React-server-component stream, and the flight
// payload (`self.__next_f.push([1,"..."])` chunks) embeds a full structured
// `"event":{...}` JSON object for every card — id, slug, name,
// event_date/event_time/event_timezone, venue {name, region_display_name},
// networks [{name, time?, timezone?}], and the fight list. This module
// extracts those objects with a string-aware brace matcher and never
// touches the presentation markup at all — the earlier markup-anchored
// approach died on RSC serialization details; the data objects are the
// stable contract (they're the props the site's own components render
// from).
//
// Scope filter: events with no `networks` entry are skipped by design
// (broadcast-listed cards only, per CLAUDE.md).
//
// Time zone note: the site stamps `event_timezone: "EST"` year-round (a
// 9 PM August card is really EDT) — its convention is US-Eastern *wall
// time*, so suffixes map to IANA zones and convert DST-aware; a missing or
// unmapped suffix falls back to Eastern, the site's house convention.

// The bare /schedule page is a curated top-10 — the per-network pages
// (discovered 2026-08-12: /schedule/dazn, /schedule/skysports, ...) carry
// additional cards the curated page omits, so every page is fetched and
// merged by slug. A page 404ing (network dropped, page renamed) just
// contributes nothing that run. Known honest limitation, verified live:
// BoxingScene tracks marquee cards, not everything televised — a Zuffa
// Boxing card airing on Sky Sports the same day was absent from ALL of its
// pages, and no better permitted structured source exists (ESPN has no
// boxing API at all — 404 at the sport root; BoxRec and Tapology block
// scraping; Sky/DAZN pages are blocked or JS-only).
const SCHEDULE_PAGES = [
  "/schedule",
  "/schedule/dazn",
  "/schedule/skysports",
  "/schedule/tntsports",
  "/schedule/proboxtv",
  "/schedule/espn",
  "/schedule/amazon",
  "/schedule/tiktok-live",
  "/schedule/wynn-records-network",
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

const ZONE_BY_SUFFIX = {
  ET: "America/New_York", EST: "America/New_York", EDT: "America/New_York",
  CT: "America/Chicago", CST: "America/Chicago", CDT: "America/Chicago",
  MT: "America/Denver", MST: "America/Denver", MDT: "America/Denver",
  PT: "America/Los_Angeles", PST: "America/Los_Angeles", PDT: "America/Los_Angeles",
  GMT: "Europe/London", BST: "Europe/London",
};

function zonedTimeToUTC(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset", hour: "2-digit", hour12: false }).formatToParts(
    guess
  );
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(parts.find((p) => p.type === "timeZoneName")?.value ?? "");
  const offsetMinutes = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(guess.getTime() - offsetMinutes * 60000);
}

function decodeFlight(html) {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => m[1]);
  let decoded = "";
  for (const c of chunks) {
    try {
      decoded += JSON.parse(`"${c}"`);
    } catch {
      /* non-string chunk — skip */
    }
  }
  return decoded;
}

// JSON object starting at s[start] === "{", tracked through nested braces
// and string literals.
function matchJsonObject(s, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// Titles come as "A vs. B" or "A-B" ("Amanda Serrano-Lucrecia Manzur").
// The dash form only splits when both halves look like full names, so a
// hyphenated surname inside a "vs" title ("Chris Billam-Smith vs X") can
// never be cut in half. An unsplittable title just yields one entry —
// replay correlation then simply never matches it, which is the safe
// direction.
function splitFighters(title) {
  if (/\s+vs\.?\s+/i.test(title)) return title.split(/\s+vs\.?\s+/i).map((s) => s.trim()).filter(Boolean);
  const dash = title.split(/\s*[-—]\s*/).map((s) => s.trim()).filter(Boolean);
  if (dash.length === 2 && dash.every((p) => p.split(/\s+/).length >= 2)) return dash;
  return [title];
}

export async function fetchBoxingEvents() {
  const events = [];
  const seen = new Set();
  let anyPageOk = false;
  for (const page of SCHEDULE_PAGES) {
    try {
      const res = await fetch(`https://www.boxingscene.com${page}`, { headers: { "User-Agent": UA, Accept: "text/html" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      anyPageOk = true;
      collectEvents(decodeFlight(await res.text()), events, seen);
    } catch (err) {
      console.error(`[boxingscene] ${page}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  if (!anyPageOk) throw new Error("every schedule page failed");
  return events;
}

function collectEvents(decoded, events, seen) {
  const re = /"event":\{/g;
  let m;
  while ((m = re.exec(decoded))) {
    const raw = matchJsonObject(decoded, m.index + '"event":'.length);
    if (!raw) continue;
    let o;
    try {
      o = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!o?.slug || !o?.name || !o?.event_date || seen.has(o.slug)) continue;
    const networks = (o.networks ?? []).map((n) => n?.name).filter(Boolean);
    if (!networks.length) continue; // no listed broadcast -> out of scope by design
    seen.add(o.slug);

    let dateUTC = null;
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(o.event_date);
    const t = /^(\d{2}):(\d{2})/.exec(o.event_time ?? "");
    if (d && t) {
      const zone = ZONE_BY_SUFFIX[o.event_timezone] ?? "America/New_York";
      dateUTC = zonedTimeToUTC(Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2]), zone).toISOString();
    }

    events.push({
      org: "Boxing",
      slug: o.slug,
      name: o.name,
      dateUTC, // null when the site lists a date but no time — never guessed
      dateOnly: o.event_date,
      venue: o.venue?.name ?? null,
      city: o.venue?.region_display_name ?? null,
      // Official event poster — the card's graphic identity. The 300x225
      // thumbnail is used rather than the full-size art to keep the
      // self-hosted logo cache small; `attribution` is the promoter/network
      // the site credits (DAZN, MVP, ...) and rides along for the alt text.
      posterUrl: o.image?.thumbnail_300x225_url ?? o.image?.image_url ?? null,
      posterAttribution: o.image?.attribution ?? null,
      mainEventFighters: splitFighters(o.name),
      // The site's own bout list for the card. Worth carrying: a night of
      // boxing is several fights, and without this the dashboard shows only
      // the headline — which looks like missing fights when you compare it
      // against a source that lists every bout.
      bouts: (o.fights ?? [])
        .filter((f) => f?.fighter1_name && f?.fighter2_name)
        .map((f) => ({ a: f.fighter1_name, b: f.fighter2_name })),
      broadcasts: [...new Set(networks)],
    });
  }
}

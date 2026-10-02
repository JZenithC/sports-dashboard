// El País's TV grid (programacion-tv.elpais.com) — the Spanish leg of
// football catch-up.
//
// Why this source:
//  - It serves no robots.txt at all (the request 404s), so nothing is
//    disallowed. Checked directly rather than assumed.
//  - It is plain JSON, published one file per calendar day, and **that one
//    file carries every channel** — so a day costs exactly one request no
//    matter how many channels are listed here. That makes it by far the
//    cheapest source in the project despite the payload being ~2.3MB.
//  - Found via the iptv-org/epg repo's site index, the same way DirecTV
//    Argentina was.
//
// **Times are Europe/Madrid wall time with no offset in the payload**, which
// is exactly the shape that got GatoTV removed — so it was verified against a
// known kickoff instead of assumed. Santa Fe v River Plate (CONMEBOL
// Sudamericana) kicks off 2026-08-13T00:30:00Z in our own fixture data, and
// this grid lists it live on BeIN Sports at "2026-08-13 02:20:00": 02:20 in
// Madrid is 00:20 UTC, i.e. the broadcast starting ten minutes early. A
// visitor-timezone reading cannot produce that.
//
// Note what this source does NOT have. Movistar Fútbol, BeIN LaLiga, Canal+
// Liga and Futbol Replay all appear in canales.json and carry zero programmes
// in the grid — the same "listed but empty" trap GatoTV had. Counting
// channels therefore lies; only channels with real programme rows are listed
// below.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";
const BASE = "https://programacion-tv.elpais.com/data";
const ZONE = "Europe/Madrid";

// One entry per calendar day, shared by every channel — see above.
const dayCache = new Map();

function zonedTimeToUTC(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset", hour: "2-digit", hour12: false })
    .formatToParts(guess);
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(parts.find((p) => p.type === "timeZoneName")?.value ?? "");
  const offsetMinutes = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(guess.getTime() - offsetMinutes * 60000);
}

// "2026-08-13 02:20:00" in Madrid -> ISO UTC.
function parseEsTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/.exec(s ?? "");
  if (!m) return null;
  return zonedTimeToUTC(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), ZONE).toISOString();
}

function madridDate(dayOffset) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(Date.now() + dayOffset * 86400000));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("day")}${get("month")}${get("year")}`;
}

async function fetchGrid(dayOffset) {
  const res = await fetch(`${BASE}/parrilla_${madridDate(dayOffset)}.json`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const byChannel = new Map();
  for (const entry of Array.isArray(json) ? json : []) {
    byChannel.set(String(entry.idCanal), entry.programas ?? []);
  }
  return byChannel;
}

/** Listings for one Spanish channel across `days` consecutive Madrid days. */
export async function scrapeElPaisChannel({ idCanal, days = 3 }) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < days; i++) {
    if (!dayCache.has(i)) dayCache.set(i, fetchGrid(i));
    const grid = await dayCache.get(i);
    for (const p of grid.get(String(idCanal)) ?? []) {
      const airTimeUTC = parseEsTime(p.iniDate);
      if (!airTimeUTC || !p.title) continue;
      const dedupe = `${airTimeUTC}|${p.title}`;
      if (seen.has(dedupe)) continue; // day files overlap at the boundary
      seen.add(dedupe);
      out.push({
        airTimeUTC,
        endsAtUTC: parseEsTime(p.endDate),
        title: p.title,
        description: p.description ?? "",
        section: p.txtSection ?? "",
      });
    }
  }
  out.sort((a, b) => Date.parse(a.airTimeUTC) - Date.parse(b.airTimeUTC));
  return out;
}

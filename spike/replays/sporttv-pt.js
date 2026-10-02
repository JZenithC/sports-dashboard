// SPORT TV Portugal's own programme guide API — the Portuguese leg of
// football catch-up, and the most time-trustworthy source in this project.
//
// Why this source:
//  - robots.txt is `User-agent: *` disallowing only /unsupported and
//    /parcerias, with ZERO AI-agent directives; the /api/ paths used here are
//    not among them. Read in full before building on it — the FullTV lesson
//    is that AI directives often sit below the `User-agent: *` block.
//  - It is the broadcaster's own JSON API, so there is no markup to break.
//  - **`data` is an epoch-millisecond timestamp, so there is no timezone
//    inference at all** — the failure that got GatoTV removed cannot happen
//    here. Corroborated anyway rather than trusted: Cruzeiro x Flamengo is
//    listed at 2026-08-13T00:23:37Z against our own fixture kickoff of
//    00:30:00Z, i.e. the live broadcast starting six minutes early.
//  - `duracao` is a real duration in milliseconds, so end times are exact
//    rather than the stand-in the UK rows fall back to.
//  - **`tipoEmissao` is a native emission-type flag** — DIRETO (live),
//    Recorded (full replay), Long Summary (highlights), Magazine (studio
//    show), empty (SEM TRANSMISSÃO filler). No other source in this project
//    declares replay-vs-live itself; every other layer has to infer it from
//    air time and title text.
//
// The date-range parameters are the channel's own calendar day, so they are
// built in Europe/Lisbon rather than UTC — otherwise the requested window
// drifts an hour off the published schedule during Portuguese summer time.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36";
const BASE = "https://www.sporttv.pt";
const ZONE = "Europe/Lisbon";

const pageCache = new Map();

function lisbonDate(dayOffset) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(Date.now() + dayOffset * 86400000));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("day")}/${get("month")}/${get("year")}`;
}

async function fetchDay(channelId, dayOffset) {
  const from = `${lisbonDate(dayOffset)} 00:00`;
  const to = `${lisbonDate(dayOffset + 1)} 00:00`;
  const url =
    `${BASE}/api/channels/epg?dataInicio=${encodeURIComponent(from)}&dataFim=${encodeURIComponent(to)}` +
    `&tipoMedia=thumbnail&idCanal=${channelId}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", "X-Client-Platform": "web", "X-Device-Platform": "web" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

/** Listings for one SPORT TV channel across `days` consecutive Portuguese days. */
export async function scrapeSportTvChannel({ channelId, days = 3 }) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < days; i++) {
    const key = `${channelId}|${i}`;
    if (!pageCache.has(key)) pageCache.set(key, fetchDay(channelId, i));
    for (const p of await pageCache.get(key)) {
      if (!p?.data || !p.descricao) continue;
      const airTimeUTC = new Date(p.data).toISOString();
      const dedupe = `${airTimeUTC}|${p.descricao}`;
      if (seen.has(dedupe)) continue; // consecutive day windows overlap at the boundary
      seen.add(dedupe);
      out.push({
        airTimeUTC,
        endsAtUTC: p.duracao ? new Date(p.data + p.duracao).toISOString() : null,
        title: p.descricao,
        event: p?.evento?.nome ?? "",
        emission: p.tipoEmissao ?? "",
        sport: p?.modalidade?.codigo ?? "",
      });
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  out.sort((a, b) => Date.parse(a.airTimeUTC) - Date.parse(b.airTimeUTC));
  return out;
}

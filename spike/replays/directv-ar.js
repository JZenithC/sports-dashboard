// DirecTV Argentina's programme guide — the Argentine EPG layer, and the
// one that finally reaches ESPN Premium, Fox Sports Argentina, TNT Sports
// and the DirecTV Sports family with team names in the titles.
//
// Why this source, after three others failed (see football-replays.js for
// the full rejection list):
//  - robots.txt: `User-agent: *` with a specific Disallow list, and ZERO
//    AI-agent directives. The endpoint used here,
//    /guia/ChannelDetail.aspx/GetProgramming, is not among the disallowed
//    paths (those are /guia/loginBox, /guia/RecordBox.aspx?iframe,
//    /guia/RecordBoxCinema.aspx?iframe, /guia-movil/ProgramGuide/ and
//    /guia-movil/DirectTVCinema/).
//  - It's a JSON API, not markup, so there's no layout to break.
//  - **Its clock is a fixed zone, and that was verified rather than
//    assumed** — the mistake that got GatoTV removed. `startTimeString`
//    reads "8/12/2026 4:00:00 PM" for PSG v Aston Villa, and that UEFA
//    Super Cup kicked off 19:00 UTC: 16:00 in Buenos Aires. Two further
//    anchors agree (Cruzeiro v Flamengo listed 20 minutes before its 00:20
//    UTC kickoff; Fluminense v Independiente Rivadavia 5.5h after its
//    22:00 UTC one, i.e. a replay). So times are America/Argentina/
//    Buenos_Aires, independent of where the build runs.
//    Note the response's own GMTstartTime fields are NOT usable — they come
//    back as /Date(-62135578800000)/, which is .NET's DateTime.MinValue.
//
// Two request quirks, both load-bearing:
//  1. The guide endpoint needs the session cookies that /guia/guia.aspx
//     sets; without them it returns an empty payload.
//  2. Channels are addressed by ChannelNumber, NOT by ContentChannelID.
//     Passing the content id returns a valid-looking response with zero
//     programmes, which is an easy way to conclude a channel is empty when
//     it isn't (it's how ESPN and TNT Sports first looked dead).
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";
const BASE = "https://www.directv.com.ar";
const ZONE = "America/Argentina/Buenos_Aires";

let cookiePromise = null;
const pageCache = new Map();

function sessionCookie() {
  cookiePromise ??= (async () => {
    const res = await fetch(`${BASE}/guia/guia.aspx`, { headers: { "User-Agent": UA, Accept: "text/html" } });
    if (!res.ok) throw new Error(`cookie fetch HTTP ${res.status}`);
    return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  })();
  return cookiePromise;
}

function zonedTimeToUTC(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset", hour: "2-digit", hour12: false }).formatToParts(guess);
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(parts.find((p) => p.type === "timeZoneName")?.value ?? "");
  const offsetMinutes = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(guess.getTime() - offsetMinutes * 60000);
}

// "8/12/2026 4:00:00 PM" in Buenos Aires -> ISO UTC.
function parseArTime(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i.exec(s ?? "");
  if (!m) return null;
  let hour = Number(m[4]) % 12;
  if (/PM/i.test(m[7])) hour += 12;
  return zonedTimeToUTC(Number(m[3]), Number(m[1]), Number(m[2]), hour, Number(m[5]), ZONE).toISOString();
}

async function fetchDay(channelNum, channelName, dayOffset) {
  const cookie = await sessionCookie();
  // The API takes a calendar day in Argentine terms; Date.UTC handles the
  // month/year rollover when today + offset crosses a boundary.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date());
  const num = (t) => Number(parts.find((p) => p.type === t).value);
  const target = new Date(Date.UTC(num("year"), num("month") - 1, num("day") + dayOffset));

  const res = await fetch(`${BASE}/guia/ChannelDetail.aspx/GetProgramming`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/json; charset=UTF-8",
      Accept: "*/*",
      Cookie: cookie,
      Origin: BASE,
      Referer: `${BASE}/guia/ChannelDetail.aspx?id=${channelNum}`,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({
      filterParameters: {
        day: target.getUTCDate(),
        time: 0,
        minute: 0,
        month: target.getUTCMonth() + 1,
        year: target.getUTCFullYear(),
        offSetValue: 0,
        homeScreenFilter: "",
        filtersScreenFilters: [""],
        isHd: "",
        isChannelDetails: "Y",
        channelNum: String(channelNum),
        channelName,
      },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const blocks = Array.isArray(json.d) ? json.d : json.d ? [json.d] : [];
  return blocks.flatMap((b) => b.ProgramList ?? []);
}

/** Listings for one channel across `days` consecutive Argentine days. */
export async function scrapeDirectvArChannel({ channelNum, channelName, days = 3 }) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < days; i++) {
    const key = `${channelNum}|${i}`;
    if (!pageCache.has(key)) pageCache.set(key, fetchDay(channelNum, channelName, i));
    for (const p of await pageCache.get(key)) {
      const airTimeUTC = parseArTime(p.startTimeString);
      if (!airTimeUTC || !p.title) continue;
      const dedupe = `${airTimeUTC}|${p.title}`;
      if (seen.has(dedupe)) continue; // consecutive days overlap at the boundary
      seen.add(dedupe);
      out.push({
        airTimeUTC,
        endsAtUTC: parseArTime(p.endTimeString),
        title: p.title,
        description: p.description ?? "",
        category: p.categoryId ?? "",
      });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  out.sort((a, b) => Date.parse(a.airTimeUTC) - Date.parse(b.airTimeUTC));
  return out;
}

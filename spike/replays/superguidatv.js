// SuperGuidaTV (superguidatv.it) — the Italian leg, reaching Sky Sport's
// football channels and DAZN Italia.
//
// Why this source:
//  - robots.txt `User-agent: *` disallows only /wp-admin/, /tag/*,
//    /watchlists/*, /classifiche-jw/* and the /dettaglio-programma/*/BP*/ and
//    /SID*/ detail pages. The per-channel guide pages used here are open.
//  - Server-rendered, with the channel list and ids taken from the iptv-org
//    site index rather than guessed (the same route that surfaced DirecTV
//    Argentina and Orange TV).
//  - Every row carries an explicit duration, so end times are real.
//
// **Timezone verified against an independent source rather than assumed.**
// Europe/Rome was the obvious guess, and the GatoTV failure is exactly what
// happens when the obvious guess goes unchecked. The anchor: TyC's agenda
// (itself verified against our own kickoffs) lists Arsenal - Manchester City
// at 11:00 Argentina = 14:00Z, and SuperGuidaTV lists the same match at
// 16:00, which is 14:00 UTC under Europe/Rome. Two independent guides agree
// on the same instant.
//
// **Dates come from each row's own slug, not from the page's day offset.**
// A channel page is a broadcast day running ~05:00 to ~05:00, so it spills
// past midnight and a naive "this page is today" assumption puts the small
// hours on the wrong date. Each row's `data-slug` spells its date out
// ("...-domenica-16-agosto-sky-sport-calcio"), which sidesteps the rollover
// entirely — the same trap that put TyC's Copa Argentina ties three days
// early before it was caught.
import * as cheerio from "cheerio";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";
const BASE = "https://www.superguidatv.it/programmazione-canale";
const ZONE = "Europe/Rome";
const DAY_PATH = ["oggi", "domani", "dopodomani"];

const MONTHS = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

const pageCache = new Map();

function zonedTimeToUTC(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset", hour: "2-digit", hour12: false })
    .formatToParts(guess);
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(parts.find((p) => p.type === "timeZoneName")?.value ?? "");
  const offsetMinutes = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(guess.getTime() - offsetMinutes * 60000);
}

// The slug names a day and month but no year, so the year is the one that
// puts the date nearest to now — correct either side of a New Year boundary.
function yearFor(month, day) {
  const now = new Date();
  const candidates = [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1];
  return candidates.reduce((best, y) =>
    Math.abs(Date.UTC(y, month - 1, day) - now.getTime()) < Math.abs(Date.UTC(best, month - 1, day) - now.getTime()) ? y : best
  );
}

function dateFromSlug(slug) {
  const m = /-(\d{1,2})-([a-zà-ù]+)-/i.exec(slug ?? "");
  const month = m && MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const day = Number(m[1]);
  return { year: yearFor(month, day), month, day };
}

async function fetchDay(path, dayOffset) {
  const res = await fetch(`${BASE}/${DAY_PATH[dayOffset]}/guida-programmi-tv-${path}/`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());

  const rows = [];
  $("span[data-epg-type=hidden-link]").each((_, el) => {
    const $el = $(el);
    const texts = $el.find("p").map((i, p) => $(p).text().trim()).get();
    const time = texts.find((t) => /^\d{1,2}:\d{2}$/.test(t));
    // The category line always ends in a bracketed duration ("Sport (105')"),
    // which is how it is told apart from the programme title.
    const category = texts.find((t) => /\(\d+['’]\)\s*$/.test(t));
    const title = texts.find((t) => t !== time && t !== category);
    if (!time || !title) return;

    const date = dateFromSlug($el.attr("data-slug"));
    if (!date) return; // no date of its own — never guess which day it belongs to
    const [hh, mm] = time.split(":").map(Number);
    const start = zonedTimeToUTC(date.year, date.month, date.day, hh, mm, ZONE);
    const minutes = Number(/\((\d+)['’]\)/.exec(category ?? "")?.[1] ?? 0);
    rows.push({
      airTimeUTC: start.toISOString(),
      endsAtUTC: minutes ? new Date(start.getTime() + minutes * 60000).toISOString() : null,
      title,
      category: category ?? "",
    });
  });
  return rows;
}

/** Listings for one Italian channel across `days` consecutive broadcast days. */
export async function scrapeSuperGuidaTvChannel({ path, days = 3 }) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < Math.min(days, DAY_PATH.length); i++) {
    const key = `${path}|${i}`;
    if (!pageCache.has(key)) pageCache.set(key, fetchDay(path, i));
    for (const r of await pageCache.get(key)) {
      const dedupe = `${r.airTimeUTC}|${r.title}`;
      if (seen.has(dedupe)) continue; // consecutive broadcast days overlap
      seen.add(dedupe);
      out.push(r);
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  out.sort((a, b) => Date.parse(a.airTimeUTC) - Date.parse(b.airTimeUTC));
  return out;
}

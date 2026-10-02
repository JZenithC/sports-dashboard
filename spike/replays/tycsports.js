// TyC Sports' own "Agenda Deportiva" — a schedule with broadcasters, not a
// programme guide, and the only source that surfaces TyC's own football at all.
//
// Why this exists: TyC genuinely carries a lot of football, but every EPG that
// lists the channel labels its output generically ("Sportia", "Superfútbol",
// "La noche de TyC Sports") rather than by matchup, so TyC contributed nothing
// despite broadcasting plenty. This was pointed out repeatedly and was right.
//
// The reason no guide names TyC's matches is that **TyC does not publish them
// as a channel either** — on its own agenda, its matches carry no channel
// label and are instead flagged with a `tycsportsplay` CSS class (they go out
// on TyC Sports Play, the streaming product). That is scrapeable once you know
// to look for it, and it is what this module reads.
//
// Validation, all done live on 2026-08-15 before building on it:
//  - robots.txt `User-agent: *` disallows only `/*_aplicaster`, `/*_popup` and
//    `/*.jpg.html$`. This page is not among them. (The AI-crawler groups in
//    that file name vendors' crawlers, not this scraper — see the robots rule
//    in CLAUDE.md.)
//  - The page is genuinely server-rendered: 225 rows present in the HTML.
//  - **Times are Argentina local, verified rather than assumed** against two
//    of our own kickoffs: Newell's v Riestra listed 19:00 against a 22:00Z
//    kickoff, Estudiantes v Gimnasia listed 16:45 against 19:45Z. Both exact.
//
// **The page holds a WEEK, not a day, and each day block declares its own
// date** — `<div class="agenda_results" data-selectdia="20260818">`. The day
// dropdown only shows and hides those blocks client-side. Missing this is
// silently destructive rather than merely lossy: stamping every row with
// today's date put the Copa Argentina ties three days early, which would have
// attached a live broadcast to the wrong fixture. Caught because the listed
// times matched our own kickoffs to the minute but not the date.
import * as cheerio from "cheerio";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";
const URL_TODAY = "https://www.tycsports.com/agenda-deportiva-hoy.html";
const ZONE = "America/Argentina/Buenos_Aires";

let cached = null;

function zonedTimeToUTC(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset", hour: "2-digit", hour12: false })
    .formatToParts(guess);
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(parts.find((p) => p.type === "timeZoneName")?.value ?? "");
  const offsetMinutes = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(guess.getTime() - offsetMinutes * 60000);
}

function argentineDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(Date.now() + offsetDays * 86400000));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

// Day blocks are keyed "20260818" for dated days but "hoy" / "manana" for the
// first two — matching the day dropdown's own option values. Rejecting those
// two silently drops today and tomorrow, which is most of what matters.
function parseSelectDia(value) {
  const raw = (value ?? "").trim().toLowerCase();
  if (raw === "hoy") return argentineDate(0);
  if (raw === "manana" || raw === "mañana") return argentineDate(1);
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}

/**
 * The published agenda: one entry per match, with every channel listed for it.
 *
 * Returns { airTimeUTC, teams: [home, away], channels: [...], competition }.
 * `channels` can be empty — well over half the rows (MLS, most foreign
 * leagues) name no broadcaster, and those are dropped by the caller.
 */
export async function scrapeTycAgenda() {
  if (cached) return cached;
  const res = await fetch(URL_TODAY, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());

  const out = [];
  // One block per calendar day, each declaring its own date. Rows are always
  // read through their day block, so a row can never inherit another's date.
  $(".agenda_results[data-selectdia]").each((_, dayBlock) => {
    const date = parseSelectDia($(dayBlock).attr("data-selectdia"));
    if (!date) return;

    $(dayBlock)
      .find(".agenda_comp_results")
      .each((__, group) => {
        const $group = $(group);
        const competition = ($group.find(".agenda_comp_title, h2").first().text() || $group.text().split("\n")[0] || "").trim();

        $group.find(".item_agenda").each((___, row) => {
          const $row = $(row);
          const time = /(\d{1,2}):(\d{2})/.exec($row.find(".hs-item-agenda").first().text() || "");
          if (!time) return;

          // The crest images carry clean single-club names; the <h3> is the
          // "A VS B" line. Prefer the images and fall back to splitting the
          // heading, since a club whose own name contained "vs" would break
          // the split but never the alt attributes.
          const alts = $row
            .find(".text-teams-agenda img")
            .map((i, img) => ($(img).attr("alt") || "").trim())
            .get()
            .filter(Boolean);
          let teams = alts.length === 2 ? alts : null;
          if (!teams) {
            const parts = ($row.find("h3").first().text() || "").split(/\s+VS\.?\s+/i);
            if (parts.length === 2) teams = parts.map((s) => s.trim());
          }
          if (!teams || teams.some((t) => t.length < 2)) return;

          const channels = $row
            .find(".text-channels-agenda span")
            .map((i, s) => $(s).text().trim())
            .get()
            .filter(Boolean);
          // TyC's own matches carry no channel label — the class is the signal.
          if ($row.hasClass("tycsportsplay")) channels.push("TyC Sports Play");

          out.push({
            airTimeUTC: zonedTimeToUTC(date.year, date.month, date.day, Number(time[1]), Number(time[2]), ZONE).toISOString(),
            teams,
            channels,
            competition,
          });
        });
      });
  });
  cached = out;
  return out;
}

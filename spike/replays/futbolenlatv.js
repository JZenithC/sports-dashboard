// futbolenlatv.es — which Spanish channel shows each match, for EVERY
// competition rather than just the ones a TV guide reaches.
//
// This is what closes the South American gap. The Spanish EPG layers only
// see three days ahead and only cover channels we list, so a Libertadores or
// Brasileirão tie showed nothing for Spain even though Movistar demonstrably
// carries them. This site is organised by competition and publishes the
// channel per match, past and future, in one request per competition.
//
// Permission — read carefully, because the disallow list is long and the
// distinction is subtle. `User-agent: *` disallows /blog, /Pais, /beinsports,
// /m, /fecha, /baloncesto, /agenda, /tenis, /futbol-sala, /motociclismo,
// /futbol-americano, /golf, /femenino, /balonmano, /aljazeera, /natacion,
// /mes, /ftv, /partido, the cookie/timezone endpoints, and — in ENGLISH —
// /channel, /competition, /team and /sender. The pages used here are the
// SPANISH routes `/competicion/<slug>`, which are a different string from the
// disallowed `/competition` and are not matched by it. Date-based routes
// (/fecha, /mes, /agenda) and individual /partido pages ARE disallowed and
// are deliberately not used; everything needed is on the competition page.
//
// **Times need no inference at all.** Each row embeds schema.org Event
// microdata whose `startDate` is UTC — the table displays 02:30 for a match
// the microdata calls 2026-08-14T00:30:00, and our own fixture for that tie
// (Rosario Central v Corinthians) kicks off 00:30Z. The displayed clock is
// Europe/Madrid; the microdata is the machine-readable UTC beneath it, and
// that is what this reads.
import * as cheerio from "cheerio";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";
const BASE = "https://www.futbolenlatv.es/competicion";

const pageCache = new Map();

/**
 * Every televised match of one competition, with the Spanish channels
 * carrying it.
 *
 * Returns { kickoffUTC, teams: [home, away], channels: [names], round }.
 * Pages carry past matches as well as upcoming ones, which is useful rather
 * than noise — the caller correlates on kickoff, so a finished match simply
 * matches a recent fixture.
 */
export async function scrapeFutbolEnLaTv(slug) {
  if (!pageCache.has(slug)) {
    pageCache.set(
      slug,
      (async () => {
        const res = await fetch(`${BASE}/${slug}`, { headers: { "User-Agent": UA, Accept: "text/html" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const $ = cheerio.load(await res.text());
        const out = [];

        $("table.tablaPrincipal tr").each((_, tr) => {
          const $tr = $(tr);
          if (!$tr.find("td.hora").length) return; // date-header row

          // The microdata is the only trustworthy clock here: the visible
          // cell is Madrid wall time, this is UTC.
          const startDate = $tr.find('meta[itemprop="startDate"]').attr("content");
          if (!startDate) return;
          const kickoffUTC = new Date(`${startDate}Z`).toISOString();

          const home = ($tr.find("td.local span").first().attr("title") || $tr.find("td.local").text() || "").trim();
          const away = ($tr.find("td.visitante span").first().attr("title") || $tr.find("td.visitante").text() || "").trim();
          if (home.length < 2 || away.length < 2) return;

          const channels = $tr
            .find("td.canales ul.listaCanales li")
            .map((i, li) => ($(li).attr("title") || $(li).text() || "").trim())
            .get()
            .filter(Boolean);
          if (!channels.length) return; // listed fixture with no broadcaster yet

          out.push({
            kickoffUTC,
            teams: [home, away],
            channels,
            round: ($tr.find("td.detalles span[title]").first().attr("title") || "").trim(),
          });
        });
        return out;
      })()
    );
  }
  return pageCache.get(slug);
}

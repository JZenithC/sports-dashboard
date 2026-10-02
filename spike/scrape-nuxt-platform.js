import * as cheerio from "cheerio";

const SITES = {
  argentina: "https://www.futbolenvivoargentina.com/",
  mexico: "https://www.futbolenvivomexico.com/",
};

const TBC_TEXT = "canal por confirmar";

// The visible competition text in td.detalles is actually the round/phase
// label (e.g. "Fase de grupos" turned out to be the Women's Africa Cup of
// Nations, not a club competition) — unreliable for classifying matches. The
// schema.org event's `url` meta encodes a stable competition slug
// (/competicion/liga-argentina, /competicion/copa-libertadores, etc.) that's
// consistent across both sites since they share the same platform.
function competitionSlugFrom(url) {
  const match = /\/competicion\/([a-z0-9-]+)/i.exec(url || "");
  return match ? match[1] : null;
}

function parseRow($, tr) {
  const competition = $(tr).find("td.detalles span[title]").first().attr("title") || "";
  const competitionUrl = $(tr).find('meta[itemprop="url"]').attr("content");
  const competitionSlug = competitionSlugFrom(competitionUrl);
  const homeTeam = $(tr).find("td.local span[title]").first().attr("title") || "";
  const awayTeam = $(tr).find("td.visitante span[title]").first().attr("title") || "";
  const homeLogoImg = $(tr).find("td.local img").first();
  const awayLogoImg = $(tr).find("td.visitante img").first();
  const homeLogo = homeLogoImg.attr("alt-img") || homeLogoImg.attr("src") || null;
  const awayLogo = awayLogoImg.attr("alt-img") || awayLogoImg.attr("src") || null;
  const startDateMeta = $(tr).find('meta[itemprop="startDate"]').attr("content"); // ISO local datetime, no offset
  const kickoffLocal = $(tr).find("td.hora").first().text().trim();

  const channels = $(tr)
    .find("td.canales ul.listaCanales li")
    .toArray()
    .map((li) => $(li).text().trim())
    .filter((text) => text && text.toLowerCase() !== TBC_TEXT);

  const hasTbcPlaceholder = $(tr)
    .find("td.canales ul.listaCanales li")
    .toArray()
    .some((li) => $(li).text().trim().toLowerCase() === TBC_TEXT);

  return {
    competition,
    competitionSlug,
    homeTeam,
    awayTeam,
    homeLogo,
    awayLogo,
    kickoffLocal,
    startDateMeta,
    channels,
    hasTbcPlaceholder,
  };
}

export async function scrapeNuxtPlatform(country) {
  const url = SITES[country];
  if (!url) throw new Error(`unknown country: ${country}`);

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; sports-dashboard-spike/0.1)" },
  });
  if (!res.ok) throw new Error(`[${country}] HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const rows = $("tr").filter((_, tr) => $(tr).find("td.local").length > 0);
  return rows.toArray().map((tr) => ({ source: country, ...parseRow($, $(tr)) }));
}


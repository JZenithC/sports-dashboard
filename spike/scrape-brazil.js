import * as cheerio from "cheerio";

const BASE = "https://www.futebolnatv.com.br";
// The site only exposes yesterday/today/tomorrow routes — no further-forward
// pages exist, so this scraper structurally cannot see past ~2 days ahead or
// more than 1 day behind. dateOffsetDays anchors each route to a real
// calendar date (in Brazil's own timezone, since "today" near midnight can
// differ from the machine's local date) so kickoffLocal's bare time string
// can be turned into a real instant.
const ROUTES = [
  { path: "/jogos-ontem/", dateOffsetDays: -1 },
  { path: "/jogos-hoje/", dateOffsetDays: 0 },
  { path: "/jogos-amanha/", dateOffsetDays: 1 },
];

function brazilDateISO(offsetDays) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  // en-CA gives YYYY-MM-DD directly.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

function parseCard($, article) {
  const header = article.find("> div").first();
  const competition = header.find("span.font-bold").first().text().trim();
  const round = header.find("span.font-normal").first().text().trim();
  const kickoffLocal = article.find("time").first().text().trim();

  const teamSpans = article
    .find(".min-w-0.space-y-2 span.truncate.font-semibold")
    .toArray()
    .map((e) => $(e).text().trim());
  const [homeTeam, awayTeam] = teamSpans;

  const homeLogo = article.find("[id^='jogo-card-team-a-'] img").first().attr("src") || null;
  const awayLogo = article.find("[id^='jogo-card-team-b-'] img").first().attr("src") || null;

  const channels = article
    .find("span.uppercase.tracking-wide")
    .toArray()
    .map((e) => $(e).text().trim())
    .filter(Boolean);

  return { competition, round, kickoffLocal, homeTeam, awayTeam, homeLogo, awayLogo, channels };
}

export async function scrapeBrazil() {
  const results = [];
  for (const route of ROUTES) {
    const res = await fetch(BASE + route.path, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; sports-dashboard-spike/0.1)" },
    });
    if (!res.ok) {
      console.error(`[brazil] ${route.path} -> HTTP ${res.status}`);
      continue;
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const cards = $("article").filter((_, e) => {
      const c = $(e).attr("class") || "";
      return c.includes("rounded-lg") && c.includes("pt-2.5");
    });
    const dateAnchor = brazilDateISO(route.dateOffsetDays);
    cards.each((_, e) => {
      results.push({ source: route.path, dateAnchor, ...parseCard($, $(e)) });
    });
  }
  return results;
}


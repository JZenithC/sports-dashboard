// Event-level boxing schedule enrichment via Global Boxing News.
//
// BoxingScene is the broadest permitted structured source in this project,
// but it only carries the marquee cards it knows about and flattens its
// network list into one mixed-market array. Global Boxing News publishes a
// separate, server-rendered schedule with UK start times, event pages and
// explicit "Watch on" links. We use it for two things only:
//   1. add cards that BoxingScene missed when a broadcaster is named; and
//   2. attach a UK market + official service link to cards both sources share.
// The source is UK-oriented, so it is never treated as worldwide coverage.
import * as cheerio from "cheerio";

const URL = "https://globalboxingnews.co.uk/schedule";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

const MONTHS = new Map([
  ["jan", 0], ["feb", 1], ["mar", 2], ["apr", 3], ["may", 4], ["jun", 5],
  ["jul", 6], ["aug", 7], ["sep", 8], ["oct", 9], ["nov", 10], ["dec", 11],
]);

function ukWallTimeToUTC(day, monthName, hour, minute, zone) {
  const now = new Date();
  let year = now.getUTCFullYear();
  const month = MONTHS.get(monthName.slice(0, 3).toLowerCase());
  if (month == null) return null;
  // The schedule is ordered forward from today. A December page can contain
  // January cards, so choose the nearest year around the current UTC year.
  if (month < now.getUTCMonth() - 6) year++;
  if (month > now.getUTCMonth() + 6) year--;
  const guess = new Date(Date.UTC(year, month, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/London",
    timeZoneName: "longOffset",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(guess);
  const offset = /GMT([+-])(\d{2}):(\d{2})/.exec(parts.find((p) => p.type === "timeZoneName")?.value ?? "");
  const offsetMinutes = offset
    ? (offset[1] === "-" ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3]))
    : zone === "BST" ? 60 : 0;
  return new Date(guess.getTime() - offsetMinutes * 60000);
}

function splitFighters(title) {
  const parts = title.split(/\s+vs\.?\s+/i).map((s) => s.trim()).filter(Boolean);
  return parts.length === 2 && parts.every((s) => s.length >= 3) ? parts : [];
}

function broadcasterName(link) {
  const id = link.attr("data-broadcaster") ?? "";
  if (/dazn-ppv/i.test(id)) return "DAZN PPV";
  if (/dazn/i.test(id)) return "DAZN";
  const aria = link.attr("aria-label") ?? "";
  const match = /watch on\s+(.+?)(?:,|\s*\(opens)/i.exec(aria);
  if (match) return match[1].trim();
  return link.find(".WatchOn-module__vRsuJq__name").first().text().trim() || link.text().trim();
}

export async function fetchGlobalBoxingEvents() {
  const res = await fetch(URL, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const c = cheerio.load(await res.text());
  const events = [];

  c("article").each((_, el) => {
    const card = c(el);
    const titleLink = card.find("h3 a").filter((__, a) => String(c(a).attr("href") ?? "").startsWith("/events/")).first();
    if (!titleLink.length) return;
    const title = titleLink.text().replace(/\s+/g, " ").trim();
    const when = card.find("p").first().text().replace(/\s+/g, " ").trim();
    const time = /^(?:\w{3})\s+(\d{1,2})\s+(\w{3,4})\s+·\s+(\d{1,2}):(\d{2})\s+(GMT|BST)$/i.exec(when);
    const fighters = splitFighters(title);
    const marketRows = [];
    card.find("[data-broadcaster]").each((__, link) => {
      const name = broadcasterName(card.find(link));
      const url = card.find(link).attr("href") ?? null;
      if (!name) return;
      marketRows.push({ market: "UK", name, url, sourceUrl: `https://globalboxingnews.co.uk${titleLink.attr("href")}` });
    });
    const broadcasts = [...new Set(marketRows.map((row) => row.name))];
    if (!broadcasts.length || !time) return;
    const date = ukWallTimeToUTC(Number(time[1]), time[2], Number(time[3]), Number(time[4]), time[5]);
    if (!date) return;
    events.push({
      org: "Boxing",
      slug: `gbn-${titleLink.attr("href").split("/").pop()}`,
      name: title,
      dateUTC: date.toISOString(),
      dateOnly: date.toISOString().slice(0, 10),
      venue: null,
      city: card.find("p").eq(2).text().replace(/\s+/g, " ").trim() || null,
      mainEventFighters: fighters,
      bouts: [],
      broadcasts,
      broadcastMarkets: marketRows,
      broadcastSourceUrl: `https://globalboxingnews.co.uk${titleLink.attr("href")}`,
    });
  });
  return events;
}

export { splitFighters, ukWallTimeToUTC };

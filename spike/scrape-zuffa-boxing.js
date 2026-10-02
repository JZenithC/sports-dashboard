// Official country-by-country distribution for Zuffa Boxing.
//
// This is intentionally a promotion-specific source: UFC's "How To Watch
// Zuffa Boxing" page is one of the rare primary sources that publishes a
// market matrix (US, Brazil, Canada, Mexico, Europe, Asia and more). It is
// used to enrich a matching Boxing card, never to infer that every DAZN or
// Paramount+ event is available in every country.
import * as cheerio from "cheerio";

const URL = "https://www.ufc.com/news/how-to-watch-and-stream-zuffa-boxing";
const RIGHTS_URL = "https://www.ufc.com/news/paramount-announces-landmark-media-rights-deal-with-zuffa-boxing";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

function clean(s) {
  return String(s ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function extractHeadline(bodyText) {
  // UFC's article format uses the fighters' nationalities around the names;
  // keep the match conservative so an editorial sentence cannot invent a
  // card. Example: "between Ireland's Aaron McKenna and Italy's Etinosa
  // Oliha over 12 rounds".
  const m = /between\s+(?:[^']+)'s\s+([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+)*)\s+and\s+(?:[^']+)'s\s+([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+)*)\s+over\b/i.exec(bodyText);
  return m ? [clean(m[1]), clean(m[2])] : [];
}

function serviceName(item) {
  const link = item.find("a").first();
  const linked = clean(link.text());
  if (linked) return linked;
  const text = clean(item.text());
  const on = /\bon\s+(.+)$/i.exec(text);
  return clean(on?.[1] ?? "").replace(/[.\s]+$/, "");
}

function nextList(heading) {
  let list = heading.nextAll("ul").first();
  if (!list.length) list = heading.parent().nextAll("ul").first();
  return list;
}

export async function fetchZuffaBoxingBroadcasts() {
  const res = await fetch(URL, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const c = cheerio.load(await res.text());
  const body = c(".field--name-body-structured").first();
  if (!body.length) throw new Error("UFC watch article body not found");
  const eventTitle = clean(body.find("h2").first().text()).replace(/^What time does\s+/i, "").replace(/\s+start\??$/i, "");
  const fighters = extractHeadline(clean(body.text()));
  if (!eventTitle || fighters.length !== 2) throw new Error("UFC watch article has no parseable Zuffa card");

  const markets = [];
  body.find("h3, p").each((_, el) => {
    const heading = c(el);
    const region = clean(heading.text());
    const isRegionHeading = el.tagName === "h3" || (el.tagName === "p" && heading.find("strong").length === 1);
    if (!isRegionHeading || !region || /^(Main Card|Prelims):/i.test(region)) return;
    const list = nextList(heading);
    if (!list.length) return;
    list.find("li").each((__, li) => {
      const item = c(li);
      const name = serviceName(item);
      if (!name) return;
      const href = item.find("a").first().attr("href") ?? URL;
      markets.push({ market: region, name, url: href, sourceUrl: URL });
    });
  });

  const unique = new Map();
  for (const row of markets) unique.set(`${row.market}|${row.name}`, row);
  let promotionMarkets = [];
  try {
    const rights = await fetch(RIGHTS_URL, { headers: { "User-Agent": UA, Accept: "text/html" } });
    if (rights.ok) {
      const rightsText = clean(cheerio.load(await rights.text()).root().text());
      // Promotion-level rights are broader than an event-specific guide, so
      // keep them separate. The build applies them only to cards explicitly
      // identified as Zuffa Boxing by their source metadata.
      if (/United States|U\.S\./i.test(rightsText) && /Canada/i.test(rightsText) && /Latin America/i.test(rightsText)) {
        promotionMarkets = ["United States", "Canada", "Latin America"].map((market) => ({
          market,
          name: "Paramount+",
          url: "https://www.paramountplus.com/",
          sourceUrl: RIGHTS_URL,
        }));
      }
    }
  } catch {
    // The event-specific guide remains useful if the promotion announcement
    // is temporarily unavailable.
  }
  return [{
    org: "Boxing",
    promotion: "Zuffa Boxing",
    name: eventTitle,
    mainEventFighters: fighters,
    broadcastMarkets: [...unique.values()],
    promotionMarkets,
    broadcasts: [...new Set([...unique.values()].map((row) => row.name))],
    broadcastSourceUrl: URL,
  }];
}

export { extractHeadline, serviceName };

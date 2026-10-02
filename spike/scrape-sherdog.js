// MMA event schedule via Sherdog (sherdog.com/events) — the breadth source
// for every promotion the ESPN feeds don't carry. Validated live
// 2026-08-12: robots.txt is permissive (`User-agent: *` / `Allow: /`, with
// only social crawlers called out), and each row of the events table is
// marked up as schema.org microdata:
//   <tr itemscope itemtype="http://schema.org/Event">
//     <meta itemprop="startDate" content="2026-08-14T00:00:00+00:00">
//     <meta itemprop="name" content="One Championship - One Friday Fights 166">
//     <span itemprop="location">Lumpinee Boxing Stadium, Bangkok, Thailand</span>
// — a stable, machine-readable contract rather than presentation markup.
//
// Two deliberate limits, both measured rather than assumed:
//  - **No broadcast data.** Sherdog lists no channels, so these events
//    arrive with an empty broadcast list; a card only gains channels if the
//    EPG layer independently finds it airing. That's the same "show the
//    fixture, leave the channel blank" behaviour the football side has.
//  - **No start time** — every startDate is midnight UTC, i.e. a date only.
//    Cards therefore show the date with no kickoff time rather than a
//    fabricated one.
//
// Volume needs a filter, not a firehose: the page carries ~256 events
// across ~229 promotions, most of them small regional shows with no
// broadcast anywhere (Valhalla MMA at a Florida resort, Zeus Fight League,
// Jue Cheng King). MAJOR_PROMOTIONS keeps the ones with real broadcast
// footprints. UFC, PFL and the Contender Series are excluded outright
// because the ESPN feeds already supply them with bout lists and channels —
// Sherdog would only duplicate them, worse.
import * as cheerio from "cheerio";

const URL = "https://www.sherdog.com/events";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

// Matched against the promotion (the part before " - " in the event name).
const MAJOR_PROMOTIONS =
  /^(One Championship|Rizin|Bellator|Cage Warriors|KSW|BKFC|Bare Knuckle|Glory|Invicta|LFA|Legacy Fighting|ACA|Oktagon|Brave|Road to UFC|Cage Fury|CFFC|Combate|LUX|Pancrase|Deep|Shooto|RCC|Fury FC|Superior Challenge|ARES|Immaf)/i;

// Supplied by the ESPN feeds already — never take these from here.
const FEED_COVERED = /^(UFC|Professional Fighters League|PFL|Dana White)/i;

// "Fury Fighting Championship 123: Johns vs. Freeman" / "UFC 330 -
// Makhachev vs. Garry" — many events name their headline bout, but plenty
// ("One Friday Fights 166") don't, and those stay matchup-less rather than
// inventing one.
function splitHeadline(title) {
  const m = /^(.*?)[:\-–]?\s*([^:\-–]+?)\s+vs\.?\s+([^:\-–]+)$/i.exec(title.trim());
  if (!m) return { fighters: null };
  const [, , a, b] = m;
  const clean = (s) => s.trim().replace(/\s+/g, " ");
  if (!a || !b || a.length < 2 || b.length < 2) return { fighters: null };
  return { fighters: [clean(a), clean(b)] };
}

// Per-event pages carry the bout list the index page doesn't: the headline
// sits in a `.fight_card` block and the rest are `<tr itemprop="subEvent">`
// rows, each with a `<meta itemprop="name" content="A vs B">`. Two things
// come from this — undercards, and a real matchup for the many cards whose
// index title is just an event name ("One Friday Fights 166"). How full the
// card is tracks how close the event is; a page that fails or lists nothing
// simply leaves the event as the index gave it.
async function fetchEventCard(path) {
  const res = await fetch(`https://www.sherdog.com${path}`, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());

  const headline = $(".fight_card")
    .find('span[itemprop="name"]')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  const bouts = $('tr[itemprop="subEvent"] meta[itemprop="name"]')
    .map((_, el) => $(el).attr("content") ?? "")
    .get()
    .map((s) => s.split(/\s+vs\.?\s+/i).map((x) => x.trim()))
    .filter((p) => p.length === 2 && p.every((n) => n.length > 1))
    .map(([a, b]) => ({ a, b }));

  return { mainEvent: headline.length === 2 ? headline : null, bouts };
}

export async function fetchSherdogEvents({ pastDays = 14, futureDays = 30 } = {}) {
  const res = await fetch(URL, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());

  const now = Date.now();
  const events = [];
  const seen = new Set();
  $('tr[itemtype="http://schema.org/Event"]').each((_, el) => {
    const row = $(el);
    const startDate = row.find('meta[itemprop="startDate"]').attr("content");
    const fullName = row.find('meta[itemprop="name"]').attr("content") ?? "";
    const location = row.find('span[itemprop="location"]').text().trim();
    const href = row.find('a[itemprop="url"]').attr("href") ?? "";
    if (!startDate || !fullName) return;

    const t = Date.parse(startDate);
    if (Number.isNaN(t)) return;
    const days = (t - now) / 86400000;
    if (days < -pastDays || days > futureDays) return;

    const [promotion, ...rest] = fullName.split(" - ");
    if (FEED_COVERED.test(promotion) || !MAJOR_PROMOTIONS.test(promotion)) return;

    const eventTitle = rest.join(" - ").trim() || promotion;
    // Sherdog repeats the promotion in both fields ("Fury FC 123" +
    // "Fury Fighting Championship 123: Johns vs. Freeman"), so the prefix is
    // only added when the title doesn't already carry the promotion's name
    // or its event number.
    const promoWord = promotion.split(/\s+/)[0]?.toLowerCase() ?? "";
    const promoNumber = /\d+/.exec(promotion)?.[0];
    const titleCarriesPromo =
      (promoWord.length >= 3 && eventTitle.toLowerCase().includes(promoWord)) || (promoNumber && eventTitle.includes(promoNumber));
    const displayName = titleCarriesPromo ? eventTitle : `${promotion}: ${eventTitle}`;
    const slug = href || `${promotion}-${startDate.slice(0, 10)}`;
    if (seen.has(slug)) return;
    seen.add(slug);

    // Sherdog's location is "Venue, City, Region, Country" — the first part
    // is the venue, the remainder reads naturally as the place.
    const [venue = null, ...place] = location.split(",").map((s) => s.trim());

    events.push({
      org: "MMA",
      slug: `sherdog-${slug.split("/").pop()}`,
      name: displayName,
      dateUTC: null, // date-only source — never fabricate a start time
      dateOnly: startDate.slice(0, 10),
      venue,
      city: place.join(", ") || null,
      href,
      mainEventFighters: splitHeadline(eventTitle).fighters ?? [],
      broadcasts: [], // Sherdog lists none; the EPG layer may attach some
    });
  });

  // Second pass for the bout lists. One page per event, spaced out; a
  // failure is logged and skipped rather than losing the event.
  for (const e of events) {
    if (!e.href) continue;
    try {
      const { mainEvent, bouts } = await fetchEventCard(e.href);
      if (mainEvent && !e.mainEventFighters.length) e.mainEventFighters = mainEvent;
      // Drop the headline from the undercard list — build-fights.js also
      // filters by surname, but not repeating it here keeps the data honest.
      const headlineKey = e.mainEventFighters.map((f) => f.toLowerCase()).join("|");
      e.bouts = bouts.filter((b) => `${b.a}|${b.b}`.toLowerCase() !== headlineKey);
    } catch (err) {
      console.error(`[sherdog] card for ${e.name}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return events;
}

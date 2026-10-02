// Builds public/data/standings.json: league tables (scrape-standings.js) and
// knockout-cup progress (scrape-brackets.js). Kept separate from
// build-data.js/fixtures.json — different shape, different sources, and lets
// one pipeline fail without the other (see failure-handling notes in each
// scraper module).
import fs from "fs";
import { scrapeStandings } from "../spike/scrape-standings.js";
import { scrapeBrackets } from "../spike/scrape-brackets.js";
import { recordSource, writeHealth } from "../spike/source-health.js";

function readJsonSafe(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// scrapeStandings()/scrapeBrackets() already skip an individual competition
// gracefully on failure — but with no fallback, a run where ALL of them fail
// (e.g. ESPN's WAF blocking a shared CI runner IP, seen in practice) would
// silently overwrite good data with nothing. Keep the previous run's entry
// for any competition a fresh scrape didn't produce, same "one broken source
// shouldn't take down the page" principle build-data.js already follows for
// fixtures.
function mergeByCompetition(previous, fresh) {
  const byCompetition = new Map((previous ?? []).map((item) => [item.competition, item]));
  for (const item of fresh) byCompetition.set(item.competition, item); // fresh wins when available
  return [...byCompetition.values()];
}

async function main() {
  console.log("Scraping standings...");
  let freshTables = [];
  try {
    freshTables = await scrapeStandings();
    recordSource("standings-tables", { label: "League tables (ESPN)", group: "Football fixtures", ok: true, items: freshTables.length });
  } catch (err) {
    console.error(`[standings] tables failed, keeping previous: ${err.message}`);
    recordSource("standings-tables", { label: "League tables (ESPN)", group: "Football fixtures", ok: false, error: err.message });
  }
  console.log("Scraping cup brackets...");
  let freshBrackets = [];
  try {
    freshBrackets = await scrapeBrackets();
    recordSource("standings-brackets", { label: "Cup brackets (Promiedos)", group: "Football fixtures", ok: true, items: freshBrackets.length });
  } catch (err) {
    console.error(`[standings] brackets failed, keeping previous: ${err.message}`);
    recordSource("standings-brackets", { label: "Cup brackets (Promiedos)", group: "Football fixtures", ok: false, error: err.message });
  }

  const previous = readJsonSafe("public/data/standings.json");
  const tables = mergeByCompetition(previous?.tables, freshTables);
  const brackets = mergeByCompetition(previous?.brackets, freshBrackets);

  const output = { generatedAt: new Date().toISOString(), tables, brackets };

  fs.mkdirSync("public/data", { recursive: true });
  fs.writeFileSync("public/data/standings.json", JSON.stringify(output, null, 2), "utf8");
  writeHealth();
  console.log(`\nWrote public/data/standings.json (${tables.length} tables, ${brackets.length} brackets)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

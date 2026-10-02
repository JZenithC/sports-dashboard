// Regression checks for the static European-market fallback rights table.
// Live EPG rows can replace a fallback group, but they must never leave the
// fixture card with a stale market label or an obviously wrong rights bundle.
import { broadcastGroupsFor } from "./euro-broadcast.js";

const failures = [];

function groups(competition, kickoffUTC = "2026-08-29T15:00:00.000Z") {
  return new Map(broadcastGroupsFor(competition, kickoffUTC).map((g) => [g.label, g.channels]));
}

function check(description, actual, expected) {
  const got = JSON.stringify(actual);
  const want = JSON.stringify(expected);
  if (got !== want) {
    failures.push(`${description}\n  expected: ${want}\n  received: ${got}`);
    console.log(`FAIL  ${description}`);
  } else {
    console.log(`PASS  ${description}`);
  }
}

function hasMarkets(competition, markets) {
  return markets.every((market) => groups(competition).has(market));
}

check("Premier League uses the canonical US/Canada English market", hasMarkets("Premier League", ["UK", "Spain", "US & Canada (English)"]), true);
check("La Liga uses the canonical US/Canada English market", hasMarkets("La Liga", ["UK", "Spain", "US & Canada (English)"]), true);
check(
  "Bundesliga covers Germany, Spain, UK and both US language feeds",
  hasMarkets("Bundesliga", ["Germany", "Spain", "UK", "US & Canada (English)", "US & Canada (Spanish)"]),
  true
);
check("Serie A covers Italy, Spain, UK and US/Canada English", hasMarkets("Serie A", ["Italy", "Spain", "UK", "US & Canada (English)"]), true);
check("Ligue 1 covers France, Spain, UK and US/Canada English", hasMarkets("Ligue 1", ["France", "Spain", "UK", "US & Canada (English)"]), true);
check(
  "Champions League covers the tracked European, UK, Canadian and US markets",
  hasMarkets("UEFA Champions League", ["UK", "Spain", "France", "Germany", "Italy", "Portugal", "Canada", "US & Canada (English)"]),
  true
);

const friday = groups("Bundesliga", "2026-08-28T18:30:00.000Z");
const saturday = groups("Bundesliga", "2026-08-29T15:30:00.000Z");
const sunday = groups("Bundesliga", "2026-08-30T15:30:00.000Z");
check("Bundesliga Friday UK rights are BBC iPlayer and YouTube", friday.get("UK"), ["BBC iPlayer", "YouTube"]);
check("Bundesliga Saturday UK rights are Sky Sports", saturday.get("UK"), ["Sky Sports"]);
check("Bundesliga Sunday UK rights are Amazon Prime Video", sunday.get("UK"), ["Amazon Prime Video"]);
check("Bundesliga US English rights include USA Network, Fandango and Peacock", groups("Bundesliga").get("US & Canada (English)"), ["USA Network", "Fandango", "Peacock"]);
check("Bundesliga US Spanish rights include Telemundo, Universo and Peacock", groups("Bundesliga").get("US & Canada (Spanish)"), ["Telemundo", "Universo", "Peacock"]);
check("Champions League US rights use Paramount+ and DAZN", groups("UEFA Champions League").get("US & Canada (English)"), ["Paramount+", "DAZN"]);
check("Champions League UK live rights exclude the BBC highlights-only listing", groups("UEFA Champions League").get("UK"), ["HBO Max", "Amazon Prime Video"]);
check("Champions League Spain uses the Telefónica/Movistar feed", groups("UEFA Champions League").get("Spain"), ["Movistar Plus+"]);
check("Champions League Italy keeps the live Sky feed only", groups("UEFA Champions League").get("Italy"), ["Sky"]);
check("Champions League Portugal keeps the live SPORT TV feed only", groups("UEFA Champions League").get("Portugal"), ["SPORT TV"]);

for (const [competition, kickoff] of [
  ["Premier League", "2026-08-29T15:00:00.000Z"],
  ["La Liga", "2026-08-29T15:00:00.000Z"],
  ["Bundesliga", "2026-08-29T15:00:00.000Z"],
  ["Serie A", "2026-08-29T15:00:00.000Z"],
  ["Ligue 1", "2026-08-29T15:00:00.000Z"],
  ["UEFA Champions League", "2026-08-29T15:00:00.000Z"],
]) {
  check(`${competition} has no empty fallback groups`, broadcastGroupsFor(competition, kickoff).every((g) => g.channels.length > 0), true);
}

if (failures.length) {
  console.error(`\n${failures.length} European broadcast checks failed`);
  process.exitCode = 1;
} else {
  console.log("\nAll European broadcast checks passed");
}

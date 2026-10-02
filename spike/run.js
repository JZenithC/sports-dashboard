import fs from "fs";
import { scrapeBrazil } from "./scrape-brazil.js";
import { scrapeNuxtPlatform } from "./scrape-nuxt-platform.js";
import { fetchFixtures, DOMESTIC_LEAGUES, CONTINENTAL_LEAGUES } from "./fetch-fixtures.js";
import { matchScrapedToFixtures } from "./match.js";

const today = new Date();
const todayStr = today.toISOString().slice(0, 10);

function summarizeScraped(label, entries) {
  const withChannel = entries.filter((e) => e.channels.length > 0).length;
  const tbc = entries.length - withChannel;
  return { label, total: entries.length, withChannel, tbc };
}

async function main() {
  console.log("Scraping Brazil (futebolnatv.com.br)...");
  const brazil = await scrapeBrazil();

  console.log("Scraping Argentina (futbolenvivoargentina.com)...");
  const argentina = await scrapeNuxtPlatform("argentina");

  console.log("Scraping Mexico (futbolenvivomexico.com)...");
  const mexico = await scrapeNuxtPlatform("mexico");

  console.log("Fetching fixtures (TheSportsDB)...");
  let fixtures = [];
  let fixturesError = null;
  try {
    fixtures = await fetchFixtures({ days: 7 });
    if (!fixtures.length) fixturesError = "TheSportsDB returned 0 fixtures in the 7-day window.";
  } catch (err) {
    fixturesError = err.message;
  }

  const scrapedSummaries = [
    summarizeScraped("Brazil (futebolnatv.com.br)", brazil),
    summarizeScraped("Argentina (futbolenvivoargentina.com)", argentina),
    summarizeScraped("Mexico (futbolenvivomexico.com)", mexico),
  ];

  let matchSection = "";
  if (fixtures.length) {
    const perCountry = [
      { name: "Brazil", entries: brazil, country: "brazil" },
      { name: "Argentina", entries: argentina, country: "argentina" },
      { name: "Mexico", entries: mexico, country: "mexico" },
    ];
    const lines = [];
    const unmatchedSamples = [];
    for (const { name, entries, country } of perCountry) {
      let matched = 0;
      for (const entry of entries) {
        const fixture = matchScrapedToFixtures(entry, fixtures, { country, today });
        if (fixture) matched++;
        else if (unmatchedSamples.length < 15) {
          unmatchedSamples.push(`${name}: ${entry.homeTeam} vs ${entry.awayTeam} (${entry.competition})`);
        }
      }
      const rate = entries.length ? ((matched / entries.length) * 100).toFixed(1) : "0.0";
      lines.push(`- **${name}**: ${matched}/${entries.length} scraped entries matched a fixture (${rate}%)`);
    }
    matchSection = `
## Match rate (scraped channel entries → TheSportsDB fixtures)

${lines.join("\n")}

**Read this % carefully — it is not yet meaningful as a quality signal.** Scope is
deliberately Americas-only right now: ${Object.keys(DOMESTIC_LEAGUES).length} domestic
leagues/cups (${Object.keys(DOMESTIC_LEAGUES).join(", ")}) plus ${
      Object.keys(CONTINENTAL_LEAGUES).length
    } CONMEBOL club competitions (${Object.keys(CONTINENTAL_LEAGUES).join(
      ", "
    )}, filtered to fixtures involving a Brazilian/Argentine/Mexican club). Scraped sites
list dozens of other leagues we haven't wired fixtures for at all (Uruguayan league, Copa
Paulista, Leagues Cup, CONCACAF competitions, etc — out of scope for now). So a near-0% rate
here reflects **fixture-source league coverage**, not matching quality. The one real hit each
in Argentina/Mexico (the Platense vs Talleres de Córdoba match) confirms the name+time
matching logic itself works correctly when a fixture actually exists to match against — that
took a real fix during this spike: the ARG/MX platform's schema.org \`startDate\` meta has a
correct date but an unreliable time-of-day (consistently off from both the rendered page text
and TheSportsDB's independently-reported kickoff time), so the matcher now trusts the meta's
date + the rendered local time instead of the full meta timestamp.

A second real case surfaced here and is now fixed: the Copa do Brasil fixture "Athletico
Paranaense vs Vitória" pulls correctly and now links up with futebolnatv.com.br's scraped
"Athletico PR vs Vitória" — added to team-aliases.js, plus a rule change (normalizeTeam no
longer blindly strips "atletico"/"athletic", since those are often the only thing
distinguishing two real, different clubs — e.g. Atlético-MG vs Atlético-GO vs Athletico
Paranaense — so stripping them was actively causing bad matches, not just missed ones).

### Sample unmatched entries (first 15)
${unmatchedSamples.map((s) => `- ${s}`).join("\n") || "(none)"}
`;
  } else {
    matchSection = `
## Match rate

Not computed — ${fixturesError}
`;
  }

  const report = `# Discovery Spike Report — ${todayStr}

Single-day snapshot. Lead-time conclusions (how far out Brazilian PPV channels get
confirmed) need a few more runs of this script across the coming week — see spec's
build order step 1.

## Scraper results

| Source | Total entries | With a real channel | TBC / blank |
|---|---|---|---|
${scrapedSummaries.map((s) => `| ${s.label} | ${s.total} | ${s.withChannel} | ${s.tbc} |`).join("\n")}

### Notes
- **Brazil**: only \`/jogos-hoje/\` and \`/jogos-amanha/\` routes exist on futebolnatv.com.br
  (confirmed via site nav — no further-forward date routes). This scraper structurally
  cannot see beyond ~2 days ahead from this source, which may itself be evidence for the
  spec's lead-time assumption (channels aren't listed further out because they aren't
  known yet).
- **Argentina / Mexico**: confirmed same underlying platform/template (identical
  robots.txt, identical table markup). One shared scraper (\`scrape-nuxt-platform.js\`)
  handles both. Their homepage listing already spans several weeks forward (grouped into
  today/tomorrow/3-day/6-day/9-day+ buckets), covering the whole 7-day window in one fetch.
  Channel field explicitly renders "Canal por confirmar" (TBC) as a placeholder list item
  rather than leaving the cell empty — handled by treating that exact string as "no channel
  yet".
- Per robots.txt, only homepage listings were fetched on all three sites — no per-match,
  per-team, or per-date subpages (those are disallowed on the ARG/MX platform, and querying
  them wasn't needed for BR either).
${matchSection}
## Open items from the spec still unresolved by this spike
- European leagues/cups are out of scope for now (per current instructions) — will need
  re-adding to fetch-fixtures.js once the Americas-only path is fully working.
- No current Mexican domestic cup equivalent to Copa do Brasil/Copa Argentina exists
  (Copa MX was discontinued in 2018-19) — confirmed absent, not just unwired.
- Exact lead-time curve — needs re-runs on subsequent days.
- Matching engine hardening (accent/alias tables, better name normalization) — step 2 of the build order.
`;

  const outPath = `spike-report-${todayStr}.md`;
  fs.writeFileSync(outPath, report, "utf8");
  console.log(`\nReport written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

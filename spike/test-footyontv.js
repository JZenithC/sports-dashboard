// Regression tests for the FootyOnTV parser and its local-time conversion.
// Run: npm run test-footyontv
import { FOOTY_ON_TV_MARKETS, parseFootyOnTvPage } from "./replays/footyontv.js";

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

const brazil = FOOTY_ON_TV_MARKETS.find((m) => m.code === "br");
const uk = FOOTY_ON_TV_MARKETS.find((m) => m.code === "uk");

const sample = `
<main>
  <div class="flex items-start gap-0 sm:gap-4">
    <div class="hidden w-[58px] shrink-0 pt-3 sm:block"><span class="font-mono text-[13px] font-semibold tabular-nums text-ink">16:00</span></div>
    <div class="min-w-0 flex-1"><ul><li>
      <a href="/br/matches/2026-08-25/valencia-vs-real-betis/">
        <span class="truncate text-[15px] font-medium">Valencia</span>
        <span class="truncate text-[15px] font-medium">Real Betis</span>
        <span class="label text-[10px] text-slate-500">LaLiga</span>
        <span class="font-mono text-[10px] font-semibold leading-none">Disney+</span>
        <span class="font-mono text-[10px] font-semibold leading-none">YouTube - CazéTV</span>
      </a>
    </li></ul></div>
  </div>
</main>`;

const rows = parseFootyOnTvPage(sample, { market: brazil });
check("parses matchup, competition and every channel", rows[0], {
  source: "footyontv",
  market: "Brazil",
  localDate: "2026-08-25",
  kickoffUTC: "2026-08-25T19:00:00.000Z",
  teams: ["Valencia", "Real Betis"],
  competition: "LaLiga",
  channels: ["Disney+", "YouTube - CazéTV"],
});

const ukSample = sample.replace("/br/matches/", "/matches/").replace("16:00", "20:00");
const ukRows = parseFootyOnTvPage(ukSample, { market: uk });
check("converts UK summer time to UTC", ukRows[0]?.kickoffUTC, "2026-08-25T19:00:00.000Z");

if (failures) process.exit(1);

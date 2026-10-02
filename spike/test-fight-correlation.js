// Regression test for the fights replay-correlation rules
// (correlateFightAirings in scripts/build-fights.js). Airing titles here
// are REAL strings captured from CBS Sports Network / Fight Network /
// Sky Sports / TNT Sports listings on 2026-08-11 — only the event dates are
// controlled, so the matching logic is exercised exactly as production will
// see it regardless of what happens to be airing on any given build day.
//
// Run: node spike/test-fight-correlation.js  (exits non-zero on failure)
import { correlateFightAirings } from "../scripts/build-fights.js";

const T = Date.parse("2026-08-01T21:00:00Z"); // a controlled "event happened here" instant
const iso = (ms) => new Date(ms).toISOString();
const H = 3600000;
const D = 24 * H;

const ufc322 = {
  org: "UFC",
  name: "UFC 322: Della Maddalena vs. Makhachev",
  dateUTC: iso(T),
  mainEventFighters: ["Jack Della Maddalena", "Islam Makhachev"],
};
const ufc321 = { org: "UFC", name: "UFC 321: Aspinall vs. Gane", dateUTC: iso(T), mainEventFighters: ["Tom Aspinall", "Ciryl Gane"] };
const medicFn = {
  org: "UFC",
  name: "UFC Fight Night: Medić vs. Rodriguez",
  dateUTC: iso(T),
  mainEventFighters: ["Uroš Medić", "Daniel Rodriguez"],
};
const thorslund = {
  org: "Boxing",
  name: "Cherneka Johnson vs. Dina Thorslund",
  dateUTC: iso(T),
  mainEventFighters: ["Cherneka Johnson", "Dina Thorslund"],
};

const air = (title, ms, channel = "CBS Sports Network") => ({ channel, zone: "America/New_York", airTimeUTC: iso(ms), title });

const cases = [
  {
    desc: "numbered UFC airing matches its exact event",
    airing: air("UFC Reloaded UFC 322 Della Maddalena vs Makhachev", T + 2 * D),
    events: [ufc321, ufc322],
    expect: "UFC 322: Della Maddalena vs. Makhachev",
  },
  {
    desc: "numbered airing never matches a different number",
    airing: air("UFC Reloaded UFC 322 Della Maddalena vs Makhachev", T + 2 * D),
    events: [ufc321],
    expect: null,
  },
  {
    desc: "library re-air of an old number matches nothing recent",
    airing: air("UFC Reloaded Cris Cyborg v Yana Kunitskaya from UFC 222", T + 2 * D, "TNT Sports 2"),
    events: [ufc321, ufc322],
    expect: null,
  },
  {
    desc: "boxing re-air matches by both main-event surnames",
    airing: air(
      "MVP Boxing Cherneka Johnson v Dina ThorslundCherneka Johnson v Dina Thorslund. Action from the undisputed World title fight",
      T + 2 * D,
      "Sky Sports Action"
    ),
    events: [thorslund],
    expect: "Cherneka Johnson vs. Dina Thorslund",
  },
  {
    desc: "the live broadcast itself (lag < 6h) never counts as a replay",
    airing: air("Live Zuffa Boxing Cherneka Johnson v Dina Thorslund", T, "Sky Sports Action"),
    events: [thorslund],
    expect: null,
  },
  {
    desc: "diacritics in event data don't block a match on ASCII titles",
    airing: air("UFC Fight Night Medic vs Rodriguez", T + 1 * D, "Fight Network"),
    events: [medicFn],
    expect: "UFC Fight Night: Medić vs. Rodriguez",
  },
  {
    desc: "airings beyond the 14-day window never match",
    airing: air("UFC Reloaded UFC 322 Della Maddalena vs Makhachev", T + 20 * D),
    events: [ufc322],
    expect: null,
  },
  {
    desc: "preview shows airing BEFORE the event never match",
    airing: air("UFC Countdown An insight into the fighter's preparations ahead of UFC 322", T - 2 * D, "TNT Sports 2"),
    events: [ufc322],
    expect: null,
  },
  {
    desc: "one surname alone is not enough",
    airing: air("The MMA Hour with Islam Makhachev interview special", T + 2 * D, "Fight Network"),
    events: [ufc322],
    expect: null,
  },
  {
    desc: "PFL re-air matches by main-event surnames (no UFC-number path)",
    airing: air("PFL MMA Cris Cyborg vs Ketlen Vieira full event replay", T + 2 * D, "Fight Network"),
    events: [{ org: "PFL", name: "PFL Tampa: Cyborg vs. Vieira", dateUTC: iso(T), mainEventFighters: ["Cris Cyborg", "Ketlen Vieira"] }],
    expect: "PFL Tampa: Cyborg vs. Vieira",
  },
  {
    desc: "a 'Live'-titled repeat airing days later still counts as a replay (tvguide keeps the Live prefix on re-airs)",
    airing: air("Live Zuffa Boxing Cherneka Johnson v Dina Thorslund", T + 42 * H, "Sky Sports Action"),
    events: [thorslund],
    expect: "Cherneka Johnson vs. Dina Thorslund",
  },
];

let failed = 0;
for (const c of cases) {
  const matches = correlateFightAirings([c.airing], c.events);
  const got = matches[0]?.event?.name ?? null;
  const ok = got === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.desc}${ok ? "" : `\n      expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`}`);
}
if (failed) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log("\nAll correlation cases pass.");

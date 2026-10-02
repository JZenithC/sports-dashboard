import assert from "node:assert/strict";
import { buildBroadcastGroups } from "./fetch-mlb.js";
import { MLB_REPLAY_SOURCES, MLB_NATIONAL_REPLAY_SOURCES } from "./mlb-replay-sources.js";
import { parseChsnReplaysHtml } from "./replays/chsn.js";

const groups = buildBroadcastGroups(
  [
    { name: "Sportsnet", type: "TV", isNational: false, homeAway: "home" },
    { name: "TVA Sports", type: "TV", isNational: false, homeAway: "home" },
    { name: "TV Azteca", type: "TV", isNational: false, homeAway: "away" },
    { name: "SportsNet LA", type: "TV", isNational: false, homeAway: "home" },
    { name: "FS1", type: "TV", isNational: true, homeAway: "home" },
  ],
  "Los Angeles Dodgers",
  "Toronto Blue Jays"
);

assert.deepEqual(
  groups,
  [
    { label: "National", channels: ["FS1"] },
    { label: "Los Angeles Dodgers (home)", channels: ["SportsNet LA"] },
  ],
  "MLB broadcast groups must stay U.S.-only while retaining U.S. regional SportsNet feeds"
);
assert.equal(MLB_REPLAY_SOURCES[141], undefined, "Canadian Sportsnet must not enter MLB catch-up");
assert.equal(typeof MLB_REPLAY_SOURCES[145], "function", "White Sox must use the official CHSN replay source");
assert.equal(MLB_NATIONAL_REPLAY_SOURCES.length, 6, "all validated U.S. national linear channels must feed MLB catch-up");

const chsn = parseChsnReplaysHtml(`
  <table><tbody>
    <tr data-date="2026-08-26" data-league="MLB" data-content="Replay">
      <td>Wed, Aug 26</td><td>10:00 AM</td>
      <td>Chicago White Sox at Kansas City Royals - 8/25/26 (Re-Air)</td>
      <td>CHSN, CHSN+</td>
    </tr>
    <tr data-date="2026-08-26" data-league="MLB" data-content="Live">
      <td>Wed, Aug 26</td><td>6:00 PM</td>
      <td>Texas Rangers at Chicago White Sox</td><td>CHSN</td>
    </tr>
    <tr data-date="2026-08-26" data-league="MLB" data-content="Replay">
      <td>Wed, Aug 26</td><td>1:00 PM</td>
      <td>Chicago White Sox at Kansas City Royals - 8/25/26 (Re-Air)</td>
      <td>CHSN+</td>
    </tr>
  </tbody></table>
`);
assert.equal(chsn.length, 1, "CHSN parser must keep only replay rows on the linear CHSN channel");
assert.deepEqual(chsn[0].teams, ["Chicago White Sox", "Kansas City Royals"]);
assert.equal(chsn[0].airTimeUTC, "2026-08-26T15:00:00.000Z", "CHSN times must convert from Central to UTC");

console.log("MLB tests passed");

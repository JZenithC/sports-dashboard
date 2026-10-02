// Registry of replay sources — the extension point for replay-time coverage.
// Each per-team entry maps an MLB team id (see spike/mlb-teams.js) to a
// function returning that team's replay listings, in one of two shapes
// build-mlb.js understands:
//   { originalGameDateKey, channel, airTimeUTC }        — the source itself
//     names which game is being replayed (MASN's date-suffix titles)
//   { teams: [name, name], channel, zone, airTimeUTC }  — the source gives
//     matchup + air time; build-mlb.js attributes it to a game by its
//     air-window rule (a replay airs 2–72h after its game's start)
//
// Coverage philosophy is unchanged from when MASN was the only entry: every
// station here was validated live first (robots.txt, real structured
// listings, a deterministic correlation path — see spike/replays/masn.js and
// spike/replays/tvpassport.js for what was checked). A team with no entry
// simply shows no local replay info — not a placeholder, not a guess.
//
// 2026 reality check behind the team list: only a small set of clubs still air on a
// linear regional channel at all. The rest moved to team-branded ".TV"
// streaming services (Twins.TV, Rays.TV, ...) — apps, not stations, so
// there is no local linear replay to list; their games are still covered by
// the national sources below when a national network re-airs them. Chicago
// Sports Network (White Sox) is not in TV Passport's station index, so it is
// handled by a small direct scraper for CHSN's own official schedule.
import { scrapeMasnReplays } from "./replays/masn.js";
import { scrapeTvpassportReplays } from "./replays/tvpassport.js";
import { scrapeChsnReplays } from "./replays/chsn.js";

// Channel display names match the live-broadcast names MLB's own API uses
// for the same carriers (so logos and visual identity line up), and `zone`
// is the station's home-market timezone — the zone its air times are
// meaningful in.
const TVP = (path, channel, zone) => () => scrapeTvpassportReplays({ path, channel, zone });

export const MLB_REPLAY_SOURCES = {
  110: scrapeMasnReplays, // Baltimore Orioles — MASN's own guide: ~3 weeks out + explicit original-game date keys, richer than the aggregator
  111: TVP("new-england-sports-network/1015", "NESN", "America/New_York"), // Boston Red Sox
  112: TVP("marquee-sports-network/34880", "Marquee Sports Network", "America/Chicago"), // Chicago Cubs
  117: TVP("space-city-home-network/8799", "Space City Home Network", "America/Chicago"), // Houston Astros
  119: TVP("spectrum-sportsnet-la/13096", "SportsNet LA", "America/Los_Angeles"), // Los Angeles Dodgers
  121: TVP("sny-sportsnet-new-york-hd/4713", "SNY", "America/New_York"), // New York Mets
  133: TVP("nbc-sports-california/2836", "NBCSCA", "America/Los_Angeles"), // Athletics
  134: TVP("sportsnet-pittsburgh/1084", "SportsNet Pittsburgh", "America/New_York"), // Pittsburgh Pirates
  137: TVP("nbc-sports-bay-area/1117", "NBCS BA", "America/Los_Angeles"), // San Francisco Giants
  143: TVP("nbc-sports-philadelphia/6014", "NBCSP", "America/New_York"), // Philadelphia Phillies
  145: scrapeChsnReplays, // Chicago White Sox — official CHSN schedule (not in TV Passport)
  147: TVP("yes-network/1953", "YES", "America/New_York"), // New York Yankees
};

// National channels that re-air games for any team. Same listing shape;
// build-mlb.js runs these against every recent game, not one team's.
export const MLB_NATIONAL_REPLAY_SOURCES = [
  TVP("mlb-network/6178", "MLB Network", "America/New_York"),
  TVP("fox-sports-1/668", "FS1", "America/New_York"),
  TVP("tbs--east/61", "TBS", "America/New_York"),
  TVP("espn/594", "ESPN", "America/New_York"),
  TVP("fox--eastern/1229", "FOX", "America/New_York"),
  TVP("nbc-sports-network/1386", "NBCSN", "America/New_York"),
];

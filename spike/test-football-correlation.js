// Regression test for the football catch-up correlation rules
// (correlateFootballAirings in scripts/build-data.js) and the matchup
// parser that feeds it (parseFootballMatchup in
// spike/replays/football-replays.js).
//
// Every airing string below is a REAL one captured from the live sources on
// 2026-08-11/12 — Sky Sports Football, Sky Sports Premier League, Premier
// Sports 1/2, TNT Sports 1-4, beIN Sports and TUDN. That matters because a
// given build day can legitimately attribute nothing at all (in the last
// days of the European pre-season almost every UK listing is archive
// filler), so this is what proves the rules hold, not the build output.
//
// Run: npm run test-football
import { correlateFootballAirings, correlateLiveAirings } from "../scripts/build-data.js";
import {
  cleanBrazilListingTitle,
  isBrazilReplayListing,
  marketForNorthAmericanChannel,
  parseFootballMatchup,
  isStaleSeason,
  parseGermanMatchup,
} from "./replays/football-replays.js";
import { normalizeTeam } from "./match.js";

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

// ---- matchup parsing ----
check("plain 'A v B'", parseFootballMatchup("Red Bull Bragantino v Corinthians"), ["Red Bull Bragantino", "Corinthians"]);
check("Mexican ESPN feeds stay in the Mexico market", marketForNorthAmericanChannel("ESPN México"), "Mexico");
check("US Spanish feeds stay in the US/Canada Spanish market", marketForNorthAmericanChannel("Fox Deportes"), "US & Canada (Spanish)");
check("'A vs. B' (TV Passport episode titles)", parseFootballMatchup("Fluminense vs. Independiente Rivadavia"), [
  "Fluminense",
  "Independiente Rivadavia",
]);
// "at" is deliberately NOT a separator — see cleanMatchupText: on these
// sources it only ever introduces trailing venue context.
check("'at' is venue context, not a separator", parseFootballMatchup("Cardiff City v Swansea City at Ninian Park"), [
  "Cardiff City",
  "Swansea City",
]);
check("strips a kick-off note", parseFootballMatchup("Everton v Newcastle United (Kick-off 5.15pm)"), [
  "Everton",
  "Newcastle United",
]);
check("strips trailing round context", parseFootballMatchup("Hull City v Middlesbrough in the Championship play-off final"), [
  "Hull City",
  "Middlesbrough",
]);
check("strips an 'Action from' lead-in", parseFootballMatchup("Action from Bolton Wanderers v Stockport County in the League One play-off final"), [
  "Bolton Wanderers",
  "Stockport County",
]);
check("keeps a second sentence out of the matchup", parseFootballMatchup("Notts County v Salford City. Highlights of the League Two play-off final at Wembley Stadium"), [
  "Notts County",
  "Salford City",
]);
check("ampersand club names survive", parseFootballMatchup("Brighton & Hove Albion v Aston Villa"), [
  "Brighton & Hove Albion",
  "Aston Villa",
]);
// Latin American conventions.
check("Brazilian ' x ' separator (Guia de TV)", parseFootballMatchup("Palmeiras x Internacional"), ["Palmeiras", "Internacional"]);
check("GatoTV strips the city qualifier in parentheses", parseFootballMatchup("Talleres (C) vs. Lanús"), ["Talleres", "Lanús"]);
check("abbreviated club names keep their second half", parseFootballMatchup("Santos vs. Ath. Paranaense"), ["Santos", "Ath. Paranaense"]);
check("multiple abbreviations survive", parseFootballMatchup("D. A. Coruña vs. Real Madrid"), ["D. A. Coruña", "Real Madrid"]);
check(
  "Brazil guide strips a future-card time lead-in",
  parseFootballMatchup(cleanBrazilListingTitle("Hoje a partir das 21:00 - Cruzeiro x Atlético-MG")),
  ["Cruzeiro", "Atlético-MG"]
);
check(
  "Brazil guide strips a dated future-card lead-in",
  parseFootballMatchup(cleanBrazilListingTitle("Dia 29/08 - Vasco x Cruzeiro")),
  ["Vasco", "Cruzeiro"]
);
check(
  "Brazil guide strips live and pre-match furniture",
  parseFootballMatchup(cleanBrazilListingTitle("AO VIVO Pré-Hora: Athletico-PR x Fluminense")),
  ["Athletico-PR", "Fluminense"]
);
check("Brazil VT marker identifies a replay", isBrazilReplayListing("VT - Atlético-MG x Grêmio"), true);
check("Brazil live listing is not a VT replay", isBrazilReplayListing("AO VIVO Atlético-MG x Grêmio"), false);
// Competition prefixes: beIN's condensed re-airs and DirecTV Argentina's
// titles both put the competition before the matchup. Callers try the part
// after the last colon first; without that the prefix glues onto the first
// team's name and the airing matches nothing.
check("competition prefix is not part of the team name", parseFootballMatchup("Copa Libertadores 2026: Fluminense vs Independiente Rivadavia".split(":").pop()), [
  "Fluminense",
  "Independiente Rivadavia",
]);
// Iberia. SPORT TV Portugal appends the round after a spaced hyphen, and El
// País puts the competition before a colon with the sides split by a spaced
// hyphen — the callers cut on those before parsing, so the strings below are
// what actually reaches the parser. All captured live on 2026-08-13.
check("SPORT TV strips the round after a spaced hyphen", parseFootballMatchup("CRUZEIRO X FLAMENGO - OITAVOS DE FINAL 1ª MÃO".split(/\s+-\s+/)[0]), [
  "CRUZEIRO",
  "FLAMENGO",
]);
check("SPORT TV matchup with no round suffix", parseFootballMatchup("PARIS ST. GERMAIN X ASTON VILLA"), [
  "PARIS ST. GERMAIN",
  "ASTON VILLA",
]);
check("a hyphenated club name is not split by the round cut", parseFootballMatchup("AL-DIRIYAH X AL AHLI".split(/\s+-\s+/)[0]), [
  "AL-DIRIYAH",
  "AL AHLI",
]);
check(
  "El País: competition before the colon, sides split by a spaced hyphen",
  parseFootballMatchup("Copa Sudamericana (T2026): Santa Fe - River Plate".split(":").pop().replace(/\s+-\s+/, " vs ")),
  ["Santa Fe", "River Plate"]
);
check(
  "El País accented and multi-word sides survive",
  parseFootballMatchup("Brasileirao (T2026): Gremio - São Paulo".split(":").pop().replace(/\s+-\s+/, " vs ")),
  ["Gremio", "São Paulo"]
);
check("El País round-ups carry no matchup", parseFootballMatchup("Resumen liga brasileña (T2026): Jornada 22".split(":").pop().replace(/\s+-\s+/, " vs ")), null);
check("no matchup in a studio show", parseFootballMatchup("A look ahead to upcoming fixtures in the English Football League"), null);
check("no matchup in a season review", parseFootballMatchup("A look back at the 2013/14 season"), null);

// ---- correlation ----
const mk = (home, away, kickoffUTC, competition = "Campeonato Brasileiro Série A") => ({
  homeTeam: home,
  awayTeam: away,
  homeTeamKey: normalizeTeam(home),
  awayTeamKey: normalizeTeam(away),
  kickoffUTC,
  competition,
  localDate: kickoffUTC.slice(0, 10),
});

const bragantino = mk("Red Bull Bragantino", "Corinthians", "2026-08-09T21:30:00.000Z");
const libertadores = mk("Fluminense", "Independiente Rivadavia", "2026-08-11T22:00:00.000Z", "CONMEBOL Libertadores");
const matches = [bragantino, libertadores];

const air = (o) => ({ channel: "Test", airTimeUTC: "2026-08-12T17:00:00.000Z", teams: ["Fluminense", "Independiente Rivadavia"], ...o });

const labels = (res) => res.map((r) => `${r.match.homeTeam} v ${r.match.awayTeam}`);

check(
  "beIN re-air 19h after kickoff attributes to the match",
  labels(correlateFootballAirings([air({})], matches)),
  ["Fluminense v Independiente Rivadavia"]
);
check(
  "side order carries no information (beIN reverses team1/team2)",
  labels(correlateFootballAirings([air({ teams: ["Independiente Rivadavia", "Fluminense"] })], matches)),
  ["Fluminense v Independiente Rivadavia"]
);
check(
  "Premier Sports' 99h-late Brasileirão re-air still attributes",
  labels(
    correlateFootballAirings(
      [air({ airTimeUTC: "2026-08-14T01:00:00.000Z", teams: ["Red Bull Bragantino", "Corinthians"] })],
      matches
    )
  ),
  ["Red Bull Bragantino v Corinthians"]
);
check(
  "the live broadcast itself is not catch-up (airs at kickoff)",
  labels(correlateFootballAirings([air({ airTimeUTC: "2026-08-11T22:00:00.000Z" })], matches)),
  []
);
check(
  "a listing flagged live is never catch-up",
  labels(correlateFootballAirings([air({ live: true })], matches)),
  []
);
check(
  "archive programming never attributes ('Rangers v Celtic from the 2020/21 season')",
  labels(correlateFootballAirings([air({ archive: true })], matches)),
  []
);
check(
  "beyond 7 days there is no match left to attribute to",
  labels(correlateFootballAirings([air({ airTimeUTC: "2026-08-19T17:00:00.000Z" })], matches)),
  []
);
check(
  "teams that met twice attribute to the most recent meeting",
  correlateFootballAirings(
    [air({ airTimeUTC: "2026-08-12T06:00:00.000Z", teams: ["Fluminense", "Independiente Rivadavia"] })],
    [libertadores, mk("Fluminense", "Independiente Rivadavia", "2026-08-06T22:00:00.000Z", "CONMEBOL Libertadores")]
  ).map((r) => r.match.kickoffUTC),
  ["2026-08-11T22:00:00.000Z"]
);
check(
  "an untracked matchup is dropped rather than guessed at",
  labels(correlateFootballAirings([air({ teams: ["Notts County", "Salford City"] })], matches)),
  []
);
check(
  "Latin American guide abbreviations resolve through the alias table",
  labels(
    correlateFootballAirings(
      [air({ airTimeUTC: "2026-08-12T06:00:00.000Z", teams: parseFootballMatchup("Talleres (C) vs. Lanús") })],
      [mk("Talleres de Córdoba", "Lanús", "2026-08-12T00:00:00.000Z", "Liga Profesional de Fútbol")]
    )
  ),
  ["Talleres de Córdoba v Lanús"]
);
check(
  "Brazilian 'VT - A x B' re-airs attribute",
  labels(
    correlateFootballAirings(
      [air({ airTimeUTC: "2026-08-12T16:30:00.000Z", teams: parseFootballMatchup("Palmeiras x Internacional") })],
      [mk("Palmeiras", "Internacional", "2026-08-09T19:00:00.000Z")]
    )
  ),
  ["Palmeiras v Internacional"]
);
check(
  "alias-resolved names still match ('U. Catolica' -> universidad catolica)",
  labels(
    correlateFootballAirings(
      [air({ teams: ["Estudiantes", "U. Catolica"] })],
      [mk("Estudiantes", "Universidad Católica", "2026-08-11T22:00:00.000Z", "CONMEBOL Libertadores")]
    )
  ),
  ["Estudiantes v Universidad Católica"]
);

// ---- La Liga short forms (added 2026-08-13, season opening) ----
// The fixture feed uses full registered names, so its keys carry prefixes no
// listing ever writes. Without these aliases every La Liga re-air resolves to
// nothing and silently fails to attribute.
check(
  "a guide's plain 'Celta' reaches the feed's 'RC Celta de Vigo'",
  labels(
    correlateFootballAirings(
      [air({ airTimeUTC: "2026-08-17T12:00:00.000Z", teams: ["Celta", "Espanyol"] })],
      [mk("RC Celta de Vigo", "RCD Espanyol de Barcelona", "2026-08-16T19:30:00.000Z", "La Liga")]
    )
  ),
  ["RC Celta de Vigo v RCD Espanyol de Barcelona"]
);
check(
  "'Alavés' and 'Rayo Vallecano' resolve to their full registered names",
  labels(
    correlateFootballAirings(
      [air({ airTimeUTC: "2026-08-16T09:00:00.000Z", teams: ["Alavés", "Rayo Vallecano"] })],
      [mk("Deportivo Alavés", "Rayo Vallecano de Madrid", "2026-08-15T17:30:00.000Z", "La Liga")]
    )
  ),
  ["Deportivo Alavés v Rayo Vallecano de Madrid"]
);
// The collision guard: Racing Santander must never capture Argentina's Racing.
check("bare 'Racing' stays Racing Club de Avellaneda", normalizeTeam("Racing"), "racing");
check("'Racing Santander' is the only form that reaches the Spanish club", normalizeTeam("Racing Santander"), "real racing santander");
check("bare 'Deportivo' is left unmapped rather than guessed", normalizeTeam("Deportivo"), "deportivo");
check("'At. Madrid', the Spanish guides' form, reaches Atlético", normalizeTeam("At. Madrid"), "atletico madrid");
check("'Real Sociedad' reaches the feed's 'Real Sociedad de Fútbol'", normalizeTeam("Real Sociedad"), "real sociedad futbol");
check("'Betis' reaches the feed's 'Real Betis Balompié'", normalizeTeam("Betis"), "real betis balompie");
check("Atlético Mineiro is untouched by the Atlético aliases", normalizeTeam("Atl. Mineiro"), "atletico mineiro");

// ---- live broadcasts (who shows a match, per market) ----
// The same listings, read the other way round: an airing that names both
// teams and starts around kick-off is the live broadcast, not a replay. The
// two windows must never overlap, or a single airing would be both.
const liveAir = (o) => ({ channel: "DAZN LaLiga", market: "Spain", airTimeUTC: "2026-08-11T21:30:00.000Z", teams: ["Fluminense", "Independiente Rivadavia"], ...o });
const liveLabels = (res) => res.map((r) => `${r.airing.market}: ${r.airing.channel}`);

check(
  "a broadcast opening 30 minutes before kick-off is the live one",
  liveLabels(correlateLiveAirings([liveAir({})], matches)),
  ["Spain: DAZN LaLiga"]
);
check(
  "a live-flagged airing counts here (unlike catch-up, which excludes it)",
  liveLabels(correlateLiveAirings([liveAir({ live: true, airTimeUTC: "2026-08-11T22:00:00.000Z" })], matches)),
  ["Spain: DAZN LaLiga"]
);
check(
  "a re-air 19h later is NOT live",
  liveLabels(correlateLiveAirings([liveAir({ airTimeUTC: "2026-08-12T17:00:00.000Z" })], matches)),
  []
);
check(
  "the windows are exactly complementary — 2h after kick-off is catch-up, not live",
  liveLabels(correlateLiveAirings([liveAir({ airTimeUTC: "2026-08-12T00:00:00.000Z" })], matches)),
  []
);
check(
  "a broadcast more than 2h before kick-off is not attached",
  liveLabels(correlateLiveAirings([liveAir({ airTimeUTC: "2026-08-11T19:00:00.000Z" })], matches)),
  []
);
check(
  "archive programming never counts as live coverage",
  liveLabels(correlateLiveAirings([liveAir({ archive: true })], matches)),
  []
);
check(
  "an untagged airing (no market) is ignored",
  liveLabels(correlateLiveAirings([liveAir({ market: undefined })], matches)),
  []
);

// ---- season guard (the Spanish channels' archive problem) ----
// These channels fill the close season with last season's matches, tagged
// only by "(T25/26)". ARCHIVE_RE looks for four-digit years and cannot see
// it, so without this a re-run of last season's Real Madrid - Celta would
// attach to this season's fixture between the same two clubs.
const AUG_2026 = new Date("2026-08-13T12:00:00Z");
const JAN_2027 = new Date("2027-01-15T12:00:00Z");
check("last season's re-run is archive", isStaleSeason("LALIGA EA SPORTS (T25/26): Villarreal - At. Madrid", AUG_2026), true);
check("the current season is not", isStaleSeason("LALIGA EA SPORTS (T26/27): Sevilla - Rayo", AUG_2026), false);
check("a calendar-year competition in its own year is not", isStaleSeason("Copa Sudamericana (T2026): Santa Fe - River Plate", AUG_2026), false);
check("a calendar-year competition from last year is", isStaleSeason("Brasileirao (T2025): Palmeiras - Santos", AUG_2026), true);
check("a listing with no season marker is left alone", isStaleSeason("Copa Libertadores: Cruzeiro - Flamengo", AUG_2026), false);
check("mid-season, the split season is still current", isStaleSeason("LALIGA EA SPORTS (T26/27): Sevilla - Rayo", JAN_2027), false);
check("after New Year, last year's calendar season is stale", isStaleSeason("Copa Sudamericana (T2026): Santa Fe - River Plate", JAN_2027), true);

// ---- German listing conventions (tvinfo.de) ----
// Every string below is a real subtitle or title captured from tvinfo's
// DAZN, Sky Fussball Bundesliga, Sport1 and Sky Sport Austria pages on
// 2026-08-16. German listings stack more furniture around the matchup than
// any other source here: a "Highlights XXL:"-style lead-in before a colon,
// round and venue context after a comma, and a country tag on friendlies.
check("competition in the title, matchup in the subtitle", parseGermanMatchup("Holstein Kiel - FC St. Pauli, 2. Spieltag"), [
  "Holstein Kiel",
  "FC St. Pauli",
]);
check("strips a 'Highlights XXL:' lead-in", parseGermanMatchup("Highlights XXL: KSV - STP, 2. Spieltag"), ["KSV", "STP"]);
check("strips a '90in30:' lead-in", parseGermanMatchup("90in30: FCK - KSC, 2. Spieltag"), ["FCK", "KSC"]);
check("strips a 'Finale:' lead-in", parseGermanMatchup("Finale: FC Bayern München - VfL Wolfsburg"), [
  "FC Bayern München",
  "VfL Wolfsburg",
]);
check("cuts at the FIRST comma, past a second context clause", parseGermanMatchup("1. FC Kaiserslautern - Karlsruher SC, tipico Topspiel der Woche, 2. Spieltag"), [
  "1. FC Kaiserslautern",
  "Karlsruher SC",
]);
check("drops a trailing country tag on a friendly", parseGermanMatchup("Borussia Mönchengladbach - Aston Villa/ ENG"), [
  "Borussia Mönchengladbach",
  "Aston Villa",
]);
check("German exonyms survive the parser intact", parseGermanMatchup("Inter Mailand - SSC Neapel"), ["Inter Mailand", "SSC Neapel"]);
// An unspaced hyphen is part of the club's own name, never the separator —
// the same reasoning that makes SPORT TV's "AL-DIRIYAH" safe.
check("an unspaced hyphen inside a club name is not a separator", parseGermanMatchup("Rot-Weiss Essen - Preußen Münster"), [
  "Rot-Weiss Essen",
  "Preußen Münster",
]);
check("a competition-only title yields no matchup", parseGermanMatchup("Fußball: 2. Bundesliga"), null);
check("a studio show yields no matchup", parseGermanMatchup("Die Fußballdebatte"), null);
check("an empty subtitle yields no matchup", parseGermanMatchup(""), null);

// German listings tag the season bare ("26/27") where the Spanish guides
// parenthesise it, and ARCHIVE_RE sees neither. The Germany layer normalises
// the bare form into the parenthesised one so the same guard applies.
const deSeason = (t) => isStaleSeason(t.replace(/\b(\d{2}\/\d{2})\b/, "(T$1)"), AUG_2026);
check("a bare last-season tag is archive", deSeason("Serie A 25/26 — Inter Mailand - SSC Neapel"), true);
check("a bare current-season tag is not", deSeason("Serie A 26/27 — Inter Mailand - SSC Neapel"), false);


// Portuguese-language short forms from the Brazilian guide. These matter
// twice over: they are what lets a Brazilian channel's re-air of a Serie A
// or Bundesliga match attribute at all, and — since an unattributed VT row
// must now name a tracked club to be listed — what keeps those rows in the
// catch-up feed. They are also exactly the kind of entry that goes silently
// dead if normalizeTeam's suffix stripping ever changes, which has happened
// before ("atletico-mg" was dead code for months).
for (const [written, key] of [
  ["Roma", "as roma"],
  ["Inter de Milão", "internazionale milano"],
  ["Bayern de Munique", "bayern munchen"],
  ["Napoli", "ssc napoli"],
  ["Bologna", "bologna 1909"],
  ["Stuttgart", "vfb stuttgart"],
])
  check(`"${written}" resolves to ${key}`, normalizeTeam(written), key);

// The collisions these aliases must NOT create. Each one would hand a
// Portuguese or lower-division club's match to a different club with a
// similar name — the Vitória SC / EC Vitória collision is the reason Liga
// Portugal is excluded from the SPORT TV layer in the first place.
for (const [written, mustNotBe] of [
  ["Vitória de Guimarães", "vitoria"],
  ["Braga", "red bull bragantino"],
  ["América-MG", "america"],
  ["Botafogo-SP", "botafogo"],
  ["Charlton Athletic", "athletic"],
])
  check(`"${written}" does not resolve to ${mustNotBe}`, normalizeTeam(written) === mustNotBe, false);

// Guide short forms. These became load-bearing when the guide feeds were
// bounded to tracked clubs: an unresolved short form no longer just costs
// attribution, it drops the row as "some other league". "River v Boca" is
// the case that proves it — both sides are short forms.
for (const [written, key] of [
  ["River", "river plate"],
  ["Boca", "boca juniors"],
  ["R. Sociedad", "real sociedad futbol"],
  ["Celta", "rc celta vigo"],
  ["Tottenham", "tottenham hotspur"],
  ["FC Bayern Monaco", "bayern munchen"], // Italian for Munich, not the principality
  ["Monaco", "as monaco"],
])
  check(`"${written}" resolves to ${key}`, normalizeTeam(written), key);

// Ambiguous short forms stay UNMAPPED on purpose — each would collide with a
// different tracked club (Unión Santa Fe vs Union Berlin, Talleres vs Central
// Córdoba, Internacional, Argentinos Juniors), and a wrong attribution is
// worse than a dropped row. Spelled out rather than asserted as identity, so
// that "helpfully" mapping one later fails here instead of silently rewiring
// a club.
for (const [written, unchanged] of [
  ["Unión", "union"],
  ["Córdoba", "cordoba"],
  ["VFB", "vfb"],
  ["Nacional", "nacional"],
  ["Junior", "junior"],
])
  check(`"${written}" is deliberately unmapped`, normalizeTeam(written), unchanged);

console.log(failures ? `\n${failures} FAILED` : "\nAll football correlation tests passed");
process.exit(failures ? 1 : 0);

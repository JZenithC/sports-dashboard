// Known team-name variants where broadcast sites and TheSportsDB disagree on
// naming, keyed by the *normalized* (accent-stripped, lowercase) form that
// appears in scraped data, mapping to the normalized form TheSportsDB uses.
//
// This is a real, growing list, not a generalizable algorithm — several
// Brazilian clubs share the same base name distinguished only by a state
// suffix (Atlético-MG vs Atlético-GO vs Athletico Paranaense are three
// different clubs), so loose fuzzy matching on these names risks silently
// matching the wrong club. A curated table is the safer trade-off: a club
// with no entry here just shows "no channel yet" instead of a wrong channel.
//
// Add an entry whenever a real mismatch turns up (e.g. via the spike report's
// "unmatched entries" section) — one line each, no other changes needed.
export const TEAM_ALIASES = {
  // Brazil — broadcast sites often use the common short name or a state
  // abbreviation; TheSportsDB tends to use the fuller registered name.
  // Keyed with spaces, not hyphens — normalizeTeam() replaces hyphens with
  // spaces before calling resolveAlias(), so a "atletico-mg"-style key here
  // would silently never match anything (found this the hard way: it had
  // been dead code since it was first added).
  "athletico pr": "athletico paranaense",
  "at paranaense": "athletico paranaense", // futebolnatv.com.br also abbreviates as "At. Paranaense"
  "atletico mg": "atletico mineiro",
  "rb bragantino": "red bull bragantino", // futebolnatv.com.br's short name vs the official current name
  "atletico go": "atletico goianiense",
  "botafogo sp": "botafogo ribeirao preto",
  "cr flamengo": "flamengo", // the ARG/MX sites cross-list some Brazilian matches using this fuller form

  // Latin American EPG guides (GatoTV, Guia de TV) abbreviate club names in
  // their listing titles — these are the forms seen in real listings while
  // building the football catch-up view. Kept even though the GatoTV layer
  // that surfaced some of them has since been removed — the same short forms
  // turn up on FullTV and the TV Passport Spanish-language feeds.
  "ath paranaense": "athletico paranaense", // TV Azteca Deportes: "Santos vs. Ath. Paranaense"
  "atl mineiro": "atletico mineiro", // TV Azteca Deportes: "Remo vs. Atl. Mineiro"

  // Argentina — periods/abbreviations in scraped names.
  "independ rivadavia": "independiente rivadavia",
  "independiente r": "independiente rivadavia", // ESPN México truncates it: "Fluminense vs. Independiente R"
  // The Latin American EPGs abbreviate hard, and each guide does it
  // differently — these are the exact forms seen in real listings on
  // GatoTV, FullTV and Guia de TV while building football catch-up.
  "i rivadavia": "independiente rivadavia",
  "ind rivadavia": "independiente rivadavia",
  "dep riestra": "deportivo riestra",
  "atl tucuman": "atletico tucuman",
  "def y justicia": "defensa y justicia",
  newells: "newells old boys",
  velez: "velez sarsfield",
  "argentinos jrs": "argentinos juniors",
  "universidad c": "universidad catolica", // GatoTV truncates long titles mid-word
  // GatoTV/TyC qualify by city initial ("Talleres (C) vs. Lanús"), but the
  // matchup parser strips parentheses before normalising, so the bare name
  // is what actually arrives. Same bare-name collision trade-off already
  // accepted for "estudiantes" and "vasco" below — Talleres de Córdoba is
  // the only Talleres in these competitions.
  talleres: "talleres cordoba",
  "sarmiento junin": "sarmiento", // futebolnatv.com.br adds the city, the ARG/MX sites don't

  // ESPN's standings pages disambiguate a few clubs that the ARG/MX
  // broadcast sites list bare — found while cross-checking fixtures against
  // the real Série A/Liga Profesional/Liga MX rosters (see build-data.js's
  // roster check). Same ambiguity risk as Central Córdoba/Talleres/
  // Estudiantes above: a same-named lower-division club can exist.
  "belgrano cordoba": "belgrano",
  "instituto cordoba": "instituto",
  "gimnasia la plata": "gimnasia lp",
  // TyC's own agenda writes the bare name. Ambiguous in principle — Gimnasia
  // y Esgrima de Mendoza is also tracked — but the same bare-name trade-off
  // already accepted for "estudiantes", "vasco" and "talleres": correlation
  // needs BOTH teams to land on one fixture, so a Mendoza tie written bare
  // resolves to nothing rather than to the wrong club.
  gimnasia: "gimnasia lp",
  "central cordoba santiago del estero": "central cordoba", // ESPN spells out the disambiguator in full; converge to the existing canonical key
  "estudiantes la plata": "estudiantes lp", // ditto
  "estudiantes rio cuarto": "estudiantes rc", // ditto
  "racing avellaneda": "racing", // ESPN's own standings entry is bare "Racing Club" -> "racing"

  // futebolnatv.com.br also lists some Argentine/continental fixtures (not
  // just Brazilian ones), using its own bare short names with no
  // disambiguating suffix — confirmed via matching kickoff times against the
  // ARG/MX sites' fuller names for the same real matches. "estudiantes" is a
  // real risk if this source ever means Estudiantes de Río Cuarto instead of
  // La Plata — no evidence of that so far, revisit if it turns up.
  vasco: "vasco gama",
  estudiantes: "estudiantes lp",

  // Mexico — scraped name order/punctuation differs from the canonical one.
  "unam - pumas": "pumas unam",
  "unam pumas": "pumas unam",
  "chivas guadalajara": "guadalajara", // ESPN's standings roster uses the official name, broadcast sites use the popular nickname
  // "Santos Laguna" (Mexico) converges to the same key as Brazil's "Santos"
  // (Santos FC) — a real but low-probability collision (different
  // countries/competitions; would need an identical opponent pairing on the
  // same date to actually mismatch), accepted the same way the "estudiantes"
  // bare-word alias above already is. Revisit if it turns up.
  "santos laguna": "santos",

  // CONMEBOL — the same continental fixture reaching us from two broadcast
  // sites under two abbreviations of one club. Chile's Universidad Católica
  // arrived as both "U. Catolica" and "CDU Católica", which produced two
  // separate merge keys and so listed Estudiantes vs Católica twice on the
  // same kickoff. Both converge on the full name ESPN's standings use, so
  // the fixture also lines up with its table row.
  "u catolica": "universidad catolica",
  "cdu catolica": "universidad catolica",
  "ldu quito": "liga quito", // broadcast sites use the LDU initialism; ESPN's table and Promiedos' brackets both say "Liga de Quito"
  // Short forms that kept CONMEBOL fixtures from matching their bracket tie;
  // all three converge on the fuller name ESPN's standings use. "santa fe"
  // carries the same bare-name collision risk already accepted for
  // "estudiantes" and "vasco" above — Independiente Santa Fe is the only
  // club of that name in these competitions.
  recoleta: "deportivo recoleta",
  bragantino: "red bull bragantino",
  "santa fe": "independiente santa fe",

  // Spain — the Latin American guides carry La Liga too, with their own
  // short forms. ESPN México lists Deportivo as "D. A. Coruña".
  "d a coruna": "rc deportivo la coruna",
  "deportivo la coruna": "rc deportivo la coruna", // ESPN México / Fox Deportes spell it out

  // La Liga, added 2026-08-13 ahead of the season opening that weekend. The
  // fixture feed uses each club's full registered name, so its keys carry
  // prefixes and suffixes no TV listing ever writes — "RC Celta de Vigo"
  // against a guide's plain "Celta". Every entry below was checked against a
  // real key in the current fixture set, not guessed; clubs with no fixture
  // in the window yet (Real Madrid, Barcelona, Betis, Athletic, Real
  // Sociedad...) are deliberately absent until their canonical form can be
  // read off the feed rather than assumed.
  alaves: "deportivo alaves",
  "rayo vallecano": "rayo vallecano madrid",
  "racing santander": "real racing santander",
  espanyol: "rcd espanyol barcelona",
  "rcd espanyol": "rcd espanyol barcelona",
  levante: "levante ud",
  celta: "rc celta vigo",
  "celta vigo": "rc celta vigo",
  depor: "rc deportivo la coruna", // the club's own nickname, unambiguous
  // Round two, 2026-08-13: the remaining clubs, taken from football-data.org's
  // own /competitions/PD/teams roster rather than guessed, so every target
  // below is a verified canonical key. The Spanish guides write "At. Madrid",
  // "Betis" and "Real Sociedad" where the feed registers "Club Atlético de
  // Madrid", "Real Betis Balompié" and "Real Sociedad de Fútbol".
  "at madrid": "atletico madrid", // FormulaTV's own form: "Villarreal - At. Madrid"
  atleti: "atletico madrid",
  barca: "barcelona",
  rayo: "rayo vallecano madrid",
  betis: "real betis balompie",
  "real betis": "real betis balompie",
  "real sociedad": "real sociedad futbol",
  santander: "real racing santander", // the feed's own short name for Racing
  // LaLiga's own API writes these two shorter than the fixture feed does.
  "r racing": "real racing santander", // its "R. Racing Club" normalizes to this
  "rc deportivo": "rc deportivo la coruna",
  // Bare "atletico" stays unmapped for the same reason bare "racing" does:
  // Atlético Mineiro, Atlético Goianiense and Atlético Tucumán all appear on
  // these sources and three of them already have entries above.
  // Two short forms are deliberately NOT mapped, because they would break
  // clubs this dashboard already tracks:
  //  - bare "racing" is Racing Club de Avellaneda, which already resolves to
  //    "racing" via the racing-avellaneda alias above; pointing it at Racing
  //    Santander would silently hijack every Argentine Racing fixture.
  //  - bare "deportivo" is hopeless on these sources — Deportivo Cali,
  //    Deportivo Riestra and Deportivo Recoleta all appear in them, and two
  //    already have their own entries here.

  // Germany (tvinfo.de), added 2026-08-16. German listings use German
  // EXONYMS for foreign clubs — "Inter Mailand", "SSC Neapel", "OGC Nizza",
  // "Racing Straßburg" — which no other source in this project writes, so
  // without these every Serie A and Ligue 1 re-air on DAZN Deutschland
  // would silently fail to attribute. Each spelling below was read off a
  // real tvinfo listing (its "Serie A 26/27" and "Ligue 1 26/27" pages)
  // and each target verified against a key that actually exists in the
  // fixture set, not guessed from the German name.
  "inter mailand": "internazionale milano",
  "ssc neapel": "ssc napoli",
  "racing straßburg": "rc strasbourg alsace",
  "ogc nizza": "ogc nice",
  troyes: "es troyes",
  genoa: "genoa cfc",
  "athletic bilbao": "athletic",
  "espanyol barcelona": "rcd espanyol barcelona",
  "ud levante": "levante ud",
  "real betis sevilla": "real betis balompie",
  "deportivo a coruna": "rc deportivo la coruna",
  // "PSG" is deliberately NOT mapped, and this is the trap on this source:
  // the fixture feed's "paris" key is **Paris FC**, a different club that
  // tvinfo also lists ("Paris FC - OGC Nizza"). Pointing PSG at it would
  // attach Paris Saint-Germain's matches to Paris FC's fixtures. Clubs with
  // no fixture in the window are left alone for the same reason the La Liga
  // block above left them: the canonical key has to be read off the feed,
  // not inferred. Several of the clubs that note used to list (Lazio, Roma,
  // Bologna, Lecce, Fiorentina) now HAVE fixtures, so their keys were read
  // off the feed and added below.

  // Portuguese-language short forms, from the Brazilian guide (Guia de TV).
  // Brazilian channels re-air a lot of European football and write it the
  // Portuguese way — "Inter de Milão", "Bayern de Munique" — or with the
  // bare club name where the fixture feed carries the full registered one.
  // Without these, every such re-air failed to attribute AND, now that an
  // unattributed VT row must name a tracked club to be listed at all, would
  // have been dropped outright. Each target below was verified against a key
  // that actually exists in the fixture set, not guessed from the name.
  roma: "as roma",
  lazio: "ss lazio",
  lecce: "us lecce",
  napoli: "ssc napoli",
  bologna: "bologna 1909",
  cagliari: "cagliari calcio",
  como: "como 1907",
  fiorentina: "acf fiorentina",
  frosinone: "frosinone calcio",
  parma: "parma calcio 1913",
  "inter milao": "internazionale milano", // NOT "internacional" — that key is Internacional of Porto Alegre
  "bayern munique": "bayern munchen",
  stuttgart: "vfb stuttgart",
  "hamburg sv": "hamburger sv",
  ipswich: "ipswich town",
  leeds: "leeds united",
  newcastle: "newcastle united",

  // Guide short forms. Every EPG writes clubs the way a viewer says them
  // ("Tottenham", "River", "Boca", "Nice") while the fixture feed carries the
  // full registered name, and until the guide feeds were bounded to tracked
  // clubs that only cost attribution. Now it costs the row itself — an
  // unresolved name reads as "some other league" — so this table is what
  // stands between "River v Boca" and being filtered out as foreign. Every
  // key below was taken from a real listing and every target verified against
  // a key that exists in the fixture set.
  river: "river plate",
  boca: "boca juniors",
  barracas: "barracas central",
  tottenham: "tottenham hotspur",
  brighton: "brighton & hove albion",
  coventry: "coventry city",
  "leeds utd": "leeds united",
  "manchester utd": "manchester united",
  celta: "rc celta vigo",
  "rc celta": "rc celta vigo",
  "r sociedad": "real sociedad futbol",
  atalanta: "atalanta bc",
  udinese: "udinese calcio",
  sassuolo: "us sassuolo calcio",
  "sassuolo calcio": "us sassuolo calcio",
  "inter milan": "internazionale milano",
  bayern: "bayern munchen", // "FC Bayern" — the fc is stripped before this runs
  "bayern munich": "bayern munchen",
  "bayern monaco": "bayern munchen", // Italian guides: Monaco di Baviera, not the principality
  "bayer leverkusen": "bayer 04 leverkusen",
  hoffenheim: "tsg 1899 hoffenheim",
  "werder bremen": "sv werder bremen",
  mainz: "1 fsv mainz 05",
  "mainz 05": "1 fsv mainz 05",
  koln: "1 koln",
  "union berlin": "1 union berlin",
  elversberg: "sv 07 elversberg",
  "sv elversberg": "sv 07 elversberg",
  "b monchengladbach": "borussia monchengladbach",
  "borussia mgladbach": "borussia monchengladbach",
  lille: "lille osc",
  lens: "racing lens",
  nice: "ogc nice",
  monaco: "as monaco",
  angers: "angers sco",
  auxerre: "aj auxerre",
  "stade brestois": "stade brestois 29",
  "rc strasbourg": "rc strasbourg alsace",
  "strasbourg alsace": "rc strasbourg alsace",
  lyon: "olympique lyonnais",
  "olympique lyon": "olympique lyonnais",
  "o lyonnais": "olympique lyonnais",
  "o marseille": "olympique marseille",
  // Left unmapped because the short form is genuinely ambiguous, and a wrong
  // attribution is worse than a dropped row:
  //  - "union": Unión Santa Fe in an Argentine guide, Union Berlin in a
  //    German one. The qualified "union berlin" above is safe; bare is not.
  //  - "cordoba": Talleres de Córdoba and Central Córdoba are both tracked.
  //  - "vfb": VfB Stuttgart is the famous one, but not the only VfB.
  //  - "nacional", "junior", "america cali", "racing cba": each collides with
  //    a different tracked club (Internacional, Argentinos Juniors, Club
  //    América, Racing Club).
  // Also left alone: names with the competition glued on ("Chelsea Premier
  // League", "Napoli Serie A", "Atalanta UEFA Conference League"). That is a
  // parsing bug in the source, not a naming variant, and aliasing each one
  // would be endless.
  // Deliberately NOT aliased, and each for a reason that has already bitten
  // this project once:
  //  - "vitoria guimaraes" -> "vitoria" would hand Vitória SC's matches to
  //    EC Vitória of Salvador. This is the exact collision that keeps Liga
  //    Portugal out of the SPORT TV layer.
  //  - "braga" -> "red bull bragantino" is a substring coincidence, nothing
  //    more. Braga is Portuguese.
  //  - "america mg" -> "america": the feed's "america" is Club América of
  //    Mexico City, a different club on a different continent.
  //  - "botafogo ribeirao preto" -> "botafogo": Botafogo-SP and Botafogo-RJ
  //    are two clubs, which is why the -SP suffix exists.
  //  - "charlton athletic" -> "athletic": Athletic Club is Bilbao.
};

export function resolveAlias(normalizedName) {
  return TEAM_ALIASES[normalizedName] ?? normalizedName;
}

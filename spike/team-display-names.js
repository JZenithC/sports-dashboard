// Canonical display name per club, keyed by normalizeTeam()'s output — so
// every spelling/abbreviation variant scraped from any site (e.g. "Athletico
// PR", "CA Huracán", "Huracan", "Atletico Tucuman", "Atlético Tucumán") all
// converge on one consistent, official name shown in the UI, regardless of
// which source's raw text happened to be used for that particular match.
//
// Verified against current official sources (Wikipedia, club/league sites,
// ESPN) rather than assumed — see commit history for what was checked.
// A club with no entry here just displays whatever the scraper gave it,
// same graceful-fallback philosophy as the logo registries.
export const TEAM_DISPLAY_NAMES = {
  // Brazil
  "athletico paranaense": "Athletico Paranaense", // catches "Athletico PR" via the alias in team-aliases.js
  "atletico mineiro": "Atlético Mineiro", // catches "Atlético-MG" via the alias in team-aliases.js
  "red bull bragantino": "Red Bull Bragantino", // catches "RB Bragantino" via the alias in team-aliases.js
  chapecoense: "Chapecoense", // raw scrape has a redundant "-sc" state suffix
  flamengo: "Flamengo", // guarantees the display stays "Flamengo" even when "CR Flamengo" (aliased in team-aliases.js) is the only raw form scraped for a given match

  // Argentina
  "atletico tucuman": "Atlético Tucumán", // unifies "Atletico Tucuman" / "Atlético Tucumán"
  huracan: "Huracán", // unifies "CA Huracán" / "Huracan"
  "central cordoba": "Central Córdoba (Santiago del Estero)", // ambiguous otherwise — a different, unrelated Central Córdoba exists in a lower division
  "estudiantes lp": "Estudiantes de La Plata",
  "estudiantes rc": "Estudiantes de Río Cuarto",
  "independiente rivadavia": "Independiente Rivadavia", // unifies "Independ. Rivadavia" (already merges for matching via the alias in team-aliases.js, just wasn't displaying consistently)
  "gimnasia lp": "Gimnasia y Esgrima La Plata",
  "gimnasia mendoza": "Gimnasia y Esgrima de Mendoza",
  belgrano: "Belgrano (Córdoba)", // disambiguates the same way Central Córdoba/Talleres do — ESPN's standings pages disambiguate this club too, implying a same-named club exists elsewhere
  instituto: "Instituto (Córdoba)",
  "talleres cordoba": "Talleres de Córdoba", // disambiguates from Talleres (Remedios de Escalada), a different club
  racing: "Racing Club", // "Racing Club" is the actual official name — catches "Racing Avellaneda" via the alias in team-aliases.js, keyed "racing" (not "racing avellaneda") since that's what the alias resolves through to
  sarmiento: "Sarmiento de Junín",
  "vasco gama": "Vasco da Gama", // unifies futebolnatv.com.br's bare "Vasco" with the ARG/MX sites' "Vasco da Gama"

  // Europe. football-data.org registers clubs under their full legal names
  // ("Real Racing Club de Santander", "FC Internazionale Milano"), which no
  // broadcaster, table or supporter actually uses and which crowd out the
  // team name in a schedule row. These are the everyday names — the ones on
  // the league's own table — not truncations of the legal ones. Matching is
  // untouched: display names are cosmetic and keyed off the same normalized
  // key the alias table resolves to.
  // Spain
  "real racing santander": "Racing Santander",
  "rcd espanyol barcelona": "Espanyol",
  "rayo vallecano madrid": "Rayo Vallecano",
  "atletico madrid": "Atlético Madrid",
  "real sociedad futbol": "Real Sociedad",
  "rc deportivo la coruna": "Deportivo La Coruña",
  "real betis balompie": "Real Betis",
  "rc celta vigo": "Celta Vigo",
  "deportivo alaves": "Alavés",
  "levante ud": "Levante",
  "athletic": "Athletic Club",
  // Italy
  "internazionale milano": "Inter Milan",
  "parma calcio 1913": "Parma",
  "genoa cfc": "Genoa",
  "udinese calcio": "Udinese",
  "cagliari calcio": "Cagliari",
  "como 1907": "Como",
  "ssc napoli": "Napoli",
  monza: "Monza",
  // France
  "olympique marseille": "Marseille",
  "olympique lyonnais": "Lyon",
  "rc strasbourg alsace": "Strasbourg",
  "racing lens": "Lens",
  "stade brestois 29": "Brest",
  "es troyes": "Troyes",
  "aj auxerre": "Auxerre",
  "ogc nice": "Nice",
  // England — the feed suffixes almost every club with FC/AFC
  "manchester united": "Manchester United",
  "tottenham hotspur": "Tottenham",
  "nottingham forest": "Nottingham Forest",
  "crystal palace": "Crystal Palace",
  "coventry city": "Coventry City",
  "ipswich town": "Ipswich Town",
  "leeds united": "Leeds United",
  "hull city": "Hull City",
};

export function displayNameFor(normalizedName, fallback) {
  return TEAM_DISPLAY_NAMES[normalizedName] ?? fallback;
}

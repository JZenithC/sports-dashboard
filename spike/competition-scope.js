// Classifies a scraped entry into one of the in-scope competitions from the
// spec, or null if it's out of scope. Two different identification schemes
// are needed because the two scraper platforms expose competition identity
// differently:
//  - futebolnatv.com.br: the visible competition label IS the real name
//    ("Copa Do Brasil", "Campeonato Argentino") — matched by keyword.
//  - futbolenvivoargentina.com / futbolenvivomexico.com: the visible label is
//    actually the round/phase name, not the competition — the reliable
//    signal is the schema.org competition URL slug (see scrape-nuxt-platform.js).

// Display names are each competition's current official name, not the most
// common nickname — e.g. Argentina's top flight is officially "Liga
// Profesional de Fútbol" (AFA), not "Primera División"; CONMEBOL's two club
// cups are officially branded "CONMEBOL Libertadores"/"CONMEBOL Sudamericana"
// as of their current sponsorship cycle, not just "Copa Libertadores/Sudamericana".
export const CANONICAL = {
  BRASILEIRAO: "Campeonato Brasileiro Série A",
  COPA_DO_BRASIL: "Copa do Brasil",
  ARGENTINE_PRIMERA: "Liga Profesional de Fútbol",
  COPA_ARGENTINA: "Copa Argentina",
  LIGA_MX: "Liga MX",
  COPA_LIBERTADORES: "CONMEBOL Libertadores",
  COPA_SUDAMERICANA: "CONMEBOL Sudamericana",
  PREMIER_LEAGUE: "Premier League",
  LA_LIGA: "La Liga",
  BUNDESLIGA: "Bundesliga",
  SERIE_A: "Serie A",
  LIGUE_1: "Ligue 1",
  CHAMPIONS_LEAGUE: "UEFA Champions League",
};

const SLUG_MAP = {
  brasileirao: CANONICAL.BRASILEIRAO,
  "copa-do-brasil": CANONICAL.COPA_DO_BRASIL,
  "liga-argentina": CANONICAL.ARGENTINE_PRIMERA,
  "copa-liga-profesional-argentina": CANONICAL.ARGENTINE_PRIMERA,
  "copa-argentina": CANONICAL.COPA_ARGENTINA,
  "liga-mexico": CANONICAL.LIGA_MX,
  "copa-libertadores": CANONICAL.COPA_LIBERTADORES,
  "copa-sudamericana": CANONICAL.COPA_SUDAMERICANA,
};

// football-data.org's own competition codes — a clean, exact identification
// scheme (unlike the messy scraped labels below), so no regex matching
// needed. Free tier only, deliberately: Europa League and domestic cups
// aren't requested by spike/fetch-europe.js at all, so they never reach
// this map either.
const CODE_MAP = {
  PL: CANONICAL.PREMIER_LEAGUE,
  PD: CANONICAL.LA_LIGA,
  BL1: CANONICAL.BUNDESLIGA,
  SA: CANONICAL.SERIE_A,
  FL1: CANONICAL.LIGUE_1,
  CL: CANONICAL.CHAMPIONS_LEAGUE,
};

// futebolnatv.com.br's own labels, checked case-insensitively. Order matters —
// more specific patterns (women's leagues) are excluded before the general
// keyword would otherwise match.
const LABEL_RULES = [
  // "femenin" catches Spanish (femenino/femenina); "feminin" catches
  // Portuguese (feminino/feminina) — found this the hard way: the Spanish-
  // only pattern let "Brasileirão Feminino" (Portuguese) slip through.
  { exclude: /femenin|feminin|women/i },
  // Youth/reserve sides (e.g. a hypothetical "Brasileirão Sub-20") are out of
  // scope the same way — defensive, since the label-keyword patterns below
  // are substring matches, not exact competition names, and only the "Série
  // B/C/D" variant has actually been observed leaking through so far.
  { exclude: /\bsub[- ]?\d{2}\b|reserva/i },
  // Only the top flight is in scope. futebolnatv.com.br labels lower tiers
  // "Brasileirão Série B/C/D" — the bare /brasileir/i pattern below would
  // otherwise match all of them too and misclassify them as the first
  // division (confirmed live: B/C/D matches were showing up under
  // "Campeonato Brasileiro Série A").
  { exclude: /s[ée]rie [bcd]\b/i },
  { pattern: /brasileir/i, canonical: CANONICAL.BRASILEIRAO },
  { pattern: /copa do brasil/i, canonical: CANONICAL.COPA_DO_BRASIL },
  { pattern: /campeonato argentino/i, canonical: CANONICAL.ARGENTINE_PRIMERA },
  { pattern: /copa argentina/i, canonical: CANONICAL.COPA_ARGENTINA },
  { pattern: /liga mx\b/i, canonical: CANONICAL.LIGA_MX },
  { pattern: /libertadores/i, canonical: CANONICAL.COPA_LIBERTADORES },
  { pattern: /sudamericana/i, canonical: CANONICAL.COPA_SUDAMERICANA },
];

export function classifyCompetition(entry) {
  if (entry.competitionCode) {
    return CODE_MAP[entry.competitionCode] ?? null;
  }
  if (entry.competitionSlug) {
    return SLUG_MAP[entry.competitionSlug] ?? null;
  }

  const label = entry.competition || "";
  for (const rule of LABEL_RULES) {
    if (rule.exclude && rule.exclude.test(label)) return null;
    if (rule.pattern && rule.pattern.test(label)) return rule.canonical;
  }
  return null;
}

export const CONTINENTAL_CUPS = new Set([CANONICAL.COPA_LIBERTADORES, CANONICAL.COPA_SUDAMERICANA]);

// The 5 major European leagues + Champions League — a separate set from
// CONTINENTAL_CUPS on purpose. CONTINENTAL_CUPS' existing behavior in
// build-data.js drops a match with no recognized BR/AR/MX club, which is
// wrong here: every Champions League match should display, just grouped
// under "Europe" rather than requiring a South American club to appear.
export const EURO_COMPETITIONS = new Set([
  CANONICAL.PREMIER_LEAGUE,
  CANONICAL.LA_LIGA,
  CANONICAL.BUNDESLIGA,
  CANONICAL.SERIE_A,
  CANONICAL.LIGUE_1,
  CANONICAL.CHAMPIONS_LEAGUE,
]);

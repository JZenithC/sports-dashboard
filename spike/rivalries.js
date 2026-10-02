// Well-known derby matchups, flagged as a small badge on the match card —
// not a ranking/sort signal (see index.html's renderEvent). Keyed by
// normalizeTeam()'s output, same convention as team-aliases.js /
// team-display-names.js, so any spelling variant scraped from any site still
// matches. Deliberately a short, high-confidence list (globally recognized
// derbies only) rather than an attempt at completeness.
const RIVALRIES = [
  // Brazil
  ["cr flamengo", "fluminense"], // Fla-Flu
  ["cr flamengo", "vasco gama"], // Clássico dos Milhões — normalizeTeam() strips the "da" in "Vasco da Gama" as a suffix word
  ["corinthians", "palmeiras"], // Derby Paulista / Choque-Rei
  ["corinthians", "sao paulo"], // Majestoso
  ["gremio", "internacional"], // Grenal
  ["atletico mineiro", "cruzeiro"], // Clássico Mineiro

  // Argentina
  ["boca juniors", "river plate"], // Superclásico
  ["independiente", "racing avellaneda"], // Clásico de Avellaneda
  ["newells old boys", "rosario central"], // Clásico Rosarino

  // Mexico
  ["america", "chivas guadalajara"], // Clásico Nacional
  ["america", "cruz azul"], // Clásico Joven
  ["pumas unam", "america"],
];

const RIVALRY_KEYS = new Set(RIVALRIES.map(([a, b]) => [a, b].sort().join("|")));

export function isRivalry(normalizedHome, normalizedAway) {
  return RIVALRY_KEYS.has([normalizedHome, normalizedAway].sort().join("|"));
}

// Table-position "zones" (title race / relegation highlighting) and total
// round counts, per competition — verified via research (not assumed) before
// writing this, since getting these wrong would actively misinform rather
// than just look bland. See commit history / plan notes for sources.
//
// Zone ranges are this season's specific allocation, not a fixed rule (e.g.
// Brazil's continental slot split shifts year to year depending on how many
// clubs also qualify via cup wins) — worth a yearly recheck, same caveat the
// project already carries for its competition/broadcast data elsewhere.
import { CANONICAL } from "./competition-scope.js";

export const STANDINGS_ZONES = {
  [CANONICAL.BRASILEIRAO]: [
    { from: 1, to: 5, tier: "primary", label: "Libertadores" },
    { from: 6, to: 11, tier: "secondary", label: "Sudamericana" },
    { from: 17, to: 20, tier: "danger", label: "Relegation" },
  ],
  [CANONICAL.LIGA_MX]: [{ from: 1, to: 8, tier: "primary", label: "Liguilla" }],
  [CANONICAL.COPA_LIBERTADORES]: [{ from: 1, to: 2, tier: "primary", label: "Advances" }],
  [CANONICAL.COPA_SUDAMERICANA]: [
    { from: 1, to: 1, tier: "primary", label: "Advances" },
    { from: 2, to: 2, tier: "secondary", label: "Playoff" },
  ],
  // Liga Profesional de Fútbol (Argentina) has no entry, deliberately. Its
  // zones (Group A/B, as scraped from ESPN) do NOT determine continental
  // qualification (a separate cross-zone "Tabla Anual") or relegation (a
  // separate multi-season "Promedios" table) — neither of which this project
  // scrapes. A naive top/bottom-N highlight on the zone table would be
  // actively wrong, not just approximate — see TABLE_NOTES below instead.
};

export const TABLE_NOTES = {
  [CANONICAL.ARGENTINE_PRIMERA]:
    "Zone position doesn't determine qualification or relegation this season — both use separate cross-zone tables (Tabla Anual, Promedios) not tracked here.",
};

// Total rounds/matchdays per competition — used for "Round N of M" matchday
// context on fixture cards. Argentina is deliberately absent for the same
// reason as above (a zone's "played" count doesn't map to one meaningful
// overall round number this season).
export const TOTAL_ROUNDS = {
  [CANONICAL.BRASILEIRAO]: 38,
  [CANONICAL.LIGA_MX]: 17,
  [CANONICAL.COPA_LIBERTADORES]: 6,
  [CANONICAL.COPA_SUDAMERICANA]: 6,
};

export function zoneFor(competition, position) {
  const zones = STANDINGS_ZONES[competition];
  if (!zones) return null;
  const zone = zones.find((z) => position >= z.from && position <= z.to);
  return zone ? { tier: zone.tier, label: zone.label } : null;
}

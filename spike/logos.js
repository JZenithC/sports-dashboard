// Competition logo registry — a small, curated, self-hosted set (see
// public/logos/competitions/). Self-hosted rather than hotlinked so the
// dashboard never depends on a third party's file staying at the same URL.
// Sourced from Wikimedia Commons (public-domain-status vector logos, used
// here purely for informational identification on a personal, non-commercial
// dashboard — same nominative-use basis any TV guide app relies on).
//
// Team logos are NOT in this registry — they come directly from each scraped
// site's own markup (see scrape-brazil.js / scrape-nuxt-platform.js), which is
// both more accurate and requires zero manual maintenance as new teams appear.
//
// Anything absent from this registry (a competition logo we haven't sourced
// yet, or any TV channel — there's no free reliable source for channel
// brand logos) falls back to a generated monogram. That fallback is a first-
// class part of the design, not an error state, so coverage can only ever
// improve over time without anything ever breaking.
export const COMPETITION_LOGOS = {
  "Campeonato Brasileiro Série A": "/logos/competitions/brasileirao.svg",
  "Copa do Brasil": "/logos/competitions/copa-do-brasil.svg",
  "CONMEBOL Libertadores": "/logos/competitions/libertadores.svg",
  "CONMEBOL Sudamericana": "/logos/competitions/sudamericana.svg",
  "Liga MX": "/logos/competitions/liga-mx.svg",
  "Liga Profesional de Fútbol": "/logos/competitions/liga-profesional.svg",
  // Copa Argentina: deliberately not included. Its only available logo is
  // hosted on English Wikipedia (not Commons) and explicitly marked non-free/
  // fair-use ("any other use... may be copyright infringement") — unlike the
  // simple public-domain-status marks used above, so it stays on the
  // monogram fallback instead.
};

// Deterministic color from a name, so the same team/channel always gets the
// same monogram color across runs (not random, not visually arbitrary).
const PALETTE = [
  "#e07a3f", // terracotta
  "#3f7ae0", // azure
  "#3fae5c", // pitch green
  "#c94f6d", // rose
  "#8a5fd1", // violet
  "#d1a63f", // gold
  "#3f9fd1", // sky
  "#d15f3f", // clay
];

export function monogramFor(name) {
  const clean = (name || "").trim();
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  const color = PALETTE[hash % PALETTE.length];
  const words = clean.split(/\s+/).filter(Boolean);
  const initials =
    words.length >= 2 ? words[0][0] + words[1][0] : clean.slice(0, 2);
  return { initials: initials.toUpperCase(), color };
}

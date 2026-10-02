// Static MLB team reference data — id, division, and venue timezone for all
// 30 clubs. Ballparks don't move mid-season, so unlike the soccer pipeline's
// scraped/joined data, this is safe to hardcode rather than re-fetch per
// build. Sourced from statsapi.mlb.com's own /teams and /standings endpoints
// (verified live): team id + venue.timeZone.id from
// `/api/v1/teams?sportId=1&activeStatus=Y&hydrate=venue(timezone)`, division
// assignment cross-checked against `/api/v1/standings?leagueId=103,104`.
//
// Keyed by MLB's own numeric team id (the id used throughout
// statsapi.mlb.com responses — schedule, standings, broadcasts) so callers
// never need a name-matching step the way the soccer scrapers do.
export const MLB_TEAMS = {
  108: { name: "Los Angeles Angels", abbreviation: "LAA", league: "AL", division: "West", timezone: "America/Los_Angeles" },
  109: { name: "Arizona Diamondbacks", abbreviation: "AZ", league: "NL", division: "West", timezone: "America/Phoenix" },
  110: { name: "Baltimore Orioles", abbreviation: "BAL", league: "AL", division: "East", timezone: "America/New_York" },
  111: { name: "Boston Red Sox", abbreviation: "BOS", league: "AL", division: "East", timezone: "America/New_York" },
  112: { name: "Chicago Cubs", abbreviation: "CHC", league: "NL", division: "Central", timezone: "America/Chicago" },
  113: { name: "Cincinnati Reds", abbreviation: "CIN", league: "NL", division: "Central", timezone: "America/New_York" },
  114: { name: "Cleveland Guardians", abbreviation: "CLE", league: "AL", division: "Central", timezone: "America/New_York" },
  115: { name: "Colorado Rockies", abbreviation: "COL", league: "NL", division: "West", timezone: "America/Denver" },
  116: { name: "Detroit Tigers", abbreviation: "DET", league: "AL", division: "Central", timezone: "America/Detroit" },
  117: { name: "Houston Astros", abbreviation: "HOU", league: "AL", division: "West", timezone: "America/Chicago" },
  118: { name: "Kansas City Royals", abbreviation: "KC", league: "AL", division: "Central", timezone: "America/Chicago" },
  119: { name: "Los Angeles Dodgers", abbreviation: "LAD", league: "NL", division: "West", timezone: "America/Los_Angeles" },
  120: { name: "Washington Nationals", abbreviation: "WSH", league: "NL", division: "East", timezone: "America/New_York" },
  121: { name: "New York Mets", abbreviation: "NYM", league: "NL", division: "East", timezone: "America/New_York" },
  133: { name: "Athletics", abbreviation: "ATH", league: "AL", division: "West", timezone: "America/Los_Angeles" },
  134: { name: "Pittsburgh Pirates", abbreviation: "PIT", league: "NL", division: "Central", timezone: "America/New_York" },
  135: { name: "San Diego Padres", abbreviation: "SD", league: "NL", division: "West", timezone: "America/Los_Angeles" },
  136: { name: "Seattle Mariners", abbreviation: "SEA", league: "AL", division: "West", timezone: "America/Los_Angeles" },
  137: { name: "San Francisco Giants", abbreviation: "SF", league: "NL", division: "West", timezone: "America/Los_Angeles" },
  138: { name: "St. Louis Cardinals", abbreviation: "STL", league: "NL", division: "Central", timezone: "America/Chicago" },
  139: { name: "Tampa Bay Rays", abbreviation: "TB", league: "AL", division: "East", timezone: "America/New_York" },
  140: { name: "Texas Rangers", abbreviation: "TEX", league: "AL", division: "West", timezone: "America/Chicago" },
  141: { name: "Toronto Blue Jays", abbreviation: "TOR", league: "AL", division: "East", timezone: "America/Toronto" },
  142: { name: "Minnesota Twins", abbreviation: "MIN", league: "AL", division: "Central", timezone: "America/Chicago" },
  143: { name: "Philadelphia Phillies", abbreviation: "PHI", league: "NL", division: "East", timezone: "America/New_York" },
  144: { name: "Atlanta Braves", abbreviation: "ATL", league: "NL", division: "East", timezone: "America/New_York" },
  145: { name: "Chicago White Sox", abbreviation: "CWS", league: "AL", division: "Central", timezone: "America/Chicago" },
  146: { name: "Miami Marlins", abbreviation: "MIA", league: "NL", division: "East", timezone: "America/New_York" },
  147: { name: "New York Yankees", abbreviation: "NYY", league: "AL", division: "East", timezone: "America/New_York" },
  158: { name: "Milwaukee Brewers", abbreviation: "MIL", league: "NL", division: "Central", timezone: "America/Chicago" },
};

// statsapi.mlb.com's division ids -> {league, division} — stable MLB
// structure, confirmed directly against a live /api/v1/standings response
// (each id's teamRecords matched exactly one of these six groups).
export const DIVISION_BY_ID = {
  200: { league: "AL", division: "West" },
  201: { league: "AL", division: "East" },
  202: { league: "AL", division: "Central" },
  203: { league: "NL", division: "West" },
  204: { league: "NL", division: "East" },
  205: { league: "NL", division: "Central" },
};

export function teamLogoUrl(teamId) {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

// Channel name -> official domain, used to fetch a real brand icon via
// Google's public favicon service (stable, no API key, no rate limit issues
// observed — unlike Clearbit's old logo API, which is now offline).
//
// Channel names from scraped sites carry a lot of noise (subscription notes,
// channel numbers, "(Míralo en vivo)" suffixes) — normalizeChannelName strips
// that before matching against this registry. A channel not listed here
// falls back to a monogram rather than a guessed/wrong domain.
export const CHANNEL_DOMAINS = {
  // Trailing channel numbers ("ESPN 2", "Azteca 7") are stripped by
  // normalizeChannelName before lookup, so the base name alone is enough to
  // cover every numbered variant — a keyed "espn 2" entry would be dead code.
  espn: "espn.com",
  "espn premium": "espn.com",
  fox: "fox.com",
  "fox one": "fox.com",
  "disney+": "disneyplus.com",
  "disney+ premium": "disneyplus.com",
  tnt: "tntsports.co.uk",
  "tnt sports": "tntsports.co.uk",
  "tnt sports premium": "tntsports.co.uk",
  "tnt sports en hbo max": "tntsports.co.uk",
  "hbo max": "max.com",
  sportv: "sportv.globo.com",
  premiere: "premiere.globo.com",
  "premiere fc": "premiere.globo.com",
  "ge tv": "ge.globo.com",
  "globo internacional": "globointernacional.globo.com",
  "prime video": "primevideo.com",
  "amazon prime video": "primevideo.com",
  "bbc iplayer": "bbc.co.uk",
  hbo: "max.com",
  rtve: "rtve.es",
  "canal+": "canalplus.com",
  m6: "m6.fr",
  universo: "telemundo.com",
  wow: "wowtv.de",
  bbc: "bbc.co.uk",
  "premier sports": "premiersports.com",
  "ligue1+": "plus.ligue1.com",
  "paramount+": "paramountplus.com",
  "movistar plus+": "movistar.es",
  "sky deutschland": "sky.de",
  "sky italia": "sky.it",
  peacock: "peacocktv.com",
  nbc: "nbc.com",
  "usa network": "usanetwork.com",
  telemundo: "telemundo.com",
  fandango: "fandango.com",
  cbs: "cbs.com",
  "bein sports": "beinsports.com",
  "tyc sports internacional": "tycsports.com",
  "espn 2 sur": "espn.com",
  "espn sur": "espn.com",
  "espn 2 norte": "espn.com",
  "espn +": "espn.com",
  "max mexico": "max.com",
  "sky sports mexico": "sky.com.mx",
  "youtube - cazétv": "youtube.com",
  "youtube - sportynet": "youtube.com",
  "canal 5 televisa": "televisa.com",
  "imagen tv": "imagentv.com.mx",
  "tv pública": "tvpublica.com.ar",
  telefe: "telefe.com",
  sbt: "sbt.com.br",
  "tyc sports": "tycsports.com",
  "tyc sports play": "tycsports.com", // TyC's streaming product — how its own agenda flags its matches
  "win sports": "winsports.co",
  "win sports +": "winsports.co",
  fanatiz: "fanatiz.com",
  youtube: "youtube.com",
  "apple tv": "tv.apple.com",
  "claro sports": "clarosports.com",
  "clarosports.com": "clarosports.com",
  azteca: "aztecadeportes.com",
  "azteca deportes network": "aztecadeportes.com",
  "azteca deportes app": "aztecadeportes.com",
  "aztecadeportes.com": "aztecadeportes.com",
  tudn: "tudn.com",
  "vix premium": "vix.com",
  "vix gratis": "vix.com",
  vix: "vix.com",
  tubi: "tubi.tv",
  "pluto tv": "pluto.tv",
  onefootball: "onefootball.com",
  "onefootball ppv": "onefootball.com",
  "sky sports": "skysports.com",
  dazn: "dazn.com",
  "dazn ppv": "dazn.com",
  "dazn app gratis": "dazn.com",
  "imagen televisión": "imagentv.com.mx",
  "caf tv": "cafonline.com", // normalizeChannelName already strips a trailing "YouTube"
  dgo: "dgo.la", // domain resolves but Google's favicon service 404s on it (too obscure to have crawled) — kept mapped in case that changes
  dsports: "directvsports.com",
  // DirecTV Argentina's guide names its extra feeds "DSports+" / "DSports R";
  // only digits are stripped by normalizeChannelName, so these need keys.
  "dsports+": "directvsports.com",
  "dsports r": "directvsports.com",
  "lpf play": "lpfplay.com",
  nu9ve: "elnueve.com.ar",
  "antel tv internacional": "antel.com.uy",
  "rcn nuestra tele": "canalrcn.com",
  "flamengo tv": "youtube.com", // club's own channel is hosted on YouTube, no separate site

  // MLB national broadcasters (fox/espn/apple tv/peacock/nbc already mapped
  // above for soccer) plus the handful of regional sports networks common
  // enough to be worth a real logo — the long tail of team-branded ".TV"
  // streaming channels (Guardians.TV, Rockies.TV, etc.) and smaller RSNs
  // fall back to a monogram badge, same graceful-degradation as any other
  // unmapped channel here.
  fs1: "foxsports.com",
  "fox sports 1": "foxsports.com",
  tbs: "tbs.com",
  espn2: "espn.com",
  "mlb network": "mlb.com",
  yes: "yesnetwork.com",
  "yes network": "yesnetwork.com",
  nesn: "nesn.com",
  sny: "sny.tv",
  masn: "masnsports.com",
  "marquee sports network": "watchmarquee.com",
  sportsnet: "sportsnet.ca",
  nbcsp: "nbcsportsphiladelphia.com",
  "nbcs ba": "nbcsportsbayarea.com",
  nbcsca: "nbcsportsbayarea.com", // nbcsportscalifornia.com redirects here (shared NBC RSN site)
  "sportsnet la": "spectrumsportsnet.com",
  "space city home network": "spacecityhn.com",
  "sportsnet pittsburgh": "sportsnetpgh.com",
  chsn: "chsn.com",

  // Fights vertical (UFC/boxing) — live-broadcast and replay channels.
  // "TNT Sports 1/2" hit the existing "tnt sports" key via the trailing-
  // number strip; "Sky Sports Action" etc. need their own keys since only
  // digits are stripped, not words.
  "cbs sports network": "cbssports.com",
  "fight network": "fightnetwork.com",
  "sky sports action": "skysports.com",
  "sky sports main event": "skysports.com",
  "espn+": "espn.com",
  "probox tv": "proboxtv.com",
  "amazon prime": "primevideo.com",
  "tiktok live": "tiktok.com",
  "arena sport": "arenasport.com",
  "setana sports": "setantasports.com",
  "strike tv": "striketv.com",
  "voyo": "voyo.cz",
  rmc: "rmcsport.bfmtv.com",
  bild: "bild.de",
  sony: "sonyliv.com",
  "u next": "video.unext.jp",
  astro: "astro.com.my",
  mbc: "mbc.net",
  begin: "begin.watch",
  tvp: "tvp.pl",
  "sport tv": "sporttv.pt",
  "starhub tv": "starhub.com",
  mono: "monomax.me",
  "s sport plus": "ssportplus.com",
  "fpt play": "fptplay.vn",
  charlton: "charlton.co.il",
  migu: "migu.cn",
  yandex: "yandex.com",

  // Football catch-up channels. Same rule as the Sky entries above — the
  // word-suffixed variants each need their own key, while "TNT Sports 1-4"
  // and "Premier Sports 1/2" already resolve via the trailing-number strip.
  "sky sports premier league": "skysports.com",
  "sky sports football": "skysports.com",
  "bein sports en español": "beinsports.com",
  "bein sports canada": "beinsports.com",

  // Latin American catch-up channels. The trailing-number strip already
  // collapses "ESPN 2 Argentina" and "ESPN 3 Argentina" onto the same key
  // as "ESPN Argentina", so one entry per country covers the whole family —
  // but the country word itself is NOT stripped, and neither are accents,
  // so these keys have to carry them exactly as they normalise.
  "espn argentina": "espn.com",
  "espn méxico": "espn.com",
  "espn brasil": "espn.com",
  "azteca deportes": "aztecadeportes.com",
  "tudn méxico": "tudn.com",
  "fox sports méxico": "foxsports.com.mx",
  "espn norte": "espn.com",
  "fox sports argentina": "foxsports.com.ar",
  "tnt sports argentina": "tntsports.com.ar",
  "sky sports méxico": "sky.com.mx",
  "tvc deportes": "tvcdeportes.com",
  deportv: "deportv.gob.ar",
  "américa sports": "america.tv",
  globo: "globo.com",
  band: "band.uol.com.br",
  "record tv": "recordtv.r7.com",
  nsports: "nsports.com.br",
  // Iberian catch-up channels. "SPORT TV 1"-"SPORT TV 5" all collapse onto
  // the same key via the trailing-number strip, but "SPORT TV+" keeps its
  // plus (only digits are stripped) and "Esport3" keeps its 3 (the digit is
  // attached to the word, so there's no word boundary for the strip to find).
  // Gol TV is deliberately absent — its Spanish operator's domain wasn't
  // confirmed, and a monogram beats a guessed logo.
  // Italy. "Sky Sport 251/252/253" collapse onto the bare "sky sport" key via
  // the trailing-number strip; the named siblings need their own. Note this
  // is Sky ITALIA ("Sky Sport", singular) — distinct from the UK's "Sky
  // Sports", which is already mapped to skysports.com above.
  "sky sport": "sky.it",
  "sky sport calcio": "sky.it",
  "sky sport football": "sky.it",
  "sky sport uno": "sky.it",
  "sky sport arena": "sky.it",
  "dazn italia": "dazn.com",
  "sport tv": "sporttv.pt",
  "sport tv+": "sporttv.pt",
  "bein sports españa": "beinsports.com",
  "movistar deportes": "movistar.es",
  // Spain's football tier via FormulaTV. The trailing-number strip collapses
  // "M. Liga de Campeones 2/3" onto the base key, and "LaLiga TV 2" onto
  // "laliga tv". Gol's own site is gol.tv; the rest are Movistar or DAZN
  // properties and use those brands' domains.
  "laliga tv": "movistar.es",
  "m. liga de campeones": "movistar.es",
  "m. copa del rey": "movistar.es",
  vamos: "movistar.es",
  "fútbol replay": "movistar.es", // accent kept: normalizeChannelName lowercases but does not strip accents
  "dazn laliga": "dazn.com",
  // From LaLiga's own API. "Orange Fútbol 1" loses its digit to
  // normalizeChannelName but keeps its accent, and "DAZN EN ABIERTO" is the
  // free-to-air match — a distinction no third-party guide publishes.
  "dazn en abierto": "dazn.com",
  "movistar laliga": "movistar.es",
  // futbolenlatv.es writes Movistar's channels with the "M+" prefix.
  "m+ liga de campeones": "movistar.es",
  "m+ vamos": "movistar.es",
  "m+ #vamos bar": "movistar.es",
  "m+ laliga": "movistar.es",
  "m+ deportes": "movistar.es",
  // Germany and Austria via tvinfo.de. "Sky Fussball Bundesliga" and "Sky
  // Sport Austria" both need their own keys — neither collapses onto the
  // "sky sport" key above, and that key is Sky ITALIA's domain anyway, so
  // they must not be allowed to fall through to it. Note "sport1" and
  // "sportdigital1+" keep their digits: the digit is attached to the word,
  // so the trailing-number strip finds no word boundary to cut at.
  "dazn deutschland": "dazn.com",
  "sky fussball bundesliga": "sky.de",
  "sky sport austria": "skysportaustria.at",
  sport1: "sport1.de",
  "sportdigital1+": "sportdigital.de",
  tv5monde: "tv5monde.com",
  "orange fútbol": "orange.es",
  orange: "orange.es", // Orange holds the UEFA club competitions in Spain
  gol: "gol.tv",
  teledeporte: "rtve.es",
  esport3: "ccma.cat",
  "fox deportes": "foxdeportes.com",
  univision: "univision.com",
  unimás: "unimas.com",
  unimas: "unimas.com",
};

// Strips parenthetical notes, trailing channel-number codes, and "YouTube"
// suffixes that don't change the underlying brand, then lowercases/trims.
export function normalizeChannelName(name) {
  return (name || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\b\d[\d/]*\b/g, "")
    .replace(/\s+youtube$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function channelDomainFor(name) {
  return CHANNEL_DOMAINS[normalizeChannelName(name)] ?? null;
}

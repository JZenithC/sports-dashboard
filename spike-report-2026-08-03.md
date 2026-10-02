# Discovery Spike Report — 2026-08-03

Single-day snapshot. Lead-time conclusions (how far out Brazilian PPV channels get
confirmed) need a few more runs of this script across the coming week — see spec's
build order step 1.

## Scraper results

| Source | Total entries | With a real channel | TBC / blank |
|---|---|---|---|
| Brazil (futebolnatv.com.br) | 17 | 17 | 0 |
| Argentina (futbolenvivoargentina.com) | 448 | 419 | 29 |
| Mexico (futbolenvivomexico.com) | 438 | 428 | 10 |

### Notes
- **Brazil**: only `/jogos-hoje/` and `/jogos-amanha/` routes exist on futebolnatv.com.br
  (confirmed via site nav — no further-forward date routes). This scraper structurally
  cannot see beyond ~2 days ahead from this source, which may itself be evidence for the
  spec's lead-time assumption (channels aren't listed further out because they aren't
  known yet).
- **Argentina / Mexico**: confirmed same underlying platform/template (identical
  robots.txt, identical table markup). One shared scraper (`scrape-nuxt-platform.js`)
  handles both. Their homepage listing already spans several weeks forward (grouped into
  today/tomorrow/3-day/6-day/9-day+ buckets), covering the whole 7-day window in one fetch.
  Channel field explicitly renders "Canal por confirmar" (TBC) as a placeholder list item
  rather than leaving the cell empty — handled by treating that exact string as "no channel
  yet".
- Per robots.txt, only homepage listings were fetched on all three sites — no per-match,
  per-team, or per-date subpages (those are disallowed on the ARG/MX platform, and querying
  them wasn't needed for BR either).

## Match rate (scraped channel entries → TheSportsDB fixtures)

- **Brazil**: 1/17 scraped entries matched a fixture (5.9%)
- **Argentina**: 1/448 scraped entries matched a fixture (0.2%)
- **Mexico**: 1/438 scraped entries matched a fixture (0.2%)

**Read this % carefully — it is not yet meaningful as a quality signal.** Scope is
deliberately Americas-only right now: 5 domestic
leagues/cups (Brasileirão, Argentine Primera División, Liga MX, Copa do Brasil, Copa Argentina) plus 2 CONMEBOL club competitions (Copa Libertadores, Copa Sudamericana, filtered to fixtures involving a Brazilian/Argentine/Mexican club). Scraped sites
list dozens of other leagues we haven't wired fixtures for at all (Uruguayan league, Copa
Paulista, Leagues Cup, CONCACAF competitions, etc — out of scope for now). So a near-0% rate
here reflects **fixture-source league coverage**, not matching quality. The one real hit each
in Argentina/Mexico (the Platense vs Talleres de Córdoba match) confirms the name+time
matching logic itself works correctly when a fixture actually exists to match against — that
took a real fix during this spike: the ARG/MX platform's schema.org `startDate` meta has a
correct date but an unreliable time-of-day (consistently off from both the rendered page text
and TheSportsDB's independently-reported kickoff time), so the matcher now trusts the meta's
date + the rendered local time instead of the full meta timestamp.

A second real case surfaced here and is now fixed: the Copa do Brasil fixture "Athletico
Paranaense vs Vitória" pulls correctly and now links up with futebolnatv.com.br's scraped
"Athletico PR vs Vitória" — added to team-aliases.js, plus a rule change (normalizeTeam no
longer blindly strips "atletico"/"athletic", since those are often the only thing
distinguishing two real, different clubs — e.g. Atlético-MG vs Atlético-GO vs Athletico
Paranaense — so stripping them was actively causing bad matches, not just missed ones).

### Sample unmatched entries (first 15)
- Brazil: Sarmiento Junin vs Independ. Rivadavia (Campeonato Argentino)
- Brazil: Flamengo (F) vs Corinthians (F) (Brasileirão Feminino)
- Brazil: Defensor Sporting vs Cerro (Campeonato Uruguaio)
- Brazil: Gremio Prudente vs Linense (Copa Paulista)
- Brazil: Huracan vs Atletico Tucuman (Campeonato Argentino)
- Brazil: Juventude vs Atlético-MG (Copa Do Brasil)
- Brazil: Columbus Crew vs Atlas (Leagues Cup)
- Brazil: FC Cincinnati vs Pachuca (Leagues Cup)
- Brazil: Charlotte vs U.N.A.M. - Pumas (Leagues Cup)
- Brazil: Plaza Amador vs Firpo (CONCACAF Central American Cup)
- Brazil: Remo vs Santos (Copa Do Brasil)
- Brazil: Minnesota United FC vs FC Juarez (Leagues Cup)
- Brazil: Tigres UANL vs Real Salt Lake (Leagues Cup)
- Brazil: Antigua GFC vs Real Esteli (CONCACAF Central American Cup)
- Brazil: Diriangen vs LD Alajuelense (CONCACAF Central American Cup)

## Open items from the spec still unresolved by this spike
- European leagues/cups are out of scope for now (per current instructions) — will need
  re-adding to fetch-fixtures.js once the Americas-only path is fully working.
- No current Mexican domestic cup equivalent to Copa do Brasil/Copa Argentina exists
  (Copa MX was discontinued in 2018-19) — confirmed absent, not just unwired.
- Exact lead-time curve — needs re-runs on subsequent days.
- Matching engine hardening (accent/alias tables, better name normalization) — step 2 of the build order.

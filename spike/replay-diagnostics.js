// Per-channel accounting for the football catch-up pipeline — why an airing
// that was fetched never became a row.
//
// The build already logged "1151 fetched, 194 attributed", which says a loss
// happened but nothing about where or why. That gap is not academic: Liga MX
// showed zero rows for days while TUDN was demonstrably re-airing Liga MX
// matches, and finding out why took a bespoke investigation. Worse, a channel
// whose listing format quietly changes looks exactly like a channel having a
// quiet week — source health reports a scraper is REACHABLE, not that it is
// still WORKING.
//
// So every airing is counted at the point it is discarded, per channel:
//
//   fetched      raw programmes seen on the channel
//   notFootball  filtered out as another sport
//   unparsed     looked like football but named no two teams
//   live         the live broadcast, which belongs on the fixture, not here
//   archive      old-season programming (includes the Spanish season guard)
//   untracked    two teams that match no tracked competition
//   window       the right two teams, but no fixture within 2h-7d of the air
//   duplicate    same channel and air time already listed
//   attributed   became a row in the catch-up view, pinned to a tracked match
//   supplemented became a Brazil catch-up row from Guia de TV's native VT flag
//
// Reading these numbers, calibrated against the first real run:
//  - `notFootball` and `untracked` dominating is healthy — that is the
//    pipeline doing its job, and on general-entertainment channels that also
//    carry football (Globo, Record TV, Band) it is nearly everything.
//  - `unparsed` is NOT automatically a bug. Sky Sports Premier League showed
//    51 on the first run, and all of them were studio and archive programming
//    that genuinely names no teams — "Premier League Review", "100 Club",
//    "Sky Sports FC", "Good Morning Transfers". **The signal is a CHANGE on a
//    channel that was producing rows, not the absolute level.**
//  - A channel with `fetched > 0` and `attributed === 0` is the one to look
//    at, which is why the build log lists exactly those.
const tally = new Map();

const REASONS = ["notFootball", "unparsed", "live", "archive", "untracked", "window", "duplicate"];

function row(channel, source = null) {
  let entry = tally.get(channel);
  if (!entry) {
    entry = { channel, source, fetched: 0, parsed: 0, attributed: 0, supplemented: 0, drops: {} };
    tally.set(channel, entry);
  }
  // The fetch phase knows which layer a channel belongs to; correlation,
  // which runs later and only sees an airing's channel name, does not.
  if (source && !entry.source) entry.source = source;
  return entry;
}

export function noteFetched(source, channel) {
  row(channel, source).fetched++;
}

export function noteParsed(channel) {
  row(channel).parsed++;
}

export function noteDrop(channel, reason) {
  const entry = row(channel);
  entry.drops[reason] = (entry.drops[reason] ?? 0) + 1;
}

export function noteAttributed(channel) {
  row(channel).attributed++;
}

export function noteSupplemented(channel) {
  row(channel).supplemented++;
}

/** One record per channel, richest first, for health.json. */
export function replayDiagnostics() {
  return [...tally.values()].sort(
    (a, b) => (b.attributed + b.supplemented) - (a.attributed + a.supplemented) || b.fetched - a.fetched
  );
}

/**
 * Build-log summary. Deliberately prints the channels that produced NOTHING
 * despite fetching programmes — the ones that are either legitimately quiet
 * or quietly broken, which is exactly the distinction worth eyeballing.
 */
export function logReplayDiagnostics() {
  const rows = replayDiagnostics();
  if (!rows.length) return;
  const sum = (k) => rows.reduce((t, r) => t + (r[k] ?? 0), 0);
  const listed = sum("attributed") + sum("supplemented");
  const drops = Object.fromEntries(REASONS.map((r) => [r, rows.reduce((t, x) => t + (x.drops[r] ?? 0), 0)]).filter(([, n]) => n));
  console.log(
    `Catch-up accounting: ${sum("fetched")} fetched, ${sum("parsed")} with a matchup, ${listed} listed` +
      ` — dropped: ${Object.entries(drops).map(([k, n]) => `${n} ${k}`).join(", ")}`
  );
  const silent = rows.filter((r) => r.fetched > 0 && r.attributed + r.supplemented === 0);
  if (silent.length) {
    console.log(`  ${silent.length} channel(s) fetched programmes but listed nothing:`);
    for (const r of silent) {
      const why = Object.entries(r.drops)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${n} ${k}`)
        .join(", ");
      console.log(`    ${r.channel.padEnd(26)} ${String(r.fetched).padStart(4)} fetched — ${why || "no drops recorded"}`);
    }
  }
}

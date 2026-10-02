// Per-sport update history — what changed between daily builds, for all
// three verticals rather than only football.
//
// The football side has had a changelog since early on (its "Recent
// updates" sidebar panel), but MLB and Fights had none, so a channel
// appearing or a card being cancelled was invisible. This generalises that
// diff so every sport reports the same three things: fixtures/cards added,
// removed, and broadcast changes.
//
// One shared differ works for all three because their event objects already
// share a shape — homeTeam / awayTeam / localDate / channels — whether the
// "teams" are clubs, ballclubs or two fighters.
//
// Written to public/data/updates.json as { generatedAt, sports: {...} }.
// Each build script appends only its own sport and leaves the others
// untouched, the same merge discipline source-health.js uses, because the
// four scripts are separate processes.
import fs from "fs";

const UPDATES_PATH = "public/data/updates.json";
const MAX_RUNS_PER_SPORT = 20;

function readJsonSafe(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const channelNames = (e) => {
  const flat = (e.channels ?? []).map((c) => c.name ?? c);
  const grouped = (e.broadcastGroups ?? []).flatMap((g) => (g.channels ?? []).map((c) => c.name ?? c));
  return [...new Set([...flat, ...grouped])].sort();
};

/**
 * Diffs one sport's events between two builds.
 *
 * `keyOf` must be stable across runs (it decides what counts as "the same
 * fixture"), and `describe` produces the human string shown in the UI.
 */
export function diffRuns(previousEvents, currentEvents, { keyOf, describe }) {
  const prev = new Map((previousEvents ?? []).map((e) => [keyOf(e), e]));
  const curr = new Map((currentEvents ?? []).map((e) => [keyOf(e), e]));

  const added = [];
  const removed = [];
  const channelsChanged = [];

  for (const [key, e] of curr) {
    if (!prev.has(key)) {
      added.push(describe(e));
      continue;
    }
    const before = channelNames(prev.get(key));
    const after = channelNames(e);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      channelsChanged.push(`${describe(e)}: [${after.join(", ") || "TBC"}]`);
    }
  }
  for (const [key, e] of prev) if (!curr.has(key)) removed.push(describe(e));

  return { timestamp: new Date().toISOString(), total: curr.size, added, removed, channelsChanged };
}

/** Appends one sport's entry, preserving the other sports' history. */
export function appendUpdates(sport, entry) {
  const existing = readJsonSafe(UPDATES_PATH) ?? { sports: {} };
  const sports = existing.sports ?? {};
  sports[sport] = [entry, ...(sports[sport] ?? [])].slice(0, MAX_RUNS_PER_SPORT);
  fs.mkdirSync("public/data", { recursive: true });
  fs.writeFileSync(UPDATES_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), sports }, null, 2), "utf8");
  console.log(`Updates (${sport}): +${entry.added.length} -${entry.removed.length} ~${entry.channelsChanged.length}`);
}

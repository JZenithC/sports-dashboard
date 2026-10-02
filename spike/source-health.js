// Source health tracking — so a broken scraper is visible in the app
// instead of only in a build log nobody reads.
//
// Every data source registers its outcome here during a build, and the
// result is merged into public/data/health.json. The frontend renders it as
// a status chip in the header (green when everything is fine, amber/red
// when something is failing), which expands into a per-source list.
//
// Merged, not overwritten: the four build scripts run as separate processes
// (build-data, build-standings, build-mlb, build-fights) and each records
// only its own sources, so writing the file wholesale would erase the
// others' entries. `lastOkAt` is carried across runs too, which is what
// turns "failing" into the far more useful "failing since Tuesday".
import fs from "fs";

const HEALTH_PATH = "public/data/health.json";

const recorded = new Map();

/**
 * Record one source's outcome.
 *
 * `ok: false` means the source produced nothing usable. A source that
 * partially failed (say 2 of 18 channels erroring) is still `ok: true` but
 * carries a `degraded` count, because the pipeline genuinely did its job —
 * flagging that as a hard failure would train the eye to ignore the chip.
 */
export function recordSource(id, { label, group, ok, error = null, items = null, channelsOk = null, channelsTotal = null }) {
  recorded.set(id, {
    id,
    label,
    group,
    ok,
    error: error ? String(error).slice(0, 300) : null,
    items,
    channelsOk,
    channelsTotal,
    degraded: channelsTotal != null && channelsOk != null && channelsOk < channelsTotal,
  });
}

/** Wraps a source fetch so any throw is recorded rather than lost. */
export async function trackSource(id, meta, fn) {
  try {
    const result = await fn();
    recordSource(id, { ...meta, ok: true, items: Array.isArray(result) ? result.length : null });
    return result;
  } catch (err) {
    recordSource(id, { ...meta, ok: false, error: err?.message ?? err });
    throw err;
  }
}

// Per-channel accounting for the catch-up pipeline (see
// spike/replay-diagnostics.js). Only build-data records this, so writeHealth
// carries the previous file's copy forward when the running process has none
// — the same merge discipline sources[] needs, for the same reason: four
// separate build processes share one file.
let channelDiagnostics = null;

export function setChannelDiagnostics(rows) {
  channelDiagnostics = rows;
}

const MAX_INCIDENTS = 60;

// A rolling log of every scraping failure, not just the current state.
// The sources[] list answers "is anything broken right now"; this answers
// "what has broken, when, and is it still broken" — which is what you need
// to report a problem that has since self-healed. One incident spans the
// whole outage: it opens when a source starts failing and closes when it
// next succeeds, rather than appending an identical row every single build.
function updateIncidents(previousIncidents, now) {
  const incidents = [...(previousIncidents ?? [])];
  const openFor = (id) => incidents.find((i) => i.id === id && !i.resolvedAt);
  for (const entry of recorded.values()) {
    const open = openFor(entry.id);
    const state = !entry.ok ? "down" : entry.degraded ? "degraded" : "ok";
    if (state === "ok") {
      if (open) open.resolvedAt = now;
      continue;
    }
    if (open && open.state === state && open.error === entry.error) {
      open.lastSeenAt = now; // same failure continuing — extend, don't duplicate
      continue;
    }
    if (open) open.resolvedAt = now; // the failure changed shape; close and reopen
    incidents.unshift({
      id: entry.id,
      label: entry.label,
      group: entry.group,
      state,
      error: entry.error,
      startedAt: now,
      lastSeenAt: now,
      resolvedAt: null,
    });
  }
  return incidents.slice(0, MAX_INCIDENTS);
}

export function writeHealth() {
  if (!recorded.size) return;
  const now = new Date().toISOString();
  let previous = { sources: [] };
  try {
    previous = JSON.parse(fs.readFileSync(HEALTH_PATH, "utf8"));
  } catch {
    // First run, or the file was removed — start clean.
  }
  const incidents = updateIncidents(previous.incidents, now);
  const byId = new Map((previous.sources ?? []).map((s) => [s.id, s]));
  for (const entry of recorded.values()) {
    const prior = byId.get(entry.id);
    byId.set(entry.id, {
      ...entry,
      checkedAt: now,
      // Only advances on a good run, so the UI can say how long something
      // has been broken.
      lastOkAt: entry.ok ? now : (prior?.lastOkAt ?? null),
    });
  }
  // Drop sources nothing has reported on for a day and a half. The merge
  // above deliberately preserves entries this process didn't record, because
  // the four build scripts each own a different set — but that also means a
  // source DELETED from the code would sit here forever still claiming
  // "ok", which is a lie in the one panel that exists to be trusted (the
  // removed GatoTV layer did exactly that). Every live source is re-recorded
  // on every daily run whether it succeeds or fails, so a stale entry means
  // we genuinely have no current status for it. 36h tolerates one missed run.
  const STALE_MS = 36 * 3600000;
  const sources = [...byId.values()]
    .filter((s) => {
      const fresh = !s.checkedAt || Date.now() - Date.parse(s.checkedAt) < STALE_MS;
      if (!fresh) console.log(`Source health: dropping stale entry "${s.label}" (not reported since ${s.checkedAt})`);
      return fresh;
    })
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  fs.mkdirSync("public/data", { recursive: true });
  fs.writeFileSync(
    HEALTH_PATH,
    JSON.stringify({ generatedAt: now, sources, incidents, channels: channelDiagnostics ?? previous.channels ?? [] }, null, 2),
    "utf8"
  );

  const bad = sources.filter((s) => !s.ok);
  const degraded = sources.filter((s) => s.ok && s.degraded);
  console.log(
    `Source health: ${sources.length - bad.length}/${sources.length} ok` +
      (degraded.length ? `, ${degraded.length} degraded` : "") +
      (bad.length ? ` — FAILING: ${bad.map((s) => s.label).join(", ")}` : "")
  );
}

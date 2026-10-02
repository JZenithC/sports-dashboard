// Synced "have I watched this" store, so a game checked off on one device
// shows the same flag on every other device the dashboard is opened on —
// plain localStorage wouldn't follow you across devices/browsers, which
// defeats the point of a watch-tracker (the user: "synced across devices, not
// sure how it could be any other way").
//
// Storage: one JSON blob (Vercel Blob) mapping watchKey -> ISO timestamp
// watched. Matches this project's existing "flat JSON, no heavier than
// necessary" storage philosophy (see CLAUDE.md's Architecture section)
// rather than standing up a database for a few dozen small records.
//
// Requires BLOB_READ_WRITE_TOKEN, which Vercel sets automatically once a
// Blob store is connected to this project (Storage tab in the dashboard) —
// nothing to commit here.
//
// Reads and writes go through get()/put() with access: "public" — confirmed
// against the real deployed error, not assumed: the store IS Public (as
// originally set up), and the SDK rejects access: "public" outright on a
// Public store ("Cannot use private access on a public store") rather than
// silently working around the mismatch, which is what an intermediate
// version of this file got wrong.
//
// No auth check in this file: middleware.js does NOT exclude this path
// (unlike /api/refresh, which needs excluding for its own Bearer check), so
// it already sits behind the site's Basic Auth gate.
import { put, get } from "@vercel/blob";

const BLOB_PATH = "watched.json";

async function readWatched() {
  const result = await get(BLOB_PATH, { access: "public" });
  if (!result) return {}; // nothing written yet — expected on first run, not a failure
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

async function writeWatched(data) {
  await put(BLOB_PATH, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export default async function handler(request, response) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return response.status(500).json({ error: "BLOB_READ_WRITE_TOKEN is not set" });
  }

  try {
    if (request.method === "GET") {
      const watched = await readWatched();
      return response.status(200).json({ watched });
    }

    if (request.method === "POST") {
      const { key, watched: isWatched } = request.body ?? {};
      if (!key || typeof key !== "string") {
        return response.status(400).json({ error: "key is required" });
      }
      const data = await readWatched();
      if (isWatched === false) {
        delete data[key];
      } else {
        data[key] = new Date().toISOString();
      }
      await writeWatched(data);
      return response.status(200).json({ watched: data });
    }

    return response.status(405).json({ error: "method not allowed" });
  } catch (err) {
    // Surfaced in the response body (not just logged) — a personal,
    // single-user, Basic-Auth-gated tool, so an actionable error beats a
    // silently-reverted checkbox with no clue why.
    console.error("watched.js error:", err);
    return response.status(500).json({ error: err.message });
  }
}

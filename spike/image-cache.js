// Downloads and self-hosts logo images into public/logos/, instead of
// hotlinking third-party URLs directly in the browser.
//
// This exists because static.futebolnatv.com.br enforces referer-based
// hotlink protection — it 403s any request whose Referer isn't its own site,
// which real browsers send automatically when loading an <img> from our page.
// That made some team logos silently fail in real Chrome even though they'd
// loaded fine in earlier testing (CDN edge-cache state can mask this
// intermittently, which is exactly what made it hard to spot). Fetching
// server-side — where we control the Referer — sidesteps that entirely, and
// self-hosting means the dashboard never depends on any third party's file
// staying reachable or unprotected.
//
// Downloaded files are cached on disk by content hash of the source URL, so
// re-running the build doesn't re-fetch anything already saved.

import fs from "fs";
import path from "path";
import crypto from "crypto";

function extFromContentType(contentType) {
  if (!contentType) return ".png";
  if (contentType.includes("svg")) return ".svg";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  return ".png";
}

function hashOf(input) {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 20);
}

const memoFailed = new Set();

/**
 * Downloads `url` (with the given Referer/User-Agent) into
 * public/logos/<subdir>/, unless a cached copy already exists. Returns the
 * root-relative path to use in the UI (e.g. "/logos/teams/xyz.png"), or null
 * if the fetch failed (caller should fall back to a monogram).
 */
export async function cacheImage(url, { subdir, referer, cacheKey } = {}) {
  if (!url) return null;
  if (memoFailed.has(url)) return null;

  const key = cacheKey ?? hashOf(url);
  const dir = path.join("public", "logos", subdir);
  fs.mkdirSync(dir, { recursive: true });

  const existing = fs.readdirSync(dir).find((f) => f.startsWith(key + "."));
  if (existing) return `/logos/${subdir}/${existing}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        ...(referer ? { Referer: referer } : {}),
      },
    });
    if (!res.ok) {
      memoFailed.add(url);
      return null;
    }
    const contentType = res.headers.get("content-type");
    const ext = extFromContentType(contentType);
    const buf = Buffer.from(await res.arrayBuffer());
    const filePath = path.join(dir, `${key}${ext}`);
    fs.writeFileSync(filePath, buf);
    return `/logos/${subdir}/${key}${ext}`;
  } catch (err) {
    memoFailed.add(url);
    return null;
  }
}

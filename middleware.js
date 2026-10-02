// Vercel Routing Middleware — gates the entire site behind a signed session
// cookie, set by /api/login after checking BASIC_AUTH_USER/PASSWORD.
// Framework-agnostic (this is a plain static site, not Next.js), using
// @vercel/functions' next() helper to continue to the actual static file
// once the cookie checks out. See public/index.html and data/build for the
// site itself; this file only exists for the access gate.
//
// Replaced plain HTTP Basic Auth (2026-08-20). Basic Auth's credential
// cache lives only for the browser process's lifetime, not persisted like a
// cookie, so it re-prompted on every real restart — constant on Android,
// where the OS kills backgrounded browser processes routinely — and
// Chrome's password manager doesn't autofill the native Basic Auth popup
// the way it autofills a real login form. The user: "why does it ask for login
// details every time I restart... I have the details saved in Google
// passwords. It's annoying." A signed cookie with a 1-year Max-Age survives
// actual restarts, and a real <form> at /login.html gets proper Google
// Password Manager autofill.
//
// Still uses the SAME BASIC_AUTH_USER / BASIC_AUTH_PASSWORD env vars (set
// in the Vercel dashboard, never committed here) — no new secret to manage,
// and changing the password anywhere invalidates every existing session
// automatically, since the cookie's value is an HMAC over those exact
// credentials (see sessionToken() below, duplicated in api/login.js since
// Edge middleware can't import from api/).

import { next } from "@vercel/functions";

// /api/refresh (its own Bearer $CRON_SECRET check), /api/login and
// /login.html (the unauthenticated login flow itself — excluding it here is
// what avoids a redirect loop) all bypass this gate.
export const config = {
  matcher: "/((?!favicon.ico|api/refresh|api/login|login.html).*)",
};

async function sessionToken() {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(process.env.BASIC_AUTH_PASSWORD ?? ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(process.env.BASIC_AUTH_USER ?? ""));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getCookie(request, name) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// A real page load gets redirected to the login page; anything else (the
// app's own fetch() calls for /data/*.json and /api/watched) just gets a
// 401, same as Basic Auth did — those already have their own "failed to
// load" handling and redirecting a fetch() response would just break in a
// more confusing way. Sec-Fetch-Dest is what Chrome actually sends (checked
// against a real request in this project's own traffic), with an Accept
// fallback for anything that doesn't send Fetch Metadata headers.
function looksLikePageLoad(request) {
  const dest = request.headers.get("sec-fetch-dest");
  if (dest) return dest === "document";
  return (request.headers.get("accept") ?? "").includes("text/html");
}

export default async function middleware(request) {
  const cookie = getCookie(request, "session");
  if (cookie && cookie === (await sessionToken())) {
    return next();
  }

  if (looksLikePageLoad(request)) {
    const url = new URL(request.url);
    const redirect = encodeURIComponent(url.pathname + url.search);
    return Response.redirect(new URL(`/login.html?redirect=${redirect}`, url), 302);
  }
  return new Response("Authentication required.", { status: 401 });
}

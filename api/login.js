// Verifies the login form at public/login.html against the same
// BASIC_AUTH_USER/BASIC_AUTH_PASSWORD env vars Basic Auth used, and on
// success sets the signed session cookie middleware.js checks — see that
// file for why this replaced Basic Auth.
//
// The cookie's value is an HMAC over the current credentials (sessionToken
// below, duplicated in middleware.js — Edge middleware can't import from
// api/, and both need the exact same Web Crypto call), not the password
// itself, and not a random per-login token: no session store exists to
// revoke it against, so changing BASIC_AUTH_PASSWORD in the Vercel
// dashboard is what invalidates every existing session, which is enough
// for a personal, single-user, non-commercial dashboard.
//
// Deliberately no rate-limiting/lockout — same posture Basic Auth already
// had, not worth the complexity for this threat model.
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

// Only ever redirect back within this site — an absolute or protocol-
// relative value here would be an open-redirect hole.
function safeRedirectPath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

// The login form posts as ordinary application/x-www-form-urlencoded (a
// plain <form>, no JS submit handler). Vercel's Node functions parse that
// into request.body automatically, same as they already do for JSON in
// api/watched.js — but unlike that route, this one guards production
// access with no fallback once Basic Auth is gone, so a string body (a
// content-type Vercel didn't recognize) is parsed here rather than trusted
// to already be an object.
function parseBody(body) {
  if (body && typeof body === "object") return body;
  if (typeof body === "string") return Object.fromEntries(new URLSearchParams(body));
  return {};
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "method not allowed" });
  }

  const { username, password, redirect } = parseBody(request.body);
  const target = safeRedirectPath(redirect);

  if (username !== process.env.BASIC_AUTH_USER || password !== process.env.BASIC_AUTH_PASSWORD) {
    response.setHeader("Location", `/login.html?error=1&redirect=${encodeURIComponent(target)}`);
    return response.status(302).end();
  }

  const token = await sessionToken();
  // A year, not a session cookie — the whole point is surviving actual
  // browser/app restarts, which is what Basic Auth's process-lifetime cache
  // never did.
  response.setHeader("Set-Cookie", `session=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
  response.setHeader("Location", target);
  return response.status(302).end();
}

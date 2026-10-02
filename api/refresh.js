// Punctual trigger for the daily data refresh.
//
// GitHub's own `schedule` cron is not punctual, and this was measured rather
// than assumed: across eight consecutive days the "13 6 * * *" trigger in
// refresh-data.yml created its run between 1h55m and 6h18m late — every single
// day, never on time. On all eight, `created_at` equals `run_started_at`, so
// the wait is GitHub queueing the run globally, not waiting for a runner, and
// no choice of minute avoids it (06:00 -> 06:13 had already been tried).
//
// A `workflow_dispatch` starts immediately. So the Vercel cron in vercel.json
// calls this endpoint, and this endpoint dispatches the workflow. GitHub's own
// cron stays in the workflow as a backstop in case this ever stops firing.
//
// Two Production environment variables are required, set in the Vercel
// dashboard (Settings > Environment Variables) and never committed here:
//   CRON_SECRET       Vercel automatically sends this as an
//                     `Authorization: Bearer <value>` header on every cron
//                     invocation, so nothing else can trigger a refresh.
//   GH_DISPATCH_TOKEN A fine-grained GitHub token scoped to this repository
//                     with the "Actions: Read and write" permission.
//
// Note middleware.js deliberately excludes this path from the site's Basic
// Auth gate — the cron sends a Bearer token, not Basic credentials, and the
// check below is this route's own gate.
const REPO = "JZenithC/sports-dashboard";
const WORKFLOW = "refresh-data.yml";

export default async function handler(request, response) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.authorization !== `Bearer ${secret}`) {
    return response.status(401).json({ error: "unauthorized" });
  }

  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) {
    return response.status(500).json({ error: "GH_DISPATCH_TOKEN is not set" });
  }

  const dispatch = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );

  // 204 No Content is the documented success response for a dispatch.
  if (dispatch.status !== 204) {
    // Logged rather than swallowed: Vercel will not retry a failed cron, so
    // the runtime log is the only trace of why a refresh never happened.
    console.error(`workflow dispatch failed: HTTP ${dispatch.status} ${await dispatch.text()}`);
    return response.status(502).json({ error: `github returned ${dispatch.status}` });
  }

  return response.status(200).json({ dispatched: WORKFLOW });
}

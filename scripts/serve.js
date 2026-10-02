// Minimal static file server for local viewing only — browsers block fetch()
// on file:// pages, so this is just enough to load public/index.html over
// http:// during development. Not the production hosting setup (that's
// Vercel) — this script won't be needed once deployed there, and doesn't
// simulate the Basic Auth middleware (see middleware.js), which only runs on
// Vercel.

import http from "http";
import fs from "fs";
import path from "path";

const PORT = 8787;
const ROOT = path.join(process.cwd(), "public");

// Images were relying on browser content-sniffing (they were served as
// application/octet-stream); declaring the real types keeps the local
// preview honest to what Vercel serves, .webp included (fight posters).
const MIME = {
  ".html": "text/html",
  ".json": "application/json",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

http
  .createServer((req, res) => {
    const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const filePath = path.join(ROOT, decodeURIComponent(urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found: " + urlPath);
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
      res.end(content);
    });
  })
  .listen(PORT, () => console.log(`Serving ${ROOT} at http://localhost:${PORT}/`));

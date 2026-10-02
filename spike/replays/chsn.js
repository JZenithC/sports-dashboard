// Official Chicago Sports Network schedule scraper for White Sox re-airs.
// CHSN is a real U.S. linear channel but is not present in TV Passport's
// station index, so its own server-rendered schedule is the authoritative
// source for the local replay slots we can safely list.
import * as cheerio from "cheerio";
import { zonedTimeToUTC } from "./tvpassport.js";

const URL = "https://vl.schedule.chsn.com/";
const ZONE = "America/Chicago";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

function parseChsnDateTime(dateValue, timeValue) {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue ?? "");
  const time = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(timeValue ?? "");
  if (!date || !time) return null;

  let hour = Number(time[1]);
  if (time[3].toUpperCase() === "AM") hour = hour === 12 ? 0 : hour;
  else if (hour !== 12) hour += 12;
  return zonedTimeToUTC(Number(date[1]), Number(date[2]), Number(date[3]), hour, Number(time[2]), 0, ZONE);
}

function parseMatchup(title) {
  const match = /^(.+?)\s+at\s+(.+?)\s+-\s+\d{1,2}\/\d{1,2}\/\d{2}(?:\s+\(Re-Air\))?$/i.exec(title);
  return match ? [match[1].trim(), match[2].trim()] : null;
}

export function parseChsnReplaysHtml(html) {
  const $ = cheerio.load(html);
  const out = [];
  $("tr[data-league='MLB'][data-content='Replay']").each((_, row) => {
    const dateValue = $(row).attr("data-date");
    const cells = $(row).find("td").map((__, cell) => $(cell).text().trim()).get();
    const [dateLabel, timeLabel, title, networkLabel] = cells;
    if (!dateLabel || !timeLabel || !title || !networkLabel) return;
    if (!networkLabel.split(",").map((name) => name.trim()).includes("CHSN")) return;
    const teams = parseMatchup(title);
    const airTime = parseChsnDateTime(dateValue, timeLabel);
    if (!teams || !airTime) return;
    out.push({ channel: "CHSN", zone: ZONE, airTimeUTC: airTime.toISOString(), durationMinutes: 180, teams });
  });
  return out;
}

export async function scrapeChsnReplays() {
  const res = await fetch(URL, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseChsnReplaysHtml(await res.text());
}

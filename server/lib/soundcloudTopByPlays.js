/**
 * Load all uploads for the authenticated user (/me/tracks).
 * "Recent" lists: public `sharing` + release date metadata (fallback: created_at), newest first.
 */

import { soundcloudGetUser } from "./soundcloud.js";

const MAX_PAGES = 20;

function normalizeCollection(body) {
  if (Array.isArray(body)) return body;
  if (body?.collection && Array.isArray(body.collection))
    return body.collection;
  if (body?.tracks && Array.isArray(body.tracks)) return body.tracks;
  return [];
}

/**
 * Paginate GET /me/tracks until no next_href (linked_partitioning).
 */
export async function fetchAllMeTracks() {
  const all = [];
  let nextPath = "/me/tracks?limit=200&linked_partitioning=1&offset=0";

  for (let page = 0; page < MAX_PAGES; page++) {
    const { status, body } = await soundcloudGetUser(nextPath);
    if (status !== 200) {
      throw new Error(
        `SoundCloud /me/tracks returned ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`,
      );
    }

    const chunk = normalizeCollection(body);
    all.push(...chunk);

    const nextHref =
      body?.next_href ||
      (typeof body === "object" && body !== null && "next" in body
        ? body.next
        : null);
    if (!nextHref || chunk.length === 0) break;

    const raw = String(nextHref).trim();
    nextPath = raw.startsWith("http")
      ? raw
      : `https://api.soundcloud.com${raw.startsWith("/") ? raw : `/${raw}`}`;
  }

  return all;
}

function permalinkForWidget(track) {
  if (track?.permalink_url && /^https?:\/\//i.test(track.permalink_url)) {
    return track.permalink_url;
  }
  if (track?.uri && String(track.uri).startsWith("https://")) {
    return track.uri;
  }
  return null;
}

/**
 * Recent list: only tracks that are publicly visible on SoundCloud.
 * `sharing` must be explicitly `"public"` (not `"private"`, not missing).
 */
function isPublicTrack(t) {
  if (!t || typeof t !== "object") return false;
  const s = String(t.sharing || "").toLowerCase();
  if (s === "private") return false;
  return s === "public";
}

/**
 * Parse `created_at` (upload time). SoundCloud uses ISO or legacy "2011/06/02 13:44:54 +0000".
 * @returns {number | null} epoch ms, or null if missing / invalid
 */
function createdAtMs(t) {
  const raw = t?.created_at;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let s = raw.trim();
  if (/^\d{4}\/\d{2}\/\d{2}/.test(s)) {
    s = s.replace(/\//g, "-");
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Public release date from SoundCloud metadata (`release_year` / `release_month` / `release_day`).
 * Month/day default to 1 when year is set but they are missing.
 * @returns {number | null} UTC midnight epoch ms, or null if no release year
 */
function releaseDateMs(t) {
  const y = t?.release_year;
  if (typeof y !== "number" || !Number.isFinite(y) || y < 1) return null;
  const m =
    typeof t?.release_month === "number" &&
    t.release_month >= 1 &&
    t.release_month <= 12
      ? t.release_month
      : 1;
  const d =
    typeof t?.release_day === "number" &&
    t.release_day >= 1 &&
    t.release_day <= 31
      ? t.release_day
      : 1;
  return Date.UTC(y, m - 1, d);
}

/** Prefer public release metadata; fall back to upload `created_at`. */
function sortDateMs(t) {
  return releaseDateMs(t) ?? createdAtMs(t);
}

/**
 * @returns {string | null} YYYY-MM-DD from release_* fields, else null
 */
function releaseDateIso(t) {
  const ms = releaseDateMs(t);
  if (ms == null) return null;
  const y = t.release_year;
  const m =
    typeof t?.release_month === "number" &&
    t.release_month >= 1 &&
    t.release_month <= 12
      ? t.release_month
      : 1;
  const d =
    typeof t?.release_day === "number" &&
    t.release_day >= 1 &&
    t.release_day <= 31
      ? t.release_day
      : 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Public tracks sorted by public release date (newest first).
 * Falls back to `created_at` when release_* metadata is missing.
 * Used by GET /api/soundcloud/recent-tracks.
 * @param {unknown[]} tracks
 * @param {number} limit
 * @returns {{ title: string, permalink_url: string, playback_count: number | null, release_date: string | null, created_at: string | null }[]}
 */
export function recentPublicTracks(tracks, limit) {
  const candidates = [...tracks]
    .filter((t) => isPublicTrack(t) && sortDateMs(t) != null)
    .sort((a, b) => sortDateMs(b) - sortDateMs(a));

  const out = [];
  for (const t of candidates) {
    if (out.length >= limit) break;
    const url = permalinkForWidget(t);
    if (!url) continue;
    out.push({
      title: typeof t?.title === "string" ? t.title : "",
      permalink_url: url,
      playback_count:
        typeof t?.playback_count === "number" ? t.playback_count : null,
      release_date: releaseDateIso(t),
      created_at: typeof t?.created_at === "string" ? t.created_at : null,
    });
  }
  return out;
}

/**
 * @param {unknown[]} tracks
 * @param {number} limit
 * @returns {{ title: string, permalink_url: string, playback_count: number | null }[]}
 */
export function topTracksByPlayback(tracks, limit) {
  const sorted = [...tracks].sort((a, b) => {
    const pa = Number(a?.playback_count) || 0;
    const pb = Number(b?.playback_count) || 0;
    return pb - pa;
  });

  const out = [];
  for (const t of sorted) {
    if (out.length >= limit) break;
    const url = permalinkForWidget(t);
    if (!url) continue;
    out.push({
      title: typeof t?.title === "string" ? t.title : "",
      permalink_url: url,
      playback_count:
        typeof t?.playback_count === "number" ? t.playback_count : null,
    });
  }
  return out;
}

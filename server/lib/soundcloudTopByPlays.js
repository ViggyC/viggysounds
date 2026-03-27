/**
 * Load all uploads for the authenticated user (/me/tracks), sort by playback_count.
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

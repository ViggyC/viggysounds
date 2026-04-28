/**
 * Artist catalog via Spotify Web API (Client Credentials).
 * Albums + singles pagination, then tracks per album — deduped by track id.
 */

import { spotifyGet } from "./spotify.js";

/** Page size for GET /albums/{id}/tracks only (max 50 — larger pages = fewer requests, less 429 risk). Omit `limit` on GET /artists/{id}/albums — Spotify returns 400 Invalid limit when `limit` is present (default pagination still works; use `next`). */
const SPOTIFY_PAGE_LIMIT = 50;

/** Successful catalog responses only; avoids hammering Spotify on refresh (default 5 min). Set SPOTIFY_CATALOG_CACHE_MS=0 to disable. */
const catalogResultCache = new Map();

/** Concurrent catalog builds for the same key share one promise (tabs / double-fetch). */
const catalogInflight = new Map();

function catalogCacheTtlMs() {
  const n = Number.parseInt(process.env.SPOTIFY_CATALOG_CACHE_MS || "300000", 10);
  if (!Number.isFinite(n) || n < 0) return 300_000;
  return Math.min(n, 3_600_000);
}

/**
 * Extra pause after each catalog Spotify call (ms). Default 0 — pacing is handled in spotify.js (SPOTIFY_REQUEST_MIN_GAP_MS).
 * Increase if you still see 429 while SPOTIFY_REQUEST_MIN_GAP_MS is already high.
 */
function catalogExtraGapMs() {
  const raw = process.env.SPOTIFY_CATALOG_GAP_MS;
  if (raw === undefined || raw === "") return 0;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(500, Math.max(0, n));
}

async function afterCatalogRequest() {
  const ms = catalogExtraGapMs();
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

function normalizeMarketCode(market) {
  if (typeof market !== "string") return "";
  const t = market.trim();
  return /^[a-z]{2}$/i.test(t) ? t.toUpperCase() : "";
}

function parseReleaseMs(iso) {
  if (typeof iso !== "string" || !iso.length) return 0;
  const y = Number.parseInt(iso.slice(0, 4), 10);
  if (!Number.isFinite(y)) return 0;
  if (iso.length <= 4) return Date.UTC(y, 0, 1);
  const d = Date.parse(iso);
  return Number.isFinite(d) ? d : Date.UTC(y, 0, 1);
}

function buildArtistAlbumsUrlPath(artistId, market) {
  const params = new URLSearchParams();
  params.set("include_groups", "album,single");
  const m = normalizeMarketCode(market);
  if (m) params.set("market", m);
  return `/artists/${encodeURIComponent(artistId)}/albums?${params.toString()}`;
}

/** Album tracks: `market` omitted unless valid — wrong values can break the request. */
function buildAlbumTracksUrlPath(albumId, market) {
  const params = new URLSearchParams();
  params.set("limit", String(SPOTIFY_PAGE_LIMIT));
  const m = normalizeMarketCode(market);
  if (m) params.set("market", m);
  return `/albums/${encodeURIComponent(albumId)}/tracks?${params.toString()}`;
}

function topTracksMarketParam(market) {
  if (typeof market !== "string") return "US";
  const t = market.trim();
  return /^[a-z]{2}$/i.test(t) ? t.toUpperCase() : "US";
}

/**
 * @param {string} artistId
 * @param {string} [market] ISO 3166-1 alpha-2
 * @returns {Promise<{ ok: true, tracks: object[] } | { ok: false, status: number, body: unknown }>}
 */
export async function fetchArtistTopTracks(artistId, market) {
  const m1 = topTracksMarketParam(market);
  const path = (m) =>
    `/artists/${encodeURIComponent(artistId)}/top-tracks?market=${encodeURIComponent(m)}`;

  let { status, body } = await spotifyGet(path(m1));
  /* Some regions return 403 for top-tracks; US is the most reliable market for Client Credentials. */
  if (status === 403 && m1 !== "US") {
    console.warn(
      `[spotifyArtistTracks] top-tracks HTTP 403 for market=${m1}, retrying with market=US`,
    );
    ({ status, body } = await spotifyGet(path("US")));
  }

  if (status !== 200) return { ok: false, status, body };
  const raw = Array.isArray(body?.tracks) ? body.tracks : [];
  const tracks = raw.map((t) => mapTrackForResponse(t, null));
  return { ok: true, tracks };
}

/**
 * GET /tracks?ids= — for when top-tracks returns 403 (dev-mode apps; Nov 2024 API policy).
 * @param {string[]} trackIds in desired order (max 50)
 */
export async function fetchTracksByIds(trackIds) {
  const unique = [];
  const seen = new Set();
  for (const id of trackIds) {
    if (
      typeof id !== "string" ||
      !/^[a-zA-Z0-9]{16,24}$/.test(id)
    )
      continue;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length >= 50) break;
  }
  if (unique.length === 0) {
    return {
      ok: false,
      status: 400,
      body: { error: { message: "no valid track ids" } },
    };
  }
  const { status, body } = await spotifyGet(
    `/tracks?ids=${encodeURIComponent(unique.join(","))}`,
  );
  if (status !== 200) return { ok: false, status, body };
  const arr = Array.isArray(body?.tracks) ? body.tracks : [];
  const byId = new Map();
  for (const t of arr) {
    if (t?.id) byId.set(t.id, mapTrackForResponse(t, null));
  }
  const tracks = unique.map((id) => byId.get(id)).filter(Boolean);
  return { ok: true, tracks };
}

function mapTrackForResponse(track, albumCtx) {
  const artists = Array.isArray(track?.artists)
    ? track.artists.map((a) => ({
        id: a?.id ?? null,
        name: typeof a?.name === "string" ? a.name : "",
      }))
    : [];
  const album =
    albumCtx ||
    (track?.album
      ? {
          id: track.album.id ?? null,
          name: typeof track.album.name === "string" ? track.album.name : "",
          releaseDate:
            typeof track.album.release_date === "string"
              ? track.album.release_date
              : null,
          albumType:
            typeof track.album.album_type === "string"
              ? track.album.album_type
              : null,
        }
      : null);
  return {
    id: track?.id ?? null,
    name: typeof track?.name === "string" ? track.name : "",
    durationMs:
      typeof track?.duration_ms === "number" ? track.duration_ms : null,
    spotifyUrl:
      typeof track?.external_urls?.spotify === "string"
        ? track.external_urls.spotify
        : track?.id
          ? `https://open.spotify.com/track/${encodeURIComponent(track.id)}`
          : null,
    previewUrl:
      typeof track?.preview_url === "string" ? track.preview_url : null,
    explicit: Boolean(track?.explicit),
    discNumber:
      typeof track?.disc_number === "number" ? track.disc_number : null,
    trackNumber:
      typeof track?.track_number === "number" ? track.track_number : null,
    artists,
    album,
  };
}

/**
 * @param {string} artistId
 * @param {string} [market]
 * @param {{ maxTracks?: number, maxAlbumPages?: number }} [options]
 */
export async function fetchArtistCatalogTracks(artistId, market, options) {
  const maxTracks = Math.min(
    500,
    Math.max(1, Number(options?.maxTracks) || 200),
  );
  const maxAlbumPages = Math.min(
    40,
    Math.max(1, Number(options?.maxAlbumPages) || 20),
  );

  const cacheTtl = catalogCacheTtlMs();
  const cacheKey = `${artistId}\t${normalizeMarketCode(market) || "-"}\t${maxTracks}\t${maxAlbumPages}`;
  if (cacheTtl > 0) {
    const hit = catalogResultCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.result;
    }
  }

  const inflight = catalogInflight.get(cacheKey);
  if (inflight) return inflight;

  const work = fetchArtistCatalogTracksUncached(
    artistId,
    market,
    options,
    cacheKey,
    cacheTtl,
    maxTracks,
    maxAlbumPages,
  ).finally(() => {
    catalogInflight.delete(cacheKey);
  });

  catalogInflight.set(cacheKey, work);
  return work;
}

async function fetchArtistCatalogTracksUncached(
  artistId,
  market,
  options,
  cacheKey,
  cacheTtl,
  maxTracks,
  maxAlbumPages,
) {
  const prof = await spotifyGet(`/artists/${encodeURIComponent(artistId)}`);
  if (prof.status === 404) {
    return {
      ok: false,
      status: 404,
      error: "artist_not_found",
      body: prof.body,
      phase: "artist_profile",
    };
  }
  if (prof.status !== 200) {
    return {
      ok: false,
      status: prof.status,
      body: prof.body,
      phase: "artist_profile",
    };
  }
  await afterCatalogRequest();

  /** @type {Map<string, { id: string, name: string, release_date: string | null, album_type: string | null, releaseMs: number }>} */
  const albumById = new Map();

  let nextUrl = buildArtistAlbumsUrlPath(artistId, market);
  let albumPages = 0;

  while (nextUrl && albumPages < maxAlbumPages) {
    const { status, body } = await spotifyGet(nextUrl);
    albumPages += 1;
    if (status !== 200) {
      return { ok: false, status, body, phase: "artist_albums" };
    }
    await afterCatalogRequest();
    const items = Array.isArray(body?.items) ? body.items : [];
    for (const al of items) {
      const id = typeof al?.id === "string" ? al.id : null;
      if (!id || albumById.has(id)) continue;
      const release =
        typeof al.release_date === "string" ? al.release_date : null;
      albumById.set(id, {
        id,
        name: typeof al.name === "string" ? al.name : "",
        release_date: release,
        album_type: typeof al.album_type === "string" ? al.album_type : null,
        releaseMs: parseReleaseMs(release || ""),
      });
    }
    nextUrl = typeof body?.next === "string" && body.next ? body.next : null;
  }

  const albums = [...albumById.values()].sort(
    (a, b) => b.releaseMs - a.releaseMs,
  );

  const seenTrackIds = new Set();
  const out = [];

  for (const al of albums) {
    if (out.length >= maxTracks) break;

    let trackNext = buildAlbumTracksUrlPath(al.id, market);
    let guard = 0;
    while (trackNext && out.length < maxTracks && guard < 30) {
      guard += 1;
      const { status, body } = await spotifyGet(trackNext);
      if (status !== 200) {
        console.warn(
          `[spotifyArtistTracks] GET album tracks ${al.id} → ${status}`,
        );
        break;
      }
      await afterCatalogRequest();
      const items = Array.isArray(body?.items) ? body.items : [];
      const albumCtx = {
        id: al.id,
        name: al.name,
        releaseDate: al.release_date,
        albumType: al.album_type,
      };
      for (const t of items) {
        if (!t?.id || seenTrackIds.has(t.id)) continue;
        seenTrackIds.add(t.id);
        out.push(mapTrackForResponse(t, albumCtx));
        if (out.length >= maxTracks) break;
      }
      trackNext =
        typeof body?.next === "string" && body.next ? body.next : null;
    }
  }

  const result = {
    ok: true,
    tracks: out,
    meta: {
      albumsScanned: albums.length,
      artistName:
        typeof prof.body?.name === "string" ? prof.body.name : undefined,
    },
  };

  if (cacheTtl > 0) {
    catalogResultCache.set(cacheKey, {
      expiresAt: Date.now() + cacheTtl,
      result,
    });
    if (catalogResultCache.size > 32) {
      const now = Date.now();
      for (const [k, v] of catalogResultCache) {
        if (v.expiresAt <= now) catalogResultCache.delete(k);
      }
    }
  }

  return result;
}

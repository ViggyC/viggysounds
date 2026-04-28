import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import cors from "cors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/* Load env from repo root (optional) then server/.env — latter wins. Cwd-independent. */
dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config({ path: path.join(__dirname, ".env") });
import express from "express";
import {
  spotifyGet,
  spotifyConfigured,
  clearSpotifyAccessTokenCache,
} from "./lib/spotify.js";
import {
  fetchArtistCatalogTracks,
  fetchArtistTopTracks,
  fetchTracksByIds,
} from "./lib/spotifyArtistTracks.js";
import {
  soundcloudGet,
  soundcloudGetUser,
  soundcloudConfigured,
  soundcloudUserConfigured,
} from "./lib/soundcloud.js";
import {
  buildAuthorizeUrl,
  consumePendingAuth,
  createPkcePair,
  exchangeAuthorizationCode,
  getSoundCloudRedirectUri,
  randomOAuthState,
  registerPendingAuth,
} from "./lib/soundcloudOAuth.js";
import {
  persistUserTokensFromOAuthResponse,
  SOUNDCLOUD_USER_TOKEN_FILE,
} from "./lib/soundcloudUserTokens.js";
import {
  fetchAllMeTracks,
  recentPublicTracks,
  topTracksByPlayback,
} from "./lib/soundcloudTopByPlays.js";

function spotifyUserIdFromEnv() {
  return (
    process.env.SPOTIFY_USER_ID?.trim() ||
    process.env.SPOTIFY_USERNAME?.trim() ||
    ""
  );
}

/**
 * Artist id from open.spotify.com/artist/<id> — not the same as user profile id.
 * Accepts full URL or raw id.
 */
function spotifyArtistIdFromEnv() {
  const raw = process.env.SPOTIFY_ARTIST_ID?.trim() || "";
  if (!raw) return "";
  const m = raw.match(/\/artist\/([a-zA-Z0-9]+)/i);
  if (m) return m[1];
  if (/^[a-zA-Z0-9]+$/.test(raw) && raw.length >= 8) return raw;
  return "";
}

function parseSpotifyArtistIdParam(value) {
  if (value == null || String(value).trim() === "") return "";
  const s = String(value)
    .trim()
    .replace(/^["']|["']$/g, "");
  const m = s.match(/\/artist\/([a-zA-Z0-9]+)/i);
  if (m) return m[1];
  if (/^[a-zA-Z0-9]+$/.test(s) && s.length >= 8) return s;
  return "";
}

/** open.spotify.com/track/{id} — use when top-tracks returns 403 in Development mode. */
function spotifyTopTrackIdsFromEnv() {
  const raw = process.env.SPOTIFY_TOP_TRACK_IDS;
  if (typeof raw !== "string" || !raw.trim()) return [];
  const out = [];
  for (const part of raw.split(/[\n,;]+/)) {
    let s = part.trim().replace(/^["']|["']$/g, "");
    if (!s) continue;
    s = s.split("?")[0].trim();
    const m = s.match(/\/track\/([a-zA-Z0-9]+)/i);
    if (m) {
      out.push(m[1]);
      continue;
    }
    /* Spotify track ids are base62; length is usually 22 */
    if (/^[a-zA-Z0-9]+$/.test(s) && s.length >= 16 && s.length <= 24) out.push(s);
  }
  return out.slice(0, 50);
}

/**
 * Clear errors for mode=top when 403 is Spotify policy, not bad credentials.
 * @param {{ ok: false, status: number, body: unknown }} topTracksFailure
 * @param {{ ok: boolean, status?: number, tracks?: unknown[] } | null} tracksByIdsResult — result of fallback GET /tracks, if attempted
 */
function spotifyTopModeClientError(topTracksFailure, tracksByIdsResult, manualIdCount) {
  const st = topTracksFailure.status;
  if (st !== 403) {
    return spotifyApiFailureMessage(
      topTracksFailure,
      "Spotify top tracks request failed",
    );
  }

  if (manualIdCount === 0) {
    return (
      "Spotify blocked “popular tracks” for this app (HTTP 403). That usually means your app is in Development mode without Extended Quota — not a wrong Client ID or secret. " +
      "Add five track links to server/.env, restart the API, and reload:\n\n" +
      "SPOTIFY_TOP_TRACK_IDS=https://open.spotify.com/track/TRACK_ID_1,https://open.spotify.com/track/TRACK_ID_2\n\n" +
      "Long-term: request Extended Quota — https://developer.spotify.com/documentation/web-api/concepts/quota-modes"
    );
  }

  if (tracksByIdsResult && !tracksByIdsResult.ok) {
    return (
      `Spotify blocked GET /tracks as well (HTTP ${tracksByIdsResult.status}). ` +
      "Your Client ID and secret can still be correct; this app may need Extended Quota for Web API catalog access. " +
      "Double-check SPOTIFY_TOP_TRACK_IDS values (full open.spotify.com/track/… URLs or track ids)."
    );
  }

  if (
    tracksByIdsResult &&
    tracksByIdsResult.ok &&
    Array.isArray(tracksByIdsResult.tracks) &&
    tracksByIdsResult.tracks.length === 0
  ) {
    return (
      "SPOTIFY_TOP_TRACK_IDS did not yield any tracks — check that each id is valid (open the open.spotify.com/track/… URL in a browser)."
    );
  }

  return spotifyApiFailureMessage(
    topTracksFailure,
    "Spotify top tracks request failed",
  );
}

/** Spotify expects ISO 3166-1 alpha-2; invalid env values caused bad API queries. */
function normalizeSpotifyMarketIso(fromQuery, fromEnv) {
  const candidates = [
    typeof fromQuery === "string" ? fromQuery.trim() : "",
    typeof fromEnv === "string" ? fromEnv.trim() : "",
  ];
  for (const c of candidates) {
    if (c && /^[a-z]{2}$/i.test(c)) return c.toUpperCase();
  }
  return "US";
}

/** Spotify returns `error` as object `{ message, status }` or legacy shapes — normalize for clients. */
function spotifyErrorMessageFromBody(body) {
  if (body == null) return null;
  if (typeof body === "string") {
    const s = body.trim();
    return s.length > 0 ? s.slice(0, 400) : null;
  }
  if (typeof body !== "object") return null;
  const err = body.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    if (typeof err.message === "string") return err.message;
    if (typeof err.reason === "string") return err.reason;
  }
  if (typeof body.message === "string") return body.message;
  return null;
}

function spotifyApiFailureMessage(result, verbPhrase) {
  const fromBody = spotifyErrorMessageFromBody(result.body);
  const st =
    typeof result.status === "number" && result.status >= 400
      ? result.status
      : 502;

  if (st === 403) {
    const detail =
      fromBody && fromBody !== "Forbidden"
        ? `${fromBody} `
        : "";
    return (
      `${detail}${verbPhrase} (HTTP 403). ` +
      "If GET /api/spotify/ping shows GET /tracks works but top-tracks does not, your credentials are fine — Spotify is blocking certain endpoints for Development-mode apps; use SPOTIFY_TOP_TRACK_IDS or Extended Quota (see server/.env.example). " +
      "Otherwise verify SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET and restart the API."
    );
  }

  if (fromBody) return fromBody;
  const phase =
    typeof result.phase === "string" && result.phase.length > 0
      ? result.phase
      : null;
  if (phase) return `${verbPhrase} (${phase}, HTTP ${st}).`;
  return `${verbPhrase} (HTTP ${st}).`;
}

/**
 * Playlist IDs for GET /v1/playlists/{id} (works for public playlists + Client Credentials).
 * Accepts raw IDs or full share URLs — same API call Spotify documents:
 * https://developer.spotify.com/documentation/web-api/reference/get-playlist
 */
function spotifyPlaylistIdsFromEnv() {
  const blobs = [
    typeof process.env.SPOTIFY_PLAYLIST_IDS === "string"
      ? process.env.SPOTIFY_PLAYLIST_IDS.trim()
      : "",
    typeof process.env.SPOTIFY_PLAYLIST_URL === "string"
      ? process.env.SPOTIFY_PLAYLIST_URL.trim()
      : "",
  ].filter((s) => s.length > 0);
  if (!blobs.length) return [];

  const segments = [];
  for (const blob of blobs) {
    for (const part of blob.split(/[\n,]/)) {
      const s = part.trim().replace(/^["']|["']$/g, "");
      if (s) segments.push(s);
    }
  }

  /* open.spotify.com/playlist/id or .../intl-xx/playlist/id or ?si= */
  const urlPattern = /\/playlist\/([a-zA-Z0-9]+)/i;
  const ids = [];
  const seen = new Set();

  for (const seg of segments) {
    let id = null;
    const m = seg.match(urlPattern);
    if (m) id = m[1];
    else if (/^[a-zA-Z0-9]+$/.test(seg) && seg.length >= 8) id = seg;

    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** Normalize playlist from GET /playlists/:id or an item from GET /users/:id/playlists */
function mapSpotifyPlaylist(p) {
  if (!p || p.id == null) return null;
  const id = String(p.id).trim();
  if (!id) return null;
  const images = Array.isArray(p.images) ? p.images : [];
  const img =
    images.find((i) => i?.url && i.width && i.height) ||
    images.find((i) => i?.url) ||
    images[0];
  return {
    id,
    name: typeof p.name === "string" ? p.name : "Playlist",
    spotifyUrl:
      typeof p.external_urls?.spotify === "string"
        ? p.external_urls.spotify
        : `https://open.spotify.com/playlist/${encodeURIComponent(p.id)}`,
    imageUrl: typeof img?.url === "string" ? img.url : null,
    tracksTotal: typeof p.tracks?.total === "number" ? p.tracks.total : null,
  };
}

const app = express();
const PORT = Number(process.env.PORT) || 3001;

const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins.length ? corsOrigins : true,
  }),
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  const resolved = spotifyPlaylistIdsFromEnv();
  res.json({
    ok: true,
    spotify: spotifyConfigured(),
    spotifyPlaylistsUser: Boolean(spotifyUserIdFromEnv()),
    spotifyPlaylistIdsEnv: Boolean(resolved.length),
    spotifyPlaylistIdsResolvedCount: resolved.length,
    spotifyArtistId: Boolean(spotifyArtistIdFromEnv()),
    soundcloud: soundcloudConfigured(),
    soundcloudUser: soundcloudUserConfigured(),
    soundcloudRedirectUri: soundcloudConfigured()
      ? getSoundCloudRedirectUri()
      : null,
  });
});

/**
 * SoundCloud OAuth 2.1 + PKCE — step 1: redirect browser to SoundCloud authorize.
 * Register the same URI in your app (see /health → soundcloudRedirectUri).
 */
app.get("/api/soundcloud/auth/start", (_req, res) => {
  if (!soundcloudConfigured()) {
    res.status(503).json({
      error:
        "SoundCloud is not configured (set SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET)",
    });
    return;
  }
  try {
    const redirectUri = getSoundCloudRedirectUri();
    const { codeVerifier, codeChallenge } = createPkcePair();
    const state = randomOAuthState();
    registerPendingAuth(state, codeVerifier);
    const url = buildAuthorizeUrl({ codeChallenge, state, redirectUri });
    res.redirect(302, url);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error:
        err instanceof Error ? err.message : "Failed to start SoundCloud auth",
    });
  }
});

/**
 * SoundCloud OAuth — step 2: SoundCloud redirects here with ?code=&state=
 */
app.get("/api/soundcloud/auth/callback", async (req, res) => {
  const q = req.query;
  if (q.error) {
    res.status(400).json({
      error: String(q.error),
      error_description: q.error_description
        ? String(q.error_description)
        : undefined,
    });
    return;
  }

  const code = q.code != null ? String(q.code) : "";
  const state = q.state != null ? String(q.state) : "";
  if (!code || !state) {
    res.status(400).json({ error: "Missing code or state" });
    return;
  }

  const pending = consumePendingAuth(state);
  if (!pending) {
    res.status(400).json({
      error: "invalid_or_expired_state",
      message:
        "Start again from GET /api/soundcloud/auth/start (state expires in 10 minutes).",
    });
    return;
  }

  try {
    const redirectUri = getSoundCloudRedirectUri();
    const tokens = await exchangeAuthorizationCode({
      code,
      codeVerifier: pending.codeVerifier,
      redirectUri,
    });
    await persistUserTokensFromOAuthResponse(tokens, null);
    res.json({
      ok: true,
      message: `Tokens saved on disk (${SOUNDCLOUD_USER_TOKEN_FILE}). /me/* routes use them and refresh automatically (see SoundCloud token guide).`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Token exchange failed",
    });
  }
});

/**
 * Spotify: GET /api/spotify/ping — diagnose 403 / credential issues (no secrets returned).
 * Enabled when NODE_ENV !== "production" or SPOTIFY_DEBUG=1.
 */
app.get("/api/spotify/ping", async (req, res) => {
  const allow =
    process.env.SPOTIFY_DEBUG === "1" ||
    process.env.NODE_ENV !== "production";
  if (!allow) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }
  if (!spotifyConfigured()) {
    res.status(503).json({
      ok: false,
      error: "Spotify is not configured (missing SPOTIFY_CLIENT_ID / SECRET)",
    });
    return;
  }

  clearSpotifyAccessTokenCache();

  /*
   * Probe IDs: Drake + a doc-example track — separate “catalog blocked” vs “everything blocked”.
   * Nov 2024+: apps in Development mode often get 403 on top-tracks & search but may still GET /tracks.
   */
  const probeArtistId = "3TVXtAsR1Inumwj472S9r4";
  const probeTrackId = "11dFghVXANMlKmJgdgLM0";

  try {
    const trackProbe = await spotifyGet(`/tracks/${encodeURIComponent(probeTrackId)}`);
    const artistProbe = await spotifyGet(
      `/artists/${encodeURIComponent(probeArtistId)}`,
    );
    const topProbe = await spotifyGet(
      `/artists/${encodeURIComponent(probeArtistId)}/top-tracks?market=US`,
    );
    const envArtist = spotifyArtistIdFromEnv();
    let yourArtistGet = null;
    let yoursTop = null;
    if (envArtist) {
      yourArtistGet = await spotifyGet(
        `/artists/${encodeURIComponent(envArtist)}`,
      );
      yoursTop = await spotifyGet(
        `/artists/${encodeURIComponent(envArtist)}/top-tracks?market=US`,
      );
    }

    const manualCount = spotifyTopTrackIdsFromEnv().length;

    res.json({
      ok: true,
      explanation:
        "Nov 2024 Spotify policy: apps in Development mode without Extended Quota often get HTTP 403 on GET …/top-tracks (and other catalog endpoints). GET /tracks/{id} may still work — set SPOTIFY_TOP_TRACK_IDS in server/.env with up to five track IDs from open.spotify.com/track/… as a fallback. Request Extended Quota: https://developer.spotify.com/documentation/web-api/concepts/quota-modes",
      probe: {
        getTrackExample: { httpStatus: trackProbe.status },
        getArtistDrake: { httpStatus: artistProbe.status },
        topTracksDrake: { httpStatus: topProbe.status },
        yourArtistGet: envArtist
          ? { httpStatus: yourArtistGet.status, artistId: envArtist }
          : { httpStatus: null, skipped: "SPOTIFY_ARTIST_ID not set" },
        topTracksYourArtist: envArtist
          ? { httpStatus: yoursTop.status, artistId: envArtist }
          : {
              httpStatus: null,
              skipped: "SPOTIFY_ARTIST_ID not set",
            },
        manualTrackFallbackConfigured: manualCount > 0,
        manualTrackCount: manualCount,
      },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "ping failed",
    });
  }
});

/**
 * Spotify: GET /api/spotify/playlists?limit=12
 * Merges (1) SPOTIFY_PLAYLIST_IDS — explicit public playlist IDs, (2) public playlists
 * for SPOTIFY_USER_ID / SPOTIFY_USERNAME. Client Credentials cannot see private playlists.
 */
app.get("/api/spotify/playlists", async (req, res) => {
  if (!spotifyConfigured()) {
    res.status(503).json({
      ok: false,
      playlists: [],
      error: "Spotify is not configured (missing SPOTIFY_CLIENT_ID / SECRET)",
    });
    return;
  }

  const userId = spotifyUserIdFromEnv();
  const explicitIds = spotifyPlaylistIdsFromEnv();
  if (!userId && explicitIds.length === 0) {
    res.status(503).json({
      ok: false,
      playlists: [],
      error:
        "Set SPOTIFY_USER_ID and/or SPOTIFY_PLAYLIST_URL / SPOTIFY_PLAYLIST_IDS in server/.env — restart the API after saving.",
    });
    return;
  }

  const limit = Math.min(
    50,
    Math.max(1, Number.parseInt(String(req.query.limit || "12"), 10) || 12),
  );

  try {
    const merged = [];
    const seen = new Set();
    /** Spotify `total` from GET /users/.../playlists first page (public list size). */
    let spotifyUserPlaylistTotal;
    /** Result of GET /users/{id} — 404 means wrong SPOTIFY_USER_ID. */
    let userProfileStatus;

    const market = process.env.SPOTIFY_MARKET?.trim();
    const marketQs =
      market && /^[a-z]{2}$/i.test(market)
        ? `?market=${encodeURIComponent(market.toUpperCase())}`
        : "";

    for (const pid of explicitIds) {
      let path = `/playlists/${encodeURIComponent(pid)}${marketQs}`;
      let { status, body } = await spotifyGet(path);
      if (status !== 200 && marketQs) {
        ({ status, body } = await spotifyGet(
          `/playlists/${encodeURIComponent(pid)}`,
        ));
      }
      if (status !== 200) {
        const detail =
          typeof body === "object" && body !== null
            ? JSON.stringify(body).slice(0, 280)
            : String(body).slice(0, 280);
        console.warn(
          "[GET /api/spotify/playlists] GET /playlists/",
          pid,
          "→",
          status,
          detail,
        );
        continue;
      }
      const m = mapSpotifyPlaylist(body);
      if (m && !seen.has(m.id)) {
        merged.push(m);
        seen.add(m.id);
      }
    }

    if (userId) {
      const profRes = await spotifyGet(`/users/${encodeURIComponent(userId)}`);
      userProfileStatus = profRes.status;
      if (profRes.status !== 200) {
        console.warn(
          `[GET /api/spotify/playlists] GET /users/${userId} → ${profRes.status}. Use the id from open.spotify.com/user/<id> (Profile → ••• → Share → Copy link to profile).`,
        );
      }
    }

    if (userId && userProfileStatus === 200) {
      let status = 200;
      let body = null;
      let nextUrl = `/users/${encodeURIComponent(userId)}/playlists?limit=50`;
      let page = 0;

      while (nextUrl && merged.length < limit && page < 6) {
        const pageRes = await spotifyGet(nextUrl);
        status = pageRes.status;
        body = pageRes.body;
        page += 1;

        if (status !== 200) {
          break;
        }

        if (
          typeof body?.total === "number" &&
          spotifyUserPlaylistTotal === undefined
        ) {
          spotifyUserPlaylistTotal = body.total;
        }

        const raw = Array.isArray(body?.items) ? body.items : [];
        if (page === 1 && raw.length === 0) {
          console.warn(
            "[GET /api/spotify/playlists] first page empty for user",
            userId,
            "spotifyTotal=",
            body?.total,
            "— Client Credentials only returns public playlists. Private lists need SPOTIFY_PLAYLIST_IDS or OAuth.",
          );
        }

        for (const p of raw) {
          const m = mapSpotifyPlaylist(p);
          if (m && !seen.has(m.id)) {
            merged.push(m);
            seen.add(m.id);
          }
          if (merged.length >= limit) break;
        }

        nextUrl =
          merged.length >= limit
            ? null
            : typeof body?.next === "string" && body.next
              ? body.next
              : null;
      }

      if (status !== 200) {
        const msg =
          typeof body === "object" &&
          body !== null &&
          typeof body.error === "object" &&
          body.error?.message
            ? String(body.error.message)
            : "spotify_user_playlists_failed";
        const spotifyBlocksUserListing = status === 403 || status === 401;
        console.warn(
          "[GET /api/spotify/playlists] user playlists",
          userId,
          status,
          msg,
        );
        if (spotifyBlocksUserListing) {
          console.warn(
            "[GET /api/spotify/playlists] Spotify often returns 403 for GET /users/{id}/playlists with Client Credentials (API / app policy). " +
              "Use SPOTIFY_PLAYLIST_IDS=comma,separated,playlist_ids from each playlist share link (open.spotify.com/playlist/…).",
          );
        }
        if (merged.length === 0 && !spotifyBlocksUserListing) {
          res.status(status >= 400 && status < 600 ? status : 502).json({
            ok: false,
            playlists: [],
            error: msg,
          });
          return;
        }
      }
    }

    const playlists = merged.slice(0, limit);
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      ok: true,
      playlists,
      meta: {
        userId: userId || undefined,
        explicitPlaylistIds: explicitIds.length,
        spotifyUserPlaylistTotal:
          typeof spotifyUserPlaylistTotal === "number"
            ? spotifyUserPlaylistTotal
            : undefined,
        profileStatus: userProfileStatus,
        hint:
          playlists.length === 0
            ? explicitIds.length > 0
              ? `Parsed ${explicitIds.length} playlist id(s) from env but Spotify did not return them (see API console for GET /playlists/… status). Restart the server after changing .env. If status is 403, Spotify may block Client Credentials for your app — check the Spotify Developer Dashboard.`
              : userProfileStatus === 404
                ? `Spotify has no user "${userId}". SPOTIFY_USER_ID must match your profile URL: open.spotify.com/user/<this-part> (not display name, not artist /artist/… id).`
                : userProfileStatus != null &&
                    userProfileStatus !== 200 &&
                    userProfileStatus !== undefined
                  ? `Spotify profile request failed (${userProfileStatus}). Check SPOTIFY_USER_ID and app permissions.`
                  : typeof spotifyUserPlaylistTotal === "number" &&
                      spotifyUserPlaylistTotal === 0
                    ? "This account has no playlists, or none are public. Client Credentials cannot see private playlists—make them public or set SPOTIFY_PLAYLIST_IDS."
                    : "No playlists returned. Make playlists public on Spotify, or add SPOTIFY_PLAYLIST_URL / SPOTIFY_PLAYLIST_IDS."
            : undefined,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      playlists: [],
      error: err instanceof Error ? err.message : "Spotify request failed",
    });
  }
});

/**
 * Spotify: GET /api/spotify/artist/tracks
 * Public artist catalog (Client Credentials). Uses SPOTIFY_ARTIST_ID from env,
 * or ?artistId=… / open.spotify.com/artist/… (override for testing).
 *
 * Query: mode=catalog|top (default catalog). catalog = albums+singles deduped;
 * top = Spotify’s top tracks for the market (≤10 from API); limit=1–10 trims the list (default 5 for top).
 * Catalog: limit=max tracks (default 200, max 500).
 */
app.get("/api/spotify/artist/tracks", async (req, res) => {
  if (!spotifyConfigured()) {
    res.status(503).json({
      ok: false,
      tracks: [],
      error: "Spotify is not configured (missing SPOTIFY_CLIENT_ID / SECRET)",
    });
    return;
  }

  const fromQuery = parseSpotifyArtistIdParam(req.query.artistId);
  const artistId = fromQuery || spotifyArtistIdFromEnv();
  if (!artistId) {
    res.status(503).json({
      ok: false,
      tracks: [],
      error:
        "Set SPOTIFY_ARTIST_ID in server/.env (Spotify artist id from open.spotify.com/artist/…) or pass ?artistId=",
    });
    return;
  }

  const modeRaw = String(req.query.mode || "catalog").toLowerCase();
  const mode = modeRaw === "top" ? "top" : "catalog";

  const marketFromQuery =
    typeof req.query.market === "string" ? req.query.market.trim() : "";
  const market = normalizeSpotifyMarketIso(
    marketFromQuery,
    process.env.SPOTIFY_MARKET,
  );

  try {
    if (mode === "top") {
      let result = await fetchArtistTopTracks(artistId, market);
      let usedManualTrackFallback = false;
      const manualIds = spotifyTopTrackIdsFromEnv();
      let tracksByIdsAttempt = null;

      if (!result.ok && result.status === 403 && manualIds.length > 0) {
        console.warn(
          "[spotify] GET …/top-tracks returned 403 — trying SPOTIFY_TOP_TRACK_IDS via GET /tracks",
        );
        tracksByIdsAttempt = await fetchTracksByIds(manualIds);
        if (tracksByIdsAttempt.ok && tracksByIdsAttempt.tracks.length > 0) {
          result = tracksByIdsAttempt;
          usedManualTrackFallback = true;
        }
      }

      if (!result.ok) {
        const clientMsg = spotifyTopModeClientError(
          result,
          tracksByIdsAttempt,
          manualIds.length,
        );
        res
          .status(
            result.status >= 400 && result.status < 600 ? result.status : 502,
          )
          .json({
            ok: false,
            tracks: [],
            error: clientMsg,
            spotify: result.body,
          });
        return;
      }

      const limitTop = Math.min(
        10,
        Math.max(1, Number.parseInt(String(req.query.limit ?? "5"), 10) || 5),
      );
      const tracks = result.tracks.slice(0, limitTop);
      const primary =
        tracks.length > 0 &&
        Array.isArray(tracks[0]?.artists) &&
        tracks[0].artists.length > 0
          ? tracks[0].artists[0]
          : null;
      const artistDisplay =
        primary && typeof primary.name === "string" ? primary.name.trim() : "";

      res.set("Cache-Control", "public, max-age=300");
      res.json({
        ok: true,
        mode: "top",
        artistId,
        market,
        tracks,
        meta: {
          note: usedManualTrackFallback
            ? `Tracks loaded via SPOTIFY_TOP_TRACK_IDS (GET /tracks). Spotify blocked GET …/top-tracks (403) — typical for apps in Development mode without Extended Quota. Showing ${tracks.length} track(s).`
            : `Spotify returns up to 10 popular tracks per market; this response includes up to ${limitTop}.`,
          artistName: artistDisplay || undefined,
          source: usedManualTrackFallback ? "track_ids_env" : "top_tracks_api",
        },
      });
      return;
    }

    const limit = Math.min(
      500,
      Math.max(1, Number.parseInt(String(req.query.limit || "200"), 10) || 200),
    );

    const result = await fetchArtistCatalogTracks(artistId, market, {
      maxTracks: limit,
    });

    if (!result.ok) {
      if (result.status === 404 || result.error === "artist_not_found") {
        res.status(404).json({
          ok: false,
          tracks: [],
          error:
            "Artist not found. SPOTIFY_ARTIST_ID must be the id from open.spotify.com/artist/<id> (not your user profile id).",
        });
        return;
      }
      res
        .status(
          result.status >= 400 && result.status < 600 ? result.status : 502,
        )
        .json({
          ok: false,
          tracks: [],
          error: spotifyApiFailureMessage(
            result,
            "Spotify catalog request failed",
          ),
          spotify: result.body,
        });
      return;
    }

    res.set("Cache-Control", "public, max-age=300");
    res.json({
      ok: true,
      mode: "catalog",
      artistId,
      market,
      tracks: result.tracks,
      meta: result.meta,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      tracks: [],
      error: err instanceof Error ? err.message : "Spotify request failed",
    });
  }
});

/** Spotify: GET /api/spotify/track/:id */
app.get("/api/spotify/track/:id", async (req, res) => {
  if (!spotifyConfigured()) {
    res.status(503).json({ error: "Spotify is not configured (missing env)" });
    return;
  }
  try {
    const { id } = req.params;
    const { status, body } = await spotifyGet(
      `/tracks/${encodeURIComponent(id)}`,
    );
    res.status(status).json(body);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Spotify request failed",
    });
  }
});

/** Spotify: GET /api/spotify/search?q=&type=track&limit=20 */
app.get("/api/spotify/search", async (req, res) => {
  if (!spotifyConfigured()) {
    res.status(503).json({ error: "Spotify is not configured (missing env)" });
    return;
  }
  try {
    const q = String(req.query.q || "").trim();
    if (!q) {
      res.status(400).json({ error: "Missing query parameter q" });
      return;
    }
    const type = String(req.query.type || "track");
    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(String(req.query.limit || "20"), 10) || 20),
    );
    const qstr = new URLSearchParams({ q, type, limit: String(limit) });
    const { status, body } = await spotifyGet(`/search?${qstr.toString()}`);
    res.status(status).json(body);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Spotify request failed",
    });
  }
});

/**
 * SoundCloud: GET /api/soundcloud/top-tracks?limit=5
 * Authenticated user's uploads, highest playback_count first.
 * Returns permalink URLs for embed widgets — requires user OAuth (token file).
 */
app.get("/api/soundcloud/top-tracks", async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  if (!soundcloudUserConfigured()) {
    const body = {
      error:
        "SoundCloud user not connected. Open GET /api/soundcloud/auth/start once.",
      tracks: [],
    };
    console.warn("[GET /api/soundcloud/top-tracks] 503", body);
    res.status(503).json(body);
    return;
  }
  const limit = Math.min(
    50,
    Math.max(1, Number.parseInt(String(req.query.limit || "5"), 10) || 5),
  );
  try {
    const all = await fetchAllMeTracks();
    const tracks = topTracksByPlayback(all, limit);
    const payload = { ok: true, tracks };
    console.log("[GET /api/soundcloud/top-tracks] response", payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to load tracks",
      tracks: [],
    });
  }
});

/**
 * SoundCloud: GET /api/soundcloud/recent-tracks?limit=5
 * Public uploads only (`sharing` === "public"), valid `created_at`, newest first.
 */
app.get("/api/soundcloud/recent-tracks", async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  if (!soundcloudUserConfigured()) {
    const body = {
      error:
        "SoundCloud user not connected. Open GET /api/soundcloud/auth/start once.",
      tracks: [],
    };
    console.warn("[GET /api/soundcloud/recent-tracks] 503", body);
    res.status(503).json(body);
    return;
  }
  const limit = Math.min(
    50,
    Math.max(1, Number.parseInt(String(req.query.limit || "5"), 10) || 5),
  );
  try {
    const all = await fetchAllMeTracks();
    const tracks = recentPublicTracks(all, limit);
    const payload = { ok: true, tracks };
    console.log("[GET /api/soundcloud/recent-tracks] response", payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to load tracks",
      tracks: [],
    });
  }
});

/**
 * SoundCloud: GET /api/soundcloud/me/tracks
 * Proxies GET https://api.soundcloud.com/me/tracks
 * Query: limit, offset, linked_partitioning (see API explorer)
 */
app.get("/api/soundcloud/me/tracks", async (req, res) => {
  if (!soundcloudUserConfigured()) {
    res.status(503).json({
      error:
        "SoundCloud user not connected. Open GET /api/soundcloud/auth/start once, or set SOUNDCLOUD_USER_ACCESS_TOKEN.",
    });
    return;
  }
  try {
    const allowed = ["limit", "offset", "linked_partitioning"];
    const params = new URLSearchParams();
    for (const key of allowed) {
      const v = req.query[key];
      if (v != null && v !== "") params.set(key, String(v));
    }
    const qs = params.toString();
    const path = qs ? `/me/tracks?${qs}` : "/me/tracks";
    const { status, body } = await soundcloudGetUser(path);
    res.status(status).json(body);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "SoundCloud request failed",
    });
  }
});

/** SoundCloud: GET /api/soundcloud/tracks/:id */
app.get("/api/soundcloud/tracks/:id", async (req, res) => {
  if (!soundcloudConfigured()) {
    res
      .status(503)
      .json({ error: "SoundCloud is not configured (missing env)" });
    return;
  }
  try {
    const { id } = req.params;
    const { status, body } = await soundcloudGet(
      `/tracks/${encodeURIComponent(id)}`,
    );
    res.status(status).json(body);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "SoundCloud request failed",
    });
  }
});

/** SoundCloud: GET /api/soundcloud/resolve?url= */
app.get("/api/soundcloud/resolve", async (req, res) => {
  if (!soundcloudConfigured()) {
    res
      .status(503)
      .json({ error: "SoundCloud is not configured (missing env)" });
    return;
  }
  try {
    const url = String(req.query.url || "").trim();
    if (!url) {
      res.status(400).json({ error: "Missing query parameter url" });
      return;
    }
    const qstr = new URLSearchParams({ url });
    const { status, body } = await soundcloudGet(`/resolve?${qstr.toString()}`);
    res.status(status).json(body);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "SoundCloud request failed",
    });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  console.log(`  CORS: ${corsOrigins.join(", ") || "(any)"}`);
});

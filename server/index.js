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
    if (/^[a-zA-Z0-9]+$/.test(s) && s.length >= 16 && s.length <= 24)
      out.push(s);
  }
  return out.slice(0, 50);
}

/**
 * Clear errors for mode=top when 403 is Spotify policy, not bad credentials.
 * @param {{ ok: false, status: number, body: unknown }} topTracksFailure
 * @param {{ ok: boolean, status?: number, tracks?: unknown[] } | null} tracksByIdsResult — result of fallback GET /tracks, if attempted
 */
function spotifyTopModeClientError(
  topTracksFailure,
  tracksByIdsResult,
  manualIdCount,
) {
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
    return "SPOTIFY_TOP_TRACK_IDS did not yield any tracks — check that each id is valid (open the open.spotify.com/track/… URL in a browser).";
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
    const detail = fromBody && fromBody !== "Forbidden" ? `${fromBody} ` : "";
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
  res.json({
    ok: true,
    spotify: spotifyConfigured(),
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
    process.env.SPOTIFY_DEBUG === "1" || process.env.NODE_ENV !== "production";
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
    const trackProbe = await spotifyGet(
      `/tracks/${encodeURIComponent(probeTrackId)}`,
    );
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
 * Spotify: GET /api/spotify/artist/tracks
 * Public artist catalog (Client Credentials). Uses SPOTIFY_ARTIST_ID from env,
 * or ?artistId=… / open.spotify.com/artist/… (override for testing).
 *
 * Query: mode=catalog|top (default catalog). catalog = albums+singles deduped;
 * top = Spotify’s top tracks for the market (≤10 from API); limit=1–10 trims the list (default 5 for top).
 * Catalog: limit=max tracks (default 200, max 500).
 */
app.get("/api/spotify/artist/tracks", async (req, res) => {
  const queryMode = String(req.query.mode || "catalog").toLowerCase();
  const mode = queryMode === "top" ? "top" : "catalog";
  const limit = Math.min(
    50,
    Math.max(
      1,
      Number.parseInt(
        String(req.query.limit || (mode === "top" ? "5" : "200")),
        10,
      ) || (mode === "top" ? 5 : 200),
    ),
  );

  const artistId =
    parseSpotifyArtistIdParam(req.query.artistId) || spotifyArtistIdFromEnv();
  if (!artistId) {
    res.status(400).json({
      ok: false,
      error: "Missing SPOTIFY_ARTIST_ID or ?artistId= parameter",
    });
    return;
  }

  // If Spotify isn't configured, allow a manual fallback via SPOTIFY_TOP_TRACK_IDS
  const manualIds = spotifyTopTrackIdsFromEnv();

  try {
    if (mode === "top") {
      if (!spotifyConfigured()) {
        // Try manual fallback
        if (manualIds.length === 0) {
          res.status(503).json({
            ok: false,
            mode: "top",
            tracks: [],
            meta: {
              note: "Spotify not configured and no SPOTIFY_TOP_TRACK_IDS fallback provided.",
            },
          });
          return;
        }
        // Fetch metadata for manual ids if possible
        const tracksByIdsResult = await fetchTracksByIds(
          manualIds.slice(0, limit),
        );
        if (tracksByIdsResult.ok) {
          res.set("Cache-Control", "public, max-age=300");
          res.json({
            ok: true,
            mode: "manual",
            tracks: tracksByIdsResult.tracks,
            meta: { source: "env" },
          });
          return;
        }
        res.status(502).json({
          ok: false,
          error: "Spotify not configured and manual fallback failed",
        });
        return;
      }

      const market = normalizeSpotifyMarketIso(
        req.query.market,
        process.env.SPOTIFY_MARKET,
      );
      const topRes = await fetchArtistTopTracks(artistId, market);
      if (topRes.ok) {
        const out = Array.isArray(topRes.tracks)
          ? topRes.tracks.slice(0, limit)
          : [];
        res.set("Cache-Control", "public, max-age=300");
        res.json({
          ok: true,
          mode: "top",
          tracks: out,
          meta: { source: "spotify_top" },
        });
        return;
      }

      // topRes failed (e.g., 403). Try GET /tracks fallback using SPOTIFY_TOP_TRACK_IDS
      if (manualIds.length > 0) {
        const tracksByIdsResult = await fetchTracksByIds(
          manualIds.slice(0, limit),
        );
        if (tracksByIdsResult.ok) {
          res.set("Cache-Control", "public, max-age=300");
          res.json({
            ok: true,
            mode: "manual",
            tracks: tracksByIdsResult.tracks,
            meta: { source: "env_fallback", topError: topRes },
          });
          return;
        }
        // Both top and ids fallback failed — return explanatory error
        const msg = spotifyTopModeClientError(
          topRes,
          tracksByIdsResult,
          manualIds.length,
        );
        res
          .status(502)
          .json({ ok: false, error: msg, meta: { topError: topRes } });
        return;
      }

      // No manual ids to fall back to — return the top failure message
      const msg = spotifyTopModeClientError(topRes, null, 0);
      res
        .status(502)
        .json({ ok: false, error: msg, meta: { topError: topRes } });
      return;
    }

    // mode === catalog
    if (!spotifyConfigured()) {
      // If not configured, allow manual ids as a very small catalog
      if (manualIds.length === 0) {
        res.status(503).json({
          ok: false,
          mode: "catalog",
          tracks: [],
          meta: {
            note: "Spotify not configured and no SPOTIFY_TOP_TRACK_IDS provided.",
          },
        });
        return;
      }
      const tracksByIdsResult = await fetchTracksByIds(
        manualIds.slice(0, Math.min(limit, 50)),
      );
      if (tracksByIdsResult.ok) {
        res.set("Cache-Control", "public, max-age=300");
        res.json({
          ok: true,
          mode: "manual",
          tracks: tracksByIdsResult.tracks,
          meta: { source: "env" },
        });
        return;
      }
      res.status(502).json({
        ok: false,
        error: "Spotify not configured and manual fallback failed",
      });
      return;
    }

    // Use catalog: scan albums+singles + tracks (deduped)
    const market = normalizeSpotifyMarketIso(
      req.query.market,
      process.env.SPOTIFY_MARKET,
    );
    const maxTracks = Math.min(
      500,
      Math.max(
        1,
        Number.parseInt(String(req.query.maxTracks || limit), 10) || limit,
      ),
    );
    const catalogRes = await fetchArtistCatalogTracks(artistId, market, {
      maxTracks,
    });
    if (!catalogRes || !catalogRes.ok) {
      res.status(catalogRes?.status >= 400 ? catalogRes.status : 502).json({
        ok: false,
        error: spotifyApiFailureMessage(
          catalogRes || { status: 502, body: null },
          "Artist catalog request failed",
        ),
        meta: catalogRes?.meta ?? null,
      });
      return;
    }
    const out = Array.isArray(catalogRes.tracks)
      ? catalogRes.tracks.slice(0, limit)
      : [];
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      ok: true,
      mode: "catalog",
      tracks: out,
      meta: {
        ...(catalogRes.meta || {}),
        artistId,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
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
 * Public tracks only (`sharing` === "public"), sorted by public release date
 * (`release_year` / `release_month` / `release_day`), falling back to `created_at`.
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

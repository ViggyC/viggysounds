import "dotenv/config";
import cors from "cors";
import express from "express";
import { spotifyGet, spotifyConfigured } from "./lib/spotify.js";
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

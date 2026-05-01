/**
 * Spotify Web API — Client Credentials flow (server-only).
 * https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow
 */

let cache = { token: null, expiresAt: 0 };

/** Serialize Spotify Web API GETs so bursts (catalog) stay under quota; gap runs after each call. */
let spotifyRequestChain = Promise.resolve();

/** Call after rotating Client Secret so the next request fetches a new token (server restart does this too). */
export function clearSpotifyAccessTokenCache() {
  cache.token = null;
  cache.expiresAt = 0;
}

function spotifyClientCredentials() {
  const id =
    typeof process.env.SPOTIFY_CLIENT_ID === "string"
      ? process.env.SPOTIFY_CLIENT_ID.trim()
      : "";
  const secret =
    typeof process.env.SPOTIFY_CLIENT_SECRET === "string"
      ? process.env.SPOTIFY_CLIENT_SECRET.trim()
      : "";
  return { id, secret };
}

export function spotifyConfigured() {
  const { id, secret } = spotifyClientCredentials();
  return Boolean(id && secret);
}

function fetchTimeoutMs() {
  const n = Number.parseInt(
    process.env.SPOTIFY_FETCH_TIMEOUT_MS || "45000",
    10,
  );
  if (!Number.isFinite(n) || n < 5000) return 45_000;
  return Math.min(n, 120_000);
}

async function getAccessToken() {
  const now = Date.now();
  if (cache.token && cache.expiresAt > now + 5000) {
    return cache.token;
  }

  const { id, secret } = spotifyClientCredentials();
  if (!id || !secret) {
    throw new Error("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required");
  }

  const tokenSignal =
    typeof AbortSignal !== "undefined" && AbortSignal.timeout
      ? AbortSignal.timeout(Math.min(20_000, fetchTimeoutMs()))
      : undefined;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
    ...(tokenSignal ? { signal: tokenSignal } : {}),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Spotify token error ${res.status}: ${text}`);
  }

  const data = JSON.parse(text);
  cache.token = data.access_token;
  cache.expiresAt = now + (data.expires_in - 60) * 1000;
  return cache.token;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spotify sends `Retry-After` in seconds for HTTP 429.
 * Default cap 90s — if you cap too low (e.g. 25s), you retry before the window clears and stay in 429 loops.
 */
function retryAfterMsFromHeaders(headers) {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const sec = Number.parseFloat(raw.trim());
  if (!Number.isFinite(sec) || sec < 0) return null;
  const cap =
    Number.parseInt(process.env.SPOTIFY_RETRY_AFTER_MAX_MS || "90000", 10) ||
    90_000;
  const capped =
    Number.isFinite(cap) && cap >= 3000 ? Math.min(cap, 180_000) : 90_000;
  return Math.min(Math.round(sec * 1000), capped);
}

function spotifyRequestMinGapMs() {
  const raw = process.env.SPOTIFY_REQUEST_MIN_GAP_MS;
  if (raw === undefined || raw === "") return 120;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return 120;
  return Math.min(2000, Math.max(0, n));
}

function backoffMsFor429(attemptIndex) {
  const base = 1000 * 2 ** Math.min(attemptIndex, 4);
  return Math.min(base, 16_000);
}

/**
 * GET a Spotify Web API path (e.g. "/tracks/4iV5W9uYEdYUVa79Axb7U9" or full URL).
 * Queued globally + gap between calls; retries HTTP 429 using `Retry-After` or backoff.
 */
async function spotifyGetImpl(pathOrUrl) {
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `https://api.spotify.com/v1${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;

  const maxAttempts = 4;
  const timeoutMs = fetchTimeoutMs();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const token = await getAccessToken();
    let res;
    try {
      const signal =
        typeof AbortSignal !== "undefined" && AbortSignal.timeout
          ? AbortSignal.timeout(timeoutMs)
          : undefined;
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      const name = err && typeof err === "object" ? err.name : "";
      if (name === "AbortError" || name === "TimeoutError") {
        return {
          status: 504,
          body: {
            error: {
              message: `Spotify API request timed out after ${timeoutMs}ms`,
            },
          },
        };
      }
      throw err;
    }

    if (res.status === 429 && attempt < maxAttempts - 1) {
      await res.text(); /* drain body before retry */
      const fromHeader = retryAfterMsFromHeaders(res.headers);
      const waitMs = fromHeader ?? backoffMsFor429(attempt);
      console.warn(
        `[spotify] rate limited (429), waiting ${waitMs}ms before retry ${attempt + 2}/${maxAttempts}`,
      );
      await sleep(waitMs);
      continue;
    }

    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    return { status: res.status, body };
  }
}

export async function spotifyGet(pathOrUrl) {
  const gap = spotifyRequestMinGapMs();
  const p = spotifyRequestChain.then(() => spotifyGetImpl(pathOrUrl));
  spotifyRequestChain = p
    .finally(async () => {
      if (gap > 0) await sleep(gap);
    })
    .catch(() => {});
  return p;
}

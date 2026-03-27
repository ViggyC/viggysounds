/**
 * SoundCloud OAuth 2.1 — authorization code + PKCE (S256).
 * https://developers.soundcloud.com/docs/api/guide
 */

import crypto from "crypto";

const PENDING_TTL_MS = 10 * 60 * 1000;

/** state -> { codeVerifier, expires } */
const pendingByState = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [state, v] of pendingByState) {
    if (v.expires < now) pendingByState.delete(state);
  }
}, 60 * 1000).unref?.();

function base64Url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * RFC 7636 PKCE: code_verifier + S256 code_challenge.
 */
export function createPkcePair() {
  const codeVerifier = base64Url(crypto.randomBytes(32));
  const codeChallenge = base64Url(
    crypto.createHash("sha256").update(codeVerifier).digest(),
  );
  return { codeVerifier, codeChallenge };
}

export function randomOAuthState() {
  return base64Url(crypto.randomBytes(24));
}

/**
 * Must match the redirect URI registered in the SoundCloud app exactly.
 */
export function getSoundCloudRedirectUri() {
  const fromEnv = process.env.SOUNDCLOUD_REDIRECT_URI?.trim();
  if (fromEnv) return fromEnv;
  const port = Number(process.env.PORT) || 3001;
  return `http://localhost:${port}/api/soundcloud/auth/callback`;
}

export function registerPendingAuth(state, codeVerifier) {
  pendingByState.set(state, {
    codeVerifier,
    expires: Date.now() + PENDING_TTL_MS,
  });
}

/**
 * Validates state, returns code_verifier once, removes pending entry.
 */
export function consumePendingAuth(state) {
  const entry = pendingByState.get(state);
  if (!entry) return null;
  pendingByState.delete(state);
  if (entry.expires < Date.now()) return null;
  return entry;
}

export function buildAuthorizeUrl({ codeChallenge, state, redirectUri }) {
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID?.trim();
  if (!clientId) throw new Error("SOUNDCLOUD_CLIENT_ID is required");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  return `https://secure.soundcloud.com/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens (requires client_secret per SoundCloud).
 */
export async function exchangeAuthorizationCode({
  code,
  codeVerifier,
  redirectUri,
}) {
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID?.trim();
  const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET are required",
    );
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    code,
  });

  const res = await fetch("https://secure.soundcloud.com/oauth/token", {
    method: "POST",
    headers: {
      Accept: "application/json; charset=utf-8",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(
      typeof data === "object" && data && "error" in data
        ? `SoundCloud token error ${res.status}: ${JSON.stringify(data)}`
        : `SoundCloud token error ${res.status}: ${text}`,
    );
  }

  return data;
}

/**
 * Refresh user access token (SoundCloud rotates refresh_token — store the new one).
 * https://developers.soundcloud.com/docs/api/guide#refreshing-tokens
 */
export async function exchangeRefreshToken(refreshToken) {
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID?.trim();
  const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET are required",
    );
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetch("https://secure.soundcloud.com/oauth/token", {
    method: "POST",
    headers: {
      Accept: "application/json; charset=utf-8",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(
      typeof data === "object" && data && "error" in data
        ? `SoundCloud refresh error ${res.status}: ${JSON.stringify(data)}`
        : `SoundCloud refresh error ${res.status}: ${text}`,
    );
  }

  return data;
}

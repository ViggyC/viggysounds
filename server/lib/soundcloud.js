/**
 * SoundCloud API — OAuth 2.1 client credentials (server-only).
 * https://developers.soundcloud.com/docs/api/guide
 *
 * Token: POST https://secure.soundcloud.com/oauth/token
 */

import {
  getValidUserAccessToken,
  hasPersistedOrEnvUserToken,
} from "./soundcloudUserTokens.js";

let cache = { token: null, expiresAt: 0 };

export function soundcloudConfigured() {
  return (
    Boolean(process.env.SOUNDCLOUD_CLIENT_ID) &&
    Boolean(process.env.SOUNDCLOUD_CLIENT_SECRET)
  );
}

async function getAccessToken() {
  const now = Date.now();
  if (cache.token && cache.expiresAt > now + 5000) {
    return cache.token;
  }

  const id = process.env.SOUNDCLOUD_CLIENT_ID;
  const secret = process.env.SOUNDCLOUD_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET are required",
    );
  }

  const res = await fetch("https://secure.soundcloud.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`SoundCloud token error ${res.status}: ${text}`);
  }

  const data = JSON.parse(text);
  cache.token = data.access_token;
  const expiresIn =
    typeof data.expires_in === "number" ? data.expires_in : 3600;
  cache.expiresAt = now + (expiresIn - 60) * 1000;
  return cache.token;
}

/**
 * GET a SoundCloud API path (e.g. "/tracks/123" or "/resolve?url=...").
 * Base: https://api.soundcloud.com
 */
export async function soundcloudGet(pathOrUrl) {
  const token = await getAccessToken();
  return soundcloudFetchWithToken(pathOrUrl, token);
}

/**
 * User-scoped SoundCloud API (e.g. GET /me/tracks).
 * Uses persisted tokens + refresh, or SOUNDCLOUD_USER_ACCESS_TOKEN. See:
 * https://developers.soundcloud.com/docs/api/explorer/open-api#/me/get_me_tracks
 */
export function soundcloudUserConfigured() {
  return hasPersistedOrEnvUserToken();
}

export async function soundcloudGetUser(pathOrUrl) {
  const token = await getValidUserAccessToken();
  return soundcloudFetchWithToken(pathOrUrl, token);
}

async function soundcloudFetchWithToken(pathOrUrl, token) {
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `https://api.soundcloud.com${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return { status: res.status, body };
}

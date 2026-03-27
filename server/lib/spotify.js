/**
 * Spotify Web API — Client Credentials flow (server-only).
 * https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow
 */

let cache = { token: null, expiresAt: 0 };

export function spotifyConfigured() {
  return Boolean(
    process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET,
  );
}

async function getAccessToken() {
  const now = Date.now();
  if (cache.token && cache.expiresAt > now + 5000) {
    return cache.token;
  }

  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required");
  }

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
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

/**
 * GET a Spotify Web API path (e.g. "/tracks/4iV5W9uYEdYUVa79Axb7U9" or full URL).
 */
export async function spotifyGet(pathOrUrl) {
  const token = await getAccessToken();
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `https://api.spotify.com/v1${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;

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

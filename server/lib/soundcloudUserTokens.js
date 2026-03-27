/**
 * Persist SoundCloud user OAuth tokens on disk (gitignored) and refresh when expired.
 */

import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { exchangeRefreshToken } from "./soundcloudOAuth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const defaultTokenFile = path.join(
  __dirname,
  "..",
  ".soundcloud-user-tokens.json",
);

/** Persisted user tokens. Set `SOUNDCLOUD_USER_TOKEN_FILE` for a mounted volume (e.g. Fly.io). */
export const SOUNDCLOUD_USER_TOKEN_FILE = process.env.SOUNDCLOUD_USER_TOKEN_FILE?.trim()
  ? path.resolve(process.env.SOUNDCLOUD_USER_TOKEN_FILE)
  : defaultTokenFile;

const SKEW_MS = 60_000;
let refreshInFlight = null;

async function readStore() {
  try {
    const raw = await fs.readFile(SOUNDCLOUD_USER_TOKEN_FILE, "utf8");
    const data = JSON.parse(raw);
    if (data && typeof data.access_token === "string") {
      return data;
    }
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
  return null;
}

async function writeStore(data) {
  const tmp = `${SOUNDCLOUD_USER_TOKEN_FILE}.${process.pid}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tmp, payload, "utf8");
  await fs.rename(tmp, SOUNDCLOUD_USER_TOKEN_FILE);
}

function expiresAtFromResponse(tokens) {
  const expiresIn =
    typeof tokens.expires_in === "number" ? tokens.expires_in : 3600;
  return Date.now() + expiresIn * 1000 - SKEW_MS;
}

/**
 * Call after authorization_code or refresh — persists access + refresh + expiry.
 * Keeps previous refresh_token if the response omits a new one.
 */
export async function persistUserTokensFromOAuthResponse(
  tokens,
  previousStore = null,
) {
  if (!tokens.access_token) {
    throw new Error("Token response missing access_token");
  }
  const refresh =
    typeof tokens.refresh_token === "string" && tokens.refresh_token
      ? tokens.refresh_token
      : previousStore?.refresh_token ?? "";

  const row = {
    access_token: tokens.access_token,
    refresh_token: refresh,
    expires_at: expiresAtFromResponse(tokens),
    scope:
      typeof tokens.scope === "string"
        ? tokens.scope
        : previousStore?.scope ?? "",
    updated_at: new Date().toISOString(),
  };
  await writeStore(row);
  return row;
}

async function refreshAndPersist(refreshToken) {
  const prev = await readStore();
  const tokens = await exchangeRefreshToken(refreshToken);
  return persistUserTokensFromOAuthResponse(tokens, prev);
}

/**
 * Valid Bearer token for user API (/me/*). Uses token file + refresh, or env fallback.
 */
export async function getValidUserAccessToken() {
  const fromEnv = process.env.SOUNDCLOUD_USER_ACCESS_TOKEN?.trim();
  const store = await readStore();

  if (store?.refresh_token) {
    if (
      typeof store.expires_at === "number" &&
      store.expires_at > Date.now() + 15_000
    ) {
      return store.access_token;
    }
    if (!refreshInFlight) {
      refreshInFlight = refreshAndPersist(store.refresh_token).finally(() => {
        refreshInFlight = null;
      });
    }
    const updated = await refreshInFlight;
    return updated.access_token;
  }

  if (
    store?.access_token &&
    typeof store.expires_at === "number" &&
    store.expires_at > Date.now() + 15_000
  ) {
    return store.access_token;
  }

  if (fromEnv) return fromEnv;

  if (store?.access_token) {
    throw new Error(
      "SoundCloud user token expired. Open GET /api/soundcloud/auth/start again or set SOUNDCLOUD_USER_ACCESS_TOKEN.",
    );
  }

  throw new Error(
    "No SoundCloud user token. Open GET /api/soundcloud/auth/start once, or set SOUNDCLOUD_USER_ACCESS_TOKEN.",
  );
}

/** Sync check for /health: env token or persisted file exists */
export function hasPersistedOrEnvUserToken() {
  if (process.env.SOUNDCLOUD_USER_ACCESS_TOKEN?.trim()) return true;
  return existsSync(SOUNDCLOUD_USER_TOKEN_FILE);
}

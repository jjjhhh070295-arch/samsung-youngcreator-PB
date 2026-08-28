/**
 * KIS OAuth2 token — in-memory + /tmp file cache.
 * No Supabase dependency (standalone trader app).
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const KIS_BASE = process.env.KIS_BASE_URL ?? "https://openapi.koreainvestment.com:9443";
const TOKEN_URL = `${KIS_BASE}/oauth2/tokenP`;
const TOKEN_FILE = join(process.env.TMPDIR ?? process.env.TEMP ?? "/tmp", "kis-token-cache-trader.json");

interface CachedToken {
  access_token: string;
  expires_at: number;
}

const g = global as typeof global & { __kisTraderTokenCache?: CachedToken };
let pendingIssue: Promise<string> | null = null;

function readFileCache(): CachedToken | null {
  try {
    const raw = readFileSync(TOKEN_FILE, "utf8");
    const parsed = JSON.parse(raw) as CachedToken;
    if (parsed.expires_at - Date.now() <= 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeFileCache(token: CachedToken): void {
  try {
    writeFileSync(TOKEN_FILE, JSON.stringify(token), "utf8");
  } catch {
    /* ignore */
  }
}

async function issueToken(appKey: string, appSecret: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: appKey,
      appsecret: appSecret,
    }),
    cache: "no-store",
  });
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    const desc = json.error_description ?? `KIS token failed (${res.status})`;
    if (/appsecret|appkey/i.test(desc) && (!appSecret || !appKey)) {
      throw new Error(
        `${desc} — .env.local의 KIS_APP_KEY / KIS_APP_SECRET 확인 후 npm run dev·worker 재시작`,
      );
    }
    throw new Error(desc);
  }
  const expiresInSec = Number(json.expires_in ?? 86400);
  const cached: CachedToken = {
    access_token: json.access_token,
    expires_at: Date.now() + expiresInSec * 1000,
  };
  g.__kisTraderTokenCache = cached;
  writeFileCache(cached);
  return cached.access_token;
}

export async function getKisToken(appKey: string, appSecret: string): Promise<string> {
  const mem = g.__kisTraderTokenCache;
  if (mem && mem.expires_at - Date.now() > 60_000) return mem.access_token;

  const file = readFileCache();
  if (file) {
    g.__kisTraderTokenCache = file;
    return file.access_token;
  }

  if (!pendingIssue) {
    pendingIssue = issueToken(appKey, appSecret).finally(() => {
      pendingIssue = null;
    });
  }
  return pendingIssue;
}

// KIS OAuth2 토큰 발급 + 4-tier 캐싱
//
// 캐시 계층:
//   1순위 — Node.js global 객체 (동일 프로세스 내 HMR 재로드 생존)
//   2순위 — /tmp/kis-token-cache.json (프로세스 재시작 생존, 개발전용)
//   3순위 — Supabase kis_token_cache 테이블 (Vercel 인스턴스·기기 간 공유)
//   → KIS tokenP 일일 발급 한도를 최대한 아낌

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";

const KIS_BASE  = process.env.KIS_BASE_URL ?? "https://openapi.koreainvestment.com:9443";
const TOKEN_URL = `${KIS_BASE}/oauth2/tokenP`;

// 임시 파일 위치 (개발 전용 — Vercel은 /tmp 쓰기 가능하나 ephemal)
const TOKEN_FILE = join(process.env.TMPDIR ?? process.env.TEMP ?? "/tmp", "kis-token-cache.json");

interface CachedToken {
  access_token: string;
  expires_at: number; // epoch ms
}

// ① global 캐시 (HMR 재로드에 생존)
const g = global as typeof global & { __kisTokenCache?: CachedToken };

// ── Supabase 캐시 (3순위) ──────────────────────────────────────────────────

let _supabaseAdmin: ReturnType<typeof createClient> | null | undefined = undefined;

function getSupabaseAdmin() {
  if (_supabaseAdmin !== undefined) return _supabaseAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { _supabaseAdmin = null; return null; }
  _supabaseAdmin = createClient(url, key, { auth: { persistSession: false } });
  return _supabaseAdmin;
}

function hashAppKey(appKey: string): string {
  return createHash("sha256").update(appKey).digest("hex").slice(0, 16);
}

async function readSupabaseCache(appKey: string): Promise<CachedToken | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  try {
    const { data, error } = await admin
      .from("kis_token_cache")
      .select("access_token, expires_at")
      .eq("app_key_hash", hashAppKey(appKey))
      .single();
    if (error || !data) return null;
    const row = data as unknown as { access_token: string; expires_at: string };
    const expiresAt = new Date(row.expires_at).getTime();
    if (expiresAt - Date.now() <= 60_000) return null;
    return { access_token: row.access_token, expires_at: expiresAt };
  } catch {
    return null;
  }
}

async function writeSupabaseCache(appKey: string, token: CachedToken): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("kis_token_cache") as any).upsert(
      {
        app_key_hash: hashAppKey(appKey),
        access_token: token.access_token,
        expires_at:   new Date(token.expires_at).toISOString(),
        updated_at:   new Date().toISOString(),
      },
      { onConflict: "app_key_hash" },
    );
  } catch {
    // Supabase 저장 실패는 무시 (토큰 자체는 발급됨)
  }
}

function readFileCache(): CachedToken | null {
  try {
    const raw = readFileSync(TOKEN_FILE, "utf-8");
    const obj = JSON.parse(raw) as CachedToken;
    if (obj.access_token && obj.expires_at > Date.now() + 60_000) return obj;
  } catch {
    // 파일 없음 or 파싱 실패 → 무시
  }
  return null;
}

function writeFileCache(token: CachedToken) {
  try {
    writeFileSync(TOKEN_FILE, JSON.stringify(token), "utf-8");
  } catch {
    // 쓰기 실패 시 무시 (파일 캐시는 선택적)
  }
}

export async function getKisToken(appKey: string, appSecret: string): Promise<string> {
  const now = Date.now();

  // ① global 캐시 확인
  if (g.__kisTokenCache && g.__kisTokenCache.expires_at - now > 60_000) {
    return g.__kisTokenCache.access_token;
  }

  // ② 파일 캐시 확인 (서버 재시작 후에도 유효 토큰 재사용)
  const fileCached = readFileCache();
  if (fileCached) {
    g.__kisTokenCache = fileCached; // global에도 동기화
    return fileCached.access_token;
  }

  // ③ Supabase 캐시 확인 (Vercel 인스턴스·기기 간 공유)
  const supabaseCached = await readSupabaseCache(appKey);
  if (supabaseCached) {
    g.__kisTokenCache = supabaseCached;
    writeFileCache(supabaseCached); // /tmp에도 채워 다음 재시작 빠르게
    return supabaseCached.access_token;
  }

  // ④ KIS tokenP 신규 발급
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
    cache: "no-store",
  });

  if (!res.ok) {
    // 403/429 rate-limit: 만료된 캐시라도 반환 (오늘은 못 갱신)
    const stale = g.__kisTokenCache ?? readFileCache();
    if (stale) return stale.access_token;
    throw new Error(`KIS token error: ${res.status}`);
  }

  const json = await res.json();
  if (!json.access_token) {
    const stale = g.__kisTokenCache ?? readFileCache();
    if (stale) return stale.access_token;
    throw new Error(`KIS token missing in response`);
  }

  const cached: CachedToken = {
    access_token: json.access_token,
    expires_at:   now + (json.expires_in ?? 86_400) * 1_000,
  };
  g.__kisTokenCache = cached;
  writeFileCache(cached);
  await writeSupabaseCache(appKey, cached); // Supabase에도 저장 (인스턴스 간 공유)
  return cached.access_token;
}

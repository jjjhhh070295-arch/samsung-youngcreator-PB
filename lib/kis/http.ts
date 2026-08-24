import { getKisConfig } from "./config";
import { getKisToken } from "./token";

const KIS_REQUEST_INTERVAL_MS = 600;
const QUOTE_CACHE_TTL_MS = 30_000;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 400;

const quoteCache = new Map<string, { body: unknown; expiresAt: number }>();

let lastRequestAt = 0;
let throttleChain: Promise<void> = Promise.resolve();

type FetchImpl = typeof fetch;

export interface KisRequestOptions {
  path: string;
  method?: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  trId: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: Record<string, unknown>;
  fetchImpl?: FetchImpl;
}

function buildUrl(baseUrl: string, path: string, query?: KisRequestOptions["query"]): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function isQuotationPath(path: string): boolean {
  return path.includes("/quotations/");
}

function cacheKey(method: string, url: string, trId: string): string {
  return `${method}:${trId}:${url}`;
}

async function waitForThrottle(): Promise<void> {
  throttleChain = throttleChain.then(async () => {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < KIS_REQUEST_INTERVAL_MS) {
      await new Promise<void>((resolve) => setTimeout(resolve, KIS_REQUEST_INTERVAL_MS - elapsed));
    }
    lastRequestAt = Date.now();
  });
  await throttleChain;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeForLog(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (/token|secret|appkey|authorization|cano|account/i.test(value)) {
      return "[redacted]";
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/token|secret|appkey|authorization|cano|account|access_token/i.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = sanitizeForLog(nested);
      }
    }
    return out;
  }
  return value;
}

function shouldRetry(status: number, payload: Record<string, unknown> | null): boolean {
  if (status >= 500) return true;
  const code = String(payload?.msg_cd ?? payload?.error_code ?? "");
  return code === "EGW00201";
}

/** Test helper — reset throttle timing between isolated test cases. */
export function resetKisHttpStateForTests(): void {
  lastRequestAt = 0;
  throttleChain = Promise.resolve();
  quoteCache.clear();
}

export async function kisRequest<T = unknown>(options: KisRequestOptions): Promise<T> {
  const config = getKisConfig();
  const method = options.method ?? "GET";
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = buildUrl(config.baseUrl, options.path, options.query);

  if (method === "GET" && isQuotationPath(options.path)) {
    const key = cacheKey(method, url, options.trId);
    const cached = quoteCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.body as T;
    }
  }

  const token = await getKisToken(config.appKey, config.appSecret);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    await waitForThrottle();
    try {
      const res = await fetchImpl(url, {
        method,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          authorization: `Bearer ${token}`,
          appkey: config.appKey,
          appsecret: config.appSecret,
          tr_id: options.trId,
          custtype: "P",
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        cache: "no-store",
      });

      const text = await res.text();
      let payload: Record<string, unknown> | null = null;
      try {
        payload = text ? (JSON.parse(text) as Record<string, unknown>) : null;
      } catch {
        payload = { raw: text.slice(0, 200) };
      }

      if (!res.ok && shouldRetry(res.status, payload) && attempt < MAX_RETRIES) {
        await sleep(INITIAL_BACKOFF_MS * 2 ** attempt);
        continue;
      }

      if (!res.ok) {
        const msg = String(payload?.msg1 ?? payload?.message ?? res.statusText);
        if (process.env.NODE_ENV !== "test") {
          console.error("[kisRequest] failed", sanitizeForLog({ status: res.status, trId: options.trId, msg }));
        }
        throw new Error(`KIS request failed (${res.status}): ${msg}`);
      }

      const rtCd = String(payload?.rt_cd ?? "0");
      if (rtCd !== "0") {
        const msg = String(payload?.msg1 ?? payload?.msg_cd ?? "unknown KIS error");
        if (shouldRetry(500, payload) && attempt < MAX_RETRIES) {
          await sleep(INITIAL_BACKOFF_MS * 2 ** attempt);
          continue;
        }
        throw new Error(`KIS API error (${rtCd}): ${msg}`);
      }

      if (method === "GET" && isQuotationPath(options.path)) {
        const key = cacheKey(method, url, options.trId);
        quoteCache.set(key, { body: payload, expiresAt: Date.now() + QUOTE_CACHE_TTL_MS });
      }

      return payload as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES) {
        await sleep(INITIAL_BACKOFF_MS * 2 ** attempt);
        continue;
      }
    }
  }

  throw lastError ?? new Error("KIS request failed after retries");
}

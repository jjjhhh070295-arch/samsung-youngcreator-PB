import { isIP } from "node:net";

/** Server-side only. The caller supplies a transport; this module never reads credentials or env. */
export type CollectionGrant = {
  providerId: string;
  allowedOrigins: readonly string[];
  allowedPathPrefixes: readonly string[];
  fetchAllowed: boolean;
  extractAllowed: boolean;
  displayAllowed: boolean;
  approvalReference: string | null;
  expiresAt: string | null;
};

export type CollectionResult =
  | { status: "collected"; contentType: "pdf" | "html"; bytes: Uint8Array; sourceUrl: string; fetchedAt: string }
  | { status: "withheld" | "failed"; reason: string };

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const day = value.slice(0, 10);
  const midnight = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(midnight.getTime()) && midnight.toISOString().slice(0, 10) === day ? parsed : null;
}

function safeUrl(raw: string): URL | null {
  if (typeof raw !== "string" || raw !== raw.trim() || /[\u0000-\u0020\u007f\\]/.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    const authority = raw.match(/^https:\/\/([^/?#]+)/i)?.[1];
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    // Deny all literal IPs (not just private IPs), explicit ports (even :443), and local hostnames.
    if (!authority || authority.includes(":") || authority.includes("@") || parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    if (isIP(hostname) || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || !hostname.includes(".") || hostname.endsWith(".")) return null;
    parsed.hash = "";
    return parsed;
  } catch { return null; }
}

function decodedPath(path: string): string | null {
  let current = path;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let next: string;
    try { next = decodeURIComponent(current); } catch { return null; }
    if (/[\\\u0000-\u0020\u007f?#]/.test(next) || next.includes("//") || next.split("/").some((part) => part === "." || part === "..")) return null;
    if (next === current) return next.startsWith("/") ? next : null;
    current = next;
  }
  return null;
}

function under(path: string, prefix: string): boolean {
  return prefix === "/" || path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

function allowedUrl(raw: string, grant: CollectionGrant): URL | null {
  const url = safeUrl(raw);
  if (!url || !Array.isArray(grant.allowedOrigins) || !Array.isArray(grant.allowedPathPrefixes)) return null;
  const originAllowed = grant.allowedOrigins.some((origin) => {
    const approved = safeUrl(origin);
    return approved && approved.pathname === "/" && !approved.search && !origin.includes("#") && approved.origin === url.origin;
  });
  if (!originAllowed) return null;
  const decoded = decodedPath(url.pathname);
  if (!decoded) return null;
  const pathAllowed = grant.allowedPathPrefixes.some((prefix) => {
    if (typeof prefix !== "string" || !prefix.startsWith("/") || prefix.includes("%")) return false;
    const normalized = decodedPath(prefix);
    return normalized === prefix && under(url.pathname, prefix) && under(decoded, prefix);
  });
  return pathAllowed ? url : null;
}

/**
 * A grant is necessary, not sufficient, for production collection. The production transport
 * must also enforce DNS/IP egress controls: hostname allowlists alone do not stop DNS rebinding.
 * Returned HTML is untrusted data, never permission to render or execute its scripts.
 */
export async function collectDocument(
  input: { url: string; grant: CollectionGrant; now: string },
  transport: typeof fetch,
): Promise<CollectionResult> {
  const now = timestamp(input.now);
  const grant = input.grant;
  if (now === null) return { status: "withheld", reason: "invalid_now" };
  if (!grant || typeof grant.providerId !== "string" || !grant.providerId.trim() || grant.fetchAllowed !== true || grant.extractAllowed !== true || grant.displayAllowed !== true || typeof grant.approvalReference !== "string" || !grant.approvalReference.trim()) {
    return { status: "withheld", reason: "permission_unconfirmed" };
  }
  const expiry = timestamp(grant.expiresAt);
  if (expiry === null || expiry <= now) return { status: "withheld", reason: "grant_expired_or_unconfirmed" };
  const url = allowedUrl(input.url, grant);
  if (!url) return { status: "withheld", reason: "url_not_allowed" };

  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined;
  const cancel = () => {
    try {
      const pending = reader ? reader.cancel() : response?.body?.cancel();
      void pending?.catch(() => undefined);
    } catch { /* Cancellation must never hide a bounded failure. */ }
  };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<CollectionResult>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      cancel();
      resolve({ status: "failed", reason: "timeout" });
    }, TIMEOUT_MS);
  });
  const work = async (): Promise<CollectionResult> => {
    try {
      response = await transport(url.href, {
        method: "GET", redirect: "error", credentials: "omit", cache: "no-store",
        referrerPolicy: "no-referrer", signal: controller.signal,
        headers: { Accept: "application/pdf, text/html" },
      });
      if (controller.signal.aborted) { cancel(); return { status: "failed", reason: "timeout" }; }
      if (response.redirected || (response.url && response.url !== url.href)) { cancel(); return { status: "failed", reason: "redirect_rejected" }; }
      if (response.status < 200 || response.status >= 300) { cancel(); return { status: "failed", reason: "http_error" }; }
      const mime = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      const contentType = mime === "application/pdf" ? "pdf" : mime === "text/html" ? "html" : null;
      if (!contentType) { cancel(); return { status: "failed", reason: "unsupported_content_type" }; }
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > MAX_BYTES)) {
        cancel(); return { status: "failed", reason: "content_length_rejected" };
      }
      if (!response.body) return { status: "failed", reason: "empty_body" };
      reader = response.body.getReader();
      // A fixed buffer also bounds memory overhead when a response yields millions of tiny chunks.
      const bytes = new Uint8Array(MAX_BYTES);
      let total = 0;
      while (true) {
        const chunk = await reader.read();
        if (controller.signal.aborted) return { status: "failed", reason: "timeout" };
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) { cancel(); return { status: "failed", reason: "invalid_chunk" }; }
        if (total + chunk.value.byteLength > MAX_BYTES) { cancel(); return { status: "failed", reason: "body_too_large" }; }
        bytes.set(chunk.value, total);
        total += chunk.value.byteLength;
      }
      if (total === 0) return { status: "failed", reason: "empty_body" };
      return { status: "collected", contentType, bytes: bytes.slice(0, total), sourceUrl: url.href, fetchedAt: new Date(now).toISOString() };
    } catch {
      cancel();
      // Never return transport errors: they can contain credentials, URLs or remote response data.
      return { status: "failed", reason: controller.signal.aborted ? "timeout" : "transport_or_stream_error" };
    }
  };
  try { return await Promise.race([work(), timedOut]); }
  finally { if (timeout !== undefined) clearTimeout(timeout); }
}

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PB_SESSION_COOKIE = "pb-demo-session";
export const PB_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const SESSION_VERSION = 1;
const MINIMUM_SECRET_BYTES = 32;

export interface PbSession {
  version: typeof SESSION_VERSION;
  pbId: string;
  pbName: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export class PbSessionConfigurationError extends Error {
  constructor() {
    super("PB_SESSION_SECRET is missing or shorter than 32 bytes.");
    this.name = "PbSessionConfigurationError";
  }
}

type SessionOptions = {
  secret?: string;
  nowSeconds?: number;
  maxAgeSeconds?: number;
  nonce?: string;
};

function readSessionSecret(explicitSecret?: string): string {
  const secret = explicitSecret ?? process.env.PB_SESSION_SECRET?.trim() ?? "";
  if (Buffer.byteLength(secret, "utf8") < MINIMUM_SECRET_BYTES) {
    throw new PbSessionConfigurationError();
  }
  return secret;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

function safeSignatureEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, "base64url");
  const expectedBytes = Buffer.from(expected, "base64url");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function validSessionShape(value: unknown): value is PbSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<PbSession>;
  return (
    session.version === SESSION_VERSION &&
    typeof session.pbId === "string" &&
    session.pbId.length > 0 &&
    session.pbId.length <= 128 &&
    typeof session.pbName === "string" &&
    session.pbName.length > 0 &&
    session.pbName.length <= 128 &&
    Number.isInteger(session.issuedAt) &&
    Number.isInteger(session.expiresAt) &&
    typeof session.nonce === "string" &&
    session.nonce.length >= 16 &&
    session.nonce.length <= 128
  );
}

export function createPbSessionToken(
  identity: { pbId: string; pbName: string },
  options: SessionOptions = {},
): { token: string; session: PbSession } {
  const secret = readSessionSecret(options.secret);
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? PB_SESSION_MAX_AGE_SECONDS;
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0 || maxAgeSeconds > PB_SESSION_MAX_AGE_SECONDS) {
    throw new Error("Invalid PB session lifetime.");
  }
  const pbId = identity.pbId.trim();
  const pbName = identity.pbName.trim();
  if (!pbId || !pbName || pbId.length > 128 || pbName.length > 128) {
    throw new Error("Invalid PB session identity.");
  }

  const session: PbSession = {
    version: SESSION_VERSION,
    pbId,
    pbName,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + maxAgeSeconds,
    nonce: options.nonce ?? randomBytes(18).toString("base64url"),
  };
  const payload = encodeJson(session);
  return { token: `${payload}.${signPayload(payload, secret)}`, session };
}

export function verifyPbSessionToken(
  token: string | null | undefined,
  options: Pick<SessionOptions, "secret" | "nowSeconds"> & { expectedPbId?: string } = {},
): PbSession | null {
  const secret = readSessionSecret(options.secret);
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, signature] = parts;
  const expectedSignature = signPayload(payload, secret);
  if (!safeSignatureEqual(signature, expectedSignature)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!validSessionShape(parsed)) return null;

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    parsed.issuedAt > nowSeconds + 60 ||
    parsed.expiresAt <= nowSeconds ||
    parsed.expiresAt - parsed.issuedAt > PB_SESSION_MAX_AGE_SECONDS ||
    (options.expectedPbId !== undefined && parsed.pbId !== options.expectedPbId)
  ) {
    return null;
  }
  return parsed;
}

export interface SessionCookieReader {
  get(name: string): { value: string } | undefined;
}

export function readPbSession(
  cookies: SessionCookieReader,
  options: Pick<SessionOptions, "secret" | "nowSeconds"> & { expectedPbId?: string } = {},
): PbSession | null {
  return verifyPbSessionToken(cookies.get(PB_SESSION_COOKIE)?.value, options);
}

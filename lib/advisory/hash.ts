import { createHash } from "crypto";

export function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Node/Edge에서 동기 SHA-256. 브라우저 번들에 넣지 말고 서버·테스트·결정론 엔진에서만 사용. */
export function sha256HexSync(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashObject(value: unknown): string {
  return sha256HexSync(stableStringify(value));
}

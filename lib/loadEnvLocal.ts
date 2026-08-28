/**
 * Next.js는 .env.local을 자동 로드하지만 Worker(tsx)는 그렇지 않음.
 * Worker/스크립트 시작 시 한 번 호출.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

let loaded = false;

export function loadEnvLocal(cwd = process.cwd()): void {
  if (loaded) return;
  loaded = true;

  for (const name of [".env.local", ".env"]) {
    const path = join(cwd, name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
    break;
  }
}

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

const envKeys = [
  "CRON_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const validSecret = "snapshot-test-secret-with-at-least-32-bytes";

// route.ts가 supabase singleton을 읽기 전에 외부 테스트 환경을 제거한다.
// 따라서 올바른 인증은 DB 호출 대신 route의 기존 "Supabase 미설정" 경계까지
// 도달하며, 네트워크나 실제 데이터를 건드리지 않는다.
for (const key of envKeys) delete process.env[key];
let route: typeof import("./route");

before(async () => {
  route = await import("./route");
});

function request(method: "GET" | "POST", authorization?: string, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  if (authorization) headers.set("authorization", authorization);
  return new Request("http://localhost/api/research/snapshot", { method, headers });
}

beforeEach(() => {
  for (const key of envKeys) delete process.env[key];
});

after(() => {
  for (const key of envKeys) {
    const value = previousEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("research snapshot route authorization", () => {
  it("CRON_SECRET이 없거나 빈 값이면 GET과 POST를 모두 503으로 fail-closed 처리", async () => {
    for (const configuredValue of [undefined, "", "   "] as const) {
      if (configuredValue === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = configuredValue;

      for (const handler of [route.GET, route.POST]) {
        const response = await handler(request(handler === route.GET ? "GET" : "POST"));
        assert.equal(response.status, 503);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(await response.json(), {
          ok: false,
          error: "Snapshot authorization is not configured.",
          code: "AUTH_NOT_CONFIGURED",
        });
      }
    }
  });

  it("호출자가 주장하는 cron/principal 헤더만으로는 승인하지 않음", async () => {
    const response = await route.GET(request("GET", undefined, {
      "x-vercel-cron": "1",
      "x-research-server-principal": "attacker-controlled",
    }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "AUTH_NOT_CONFIGURED");
  });

  it("잘못되거나 malformed인 Bearer token은 GET과 POST에서 401", async () => {
    process.env.CRON_SECRET = validSecret;

    for (const [handler, method] of [[route.GET, "GET"], [route.POST, "POST"]] as const) {
      const wrong = await handler(request(method, "Bearer wrong-secret"));
      assert.equal(wrong.status, 401);
      const wrongBody = await wrong.json();
      assert.deepEqual(wrongBody, {
        ok: false,
        error: "Unauthorized",
        code: "UNAUTHORIZED",
      });
      assert.doesNotMatch(JSON.stringify(wrongBody), /wrong-secret/);

      const malformed = await handler(request(method, `Basic ${validSecret}`));
      assert.equal(malformed.status, 401);
      assert.equal((await malformed.json()).code, "UNAUTHORIZED");
    }
  });

  it("정확한 Bearer token만 GET과 POST의 snapshot 실행 경계에 도달", async () => {
    process.env.CRON_SECRET = validSecret;

    for (const [handler, method] of [[route.GET, "GET"], [route.POST, "POST"]] as const) {
      const response = await handler(request(method, `Bearer ${validSecret}`));
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { ok: false, error: "Supabase 미설정" });
    }
  });
});

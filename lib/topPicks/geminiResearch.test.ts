import assert from "node:assert/strict";
import { it } from "node:test";
import { generateResearchStructured } from "./geminiResearch";

it("Gemini transport uses the configured model and never falls back to Claude", async () => {
  const originalFetch = globalThis.fetch;
  const names = ["GEMINI_API_KEY", "GEMINI_MODEL", "ANTHROPIC_API_KEY", "TOP_PICKS_LLM_PROVIDER"] as const;
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  let calls = 0;
  let status = 200;
  let reason = "STOP";
  let output = '{"headline":"검증된 요약"}';
  try {
    process.env.GEMINI_API_KEY = "test-only-key";
    process.env.GEMINI_MODEL = "gemini-test";
    process.env.ANTHROPIC_API_KEY = "test-only-unused";
    process.env.TOP_PICKS_LLM_PROVIDER = "claude";
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(String(url), "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
      assert.equal(new Headers(options?.headers).get("x-goog-api-key"), "test-only-key");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      assert.deepEqual(body.generationConfig.responseSchema, { type: "object" });
      return new Response(JSON.stringify({ candidates: [{ finishReason: reason, content: { parts: [{ text: output }] } }] }), { status });
    };
    assert.deepEqual(await generateResearchStructured("리서치 본문", { type: "object" }), {
      model: "gemini-test", value: { headline: "검증된 요약" },
    });
    status = 429;
    await assert.rejects(generateResearchStructured("본문", { type: "object" }), /Gemini HTTP 429/);
    assert.equal(calls, 2);
    status = 200; reason = "MAX_TOKENS";
    await assert.rejects(generateResearchStructured("본문", { type: "object" }), /완료되지/);
    reason = "STOP"; output = "invalid json";
    await assert.rejects(generateResearchStructured("본문", { type: "object" }), /JSON/);
    delete process.env.GEMINI_API_KEY;
    await assert.rejects(generateResearchStructured("본문", { type: "object" }), /GEMINI_API_KEY/);
    assert.equal(calls, 4);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
});

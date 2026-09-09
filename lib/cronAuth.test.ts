import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cronSecret, cronSecrets, isAuthorizedCronRequest } from "./cronAuth";

const originalCron = process.env.CRON_SECRET;
const originalBriefing = process.env.BRIEFING_CRON_SECRET;
const originalNodeEnv = process.env.NODE_ENV;
const env = process.env as Record<string, string | undefined>;

afterEach(() => {
  if (originalCron === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCron;
  if (originalBriefing === undefined) delete process.env.BRIEFING_CRON_SECRET;
  else process.env.BRIEFING_CRON_SECRET = originalBriefing;
  if (originalNodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = originalNodeEnv;
});

describe("cron request authorization", () => {
  it("prefers Vercel CRON_SECRET and accepts either configured secret", () => {
    env.NODE_ENV = "production";
    process.env.CRON_SECRET = "vercel-cron";
    process.env.BRIEFING_CRON_SECRET = "manual-briefing";
    assert.equal(cronSecret(), "vercel-cron");
    assert.deepEqual(cronSecrets(), ["vercel-cron", "manual-briefing"]);
    assert.equal(isAuthorizedCronRequest(new Request("https://example.com", { headers: { authorization: "Bearer vercel-cron" } })), true);
    assert.equal(isAuthorizedCronRequest(new Request("https://example.com", { headers: { authorization: "Bearer manual-briefing" } })), true);
    assert.equal(isAuthorizedCronRequest(new Request("https://example.com", { headers: { authorization: "Bearer wrong" } })), false);
  });

  it("fails closed in production when no secret is configured", () => {
    env.NODE_ENV = "production";
    delete process.env.CRON_SECRET;
    delete process.env.BRIEFING_CRON_SECRET;
    assert.equal(isAuthorizedCronRequest(new Request("https://example.com")), false);
  });

  it("keeps the local development exception", () => {
    env.NODE_ENV = "development";
    delete process.env.CRON_SECRET;
    delete process.env.BRIEFING_CRON_SECRET;
    assert.equal(isAuthorizedCronRequest(new Request("http://localhost")), true);
  });
});

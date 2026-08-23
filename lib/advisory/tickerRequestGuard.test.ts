import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTickerRequestGuard } from "./tickerRequestGuard";

describe("ticker request state isolation", () => {
  it("느린 A 요청이 뒤에 시작한 B 요청을 덮지 못한다", () => {
    const guard = createTickerRequestGuard("global");
    const requestA = guard.begin();
    const requestB = guard.begin();
    assert.equal(guard.isCurrent(requestA), false);
    assert.equal(guard.isCurrent(requestB), true);
  });

  it("고객 scope 전환은 이전 고객의 최신 요청도 무효화한다", () => {
    const guard = createTickerRequestGuard("client-a");
    const clientA = guard.begin("client-a");
    const clientB = guard.invalidate("client-b");
    assert.equal(guard.isCurrent(clientA), false);
    assert.equal(guard.isCurrent(clientB), true);
    assert.equal(guard.current().scopeKey, "client-b");
  });
});

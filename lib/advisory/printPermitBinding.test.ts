import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSamePrintAttempt, type PrintAttemptIdentity } from "./printPermitBinding";

describe("print permit browser binding", () => {
  const original: PrintAttemptIdentity = {
    epoch: 7,
    routeKey: "pb-a\u0000client-a",
    permitKey: "client-a\u0000pb-a\u0000evidence-a\u0000token-a",
  };

  it("같은 검증 세대·고객 경로·허가 토큰만 인쇄 가능", () => {
    assert.equal(isSamePrintAttempt(original, { ...original }), true);
  });

  it("토큰 소비 중 고객·경로·세대·토큰이 바뀌면 모두 fail-closed", () => {
    assert.equal(
      isSamePrintAttempt(original, { ...original, routeKey: "pb-a\u0000client-b" }),
      false,
    );
    assert.equal(isSamePrintAttempt(original, { ...original, epoch: 8 }), false);
    assert.equal(isSamePrintAttempt(original, { ...original, permitKey: "token-b" }), false);
    assert.equal(isSamePrintAttempt({ ...original, permitKey: "" }, { ...original, permitKey: "" }), false);
  });
});

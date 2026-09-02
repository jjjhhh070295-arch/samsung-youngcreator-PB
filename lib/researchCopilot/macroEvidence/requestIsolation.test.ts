import assert from "node:assert/strict";
import test from "node:test";
import { canApplyMacroResponse, macroRequestIdentity } from "./requestIsolation";

test("PB and client identity is encoded as a stable request boundary", () => {
  assert.equal(macroRequestIdentity("pb/one", "client A"), "pb%2Fone:client%20A");
});
test("customer switching rejects the previous generation and identity", () => {
  assert.equal(canApplyMacroResponse({
    aborted: false,
    expectedGeneration: 3,
    actualGeneration: 4,
    expectedIdentity: "pb:a",
    actualIdentity: "pb:b",
  }), false);
  assert.equal(canApplyMacroResponse({
    aborted: false,
    expectedGeneration: 4,
    actualGeneration: 4,
    expectedIdentity: "pb:b",
    actualIdentity: "pb:b",
  }), true);
  assert.equal(canApplyMacroResponse({
    aborted: true,
    expectedGeneration: 4,
    actualGeneration: 4,
    expectedIdentity: "pb:b",
    actualIdentity: "pb:b",
  }), false);
});

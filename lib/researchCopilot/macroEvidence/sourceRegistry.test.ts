import assert from "node:assert/strict";
import test from "node:test";
import {
  macroMayReachConsumer,
  RIGHTS_REVIEW_REGISTRY,
  rightsReviewPlaceholders,
} from "./sourceRegistry";

test("licensed credit and volatility data remains blocked without an API connector", () => {
  const ids = RIGHTS_REVIEW_REGISTRY.map((entry) => entry.seriesId);
  assert.deepEqual(ids, [
    "kr-card-bond-spread",
    "us-ig-oas",
    "us-hy-oas",
    "cboe-vix",
    "hyperscaler-bond-spread",
    "hyperscaler-cds-premium",
  ]);
  assert.ok(RIGHTS_REVIEW_REGISTRY.every((entry) => !("endpoint" in entry) && !("apiKey" in entry)));
  assert.ok(rightsReviewPlaceholders().every((item) => item.status === "blocked"));
});
test("macro evidence cannot automatically reach investment decisions or customer output", () => {
  assert.equal(macroMayReachConsumer("portfolio"), false);
  assert.equal(macroMayReachConsumer("productRecommendation"), false);
  assert.equal(macroMayReachConsumer("customerOutput"), false);
  assert.equal(macroMayReachConsumer("aiNumericGeneration"), false);
});

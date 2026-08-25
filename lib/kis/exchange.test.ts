import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildExchangeOrderFields, resolveExchangeRoute } from "./exchange";

describe("exchange routing", () => {
  it("defaults to SOR when eligible", () => {
    const r = resolveExchangeRoute({ mode: "SOR", nxtEligible: true });
    assert.equal(r.effective, "SOR");
    assert.equal(r.switched, false);
  });

  it("blocks NXT direct for ineligible and switches to SOR", () => {
    const r = resolveExchangeRoute({ mode: "NXT", nxtEligible: false });
    assert.equal(r.effective, "SOR");
    assert.equal(r.switched, true);
    assert.match(r.reason, /NXT 비대상/);
  });

  it("builds official EXCG_ID_DVSN_CD fields", () => {
    const f = buildExchangeOrderFields("KRX");
    assert.equal(f.EXCG_ID_DVSN_CD, "KRX");
    assert.equal(f.SLL_TYPE, "01");
    assert.equal(f.CNDT_PRIC, "0");
  });
});

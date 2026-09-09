import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parsePortfolioWorkflowStep,
  portfolioWorkflowHref,
} from "./portfolioWorkflowStep";

describe("portfolioWorkflowStep", () => {
  it("defaults missing step to allocation", () => {
    assert.equal(parsePortfolioWorkflowStep(null), "allocation");
    assert.equal(parsePortfolioWorkflowStep(undefined), "allocation");
    assert.equal(parsePortfolioWorkflowStep(""), "allocation");
  });

  it("parses known steps and aliases", () => {
    assert.equal(parsePortfolioWorkflowStep("allocation"), "allocation");
    assert.equal(parsePortfolioWorkflowStep("instruments"), "instruments");
    assert.equal(parsePortfolioWorkflowStep("approval"), "approval");
    assert.equal(parsePortfolioWorkflowStep("2"), "instruments");
    assert.equal(parsePortfolioWorkflowStep("tax"), "approval");
  });

  it("builds portfolioStep URLs without inventing new tabs", () => {
    assert.equal(
      portfolioWorkflowHref("PB-001", "c1", "instruments"),
      "/pb/PB-001/c1?view=analysis&tab=portfolio2&portfolioStep=instruments",
    );
    assert.equal(
      portfolioWorkflowHref("PB-001", "c1", "approval", { hash: "tax-projection" }),
      "/pb/PB-001/c1?view=analysis&tab=portfolio2&portfolioStep=approval#tax-projection",
    );
  });
});

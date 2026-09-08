import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applySuitabilityCap,
  calculateSurveyScore,
  emptySurveyAnswers,
  isSurveyComplete,
  mapSurveyToIPS,
  tendencyFromConvertedScore,
} from "./investmentSurvey";
import { emptyIPS } from "./types";
import type { Client } from "./types";

const sampleAnswers = {
  ...emptySurveyAnswers(),
  age: "20to40",
  investmentPeriod: "3y_plus",
  investmentExperience: ["active", "neutral"],
  derivativeExperience: "1y_to_3y",
  lossTolerance: "partial_loss",
  investableAssetRatio: "50pct",
  monthlyIncome: "over5m",
  investmentPurpose: "market_avg",
  financialKnowledge: "deep",
  taxConsideration: "tax3",
  uniqueSituation: "자녀 증여 예정",
};

const sampleClient = (): Client => ({
  id: "c1",
  code: "C-001",
  clientType: "individual",
  name: "테스트",
  birthDate: "1980-01-01",
  assignedPbId: "pb1",
  assetSize: 1_000_000_000,
  consultationNotes: "",
  ips: emptyIPS(),
  cashFlows: [],
  portfolios: [],
  stages: {},
  createdAt: new Date().toISOString(),
});

describe("investmentSurvey scoring", () => {
  it("sums scored answers excluding reference-only question 4", () => {
    const score = calculateSurveyScore(sampleAnswers);
    assert.equal(score.rawScore, 8 + 10 + 8 + 6 + 6 + 6 + 6 + 8);
    assert.equal(score.convertedScore, Math.round((score.rawScore * 1000) / 72) / 10);
  });

  it("maps converted score to tendency labels", () => {
    assert.equal(tendencyFromConvertedScore(15), "안정형");
    assert.equal(tendencyFromConvertedScore(35), "안정추구형");
    assert.equal(tendencyFromConvertedScore(55), "위험중립형");
    assert.equal(tendencyFromConvertedScore(75), "적극투자형");
    assert.equal(tendencyFromConvertedScore(90), "공격투자형");
  });

  it("caps tendency for principal preservation", () => {
    const capped = applySuitabilityCap("공격투자형", "principal_preserve");
    assert.equal(capped.finalTendency, "안정형");
    assert.match(capped.capReason ?? "", /안정형/);
  });

  it("caps tendency for minimal loss", () => {
    const capped = applySuitabilityCap("공격투자형", "minimal_loss");
    assert.equal(capped.finalTendency, "위험중립형");
  });

  it("uses highest score when multiple investment experiences are selected", () => {
    const score = calculateSurveyScore({
      ...sampleAnswers,
      investmentExperience: ["stable", "aggressive"],
    });
    const baseline = calculateSurveyScore(sampleAnswers);
    assert.ok(score.rawScore > baseline.rawScore);
  });
});

describe("investmentSurvey IPS mapping", () => {
  it("maps completed survey to explicit IPS factors including tax", () => {
    const score = calculateSurveyScore(sampleAnswers);
    const ips = mapSurveyToIPS(sampleAnswers, score, sampleClient());
    assert.equal(ips.risk.value, score.finalTendency);
    assert.equal(ips.unique.value, "자녀 증여 예정");
    assert.equal(ips.tax.score, 3);
    assert.match(ips.tax.value, /금융소득 종합과세/);
    assert.equal(ips.tax.status, "explicit");
    assert.ok(ips.return.score != null);
    assert.ok(ips.timeHorizon.score != null);
  });

  it("maps high tax-complexity survey answers to score 5", () => {
    const answers = { ...sampleAnswers, taxConsideration: "tax5" };
    const score = calculateSurveyScore(answers);
    const ips = mapSurveyToIPS(answers, score, sampleClient());
    assert.equal(ips.tax.score, 5);
    assert.match(ips.tax.value, /대규모 세금 이벤트/);
  });

  it("falls back to existing explicit tax when survey tax is empty", () => {
    const client = sampleClient();
    client.ips.tax = {
      value: "증여·상속 이벤트",
      score: 4,
      notes: "",
      source: "manual",
      status: "explicit",
      evidence: "",
      inferenceHint: "",
      reviewed: true,
    };
    const answers = { ...sampleAnswers, taxConsideration: "" };
    const score = calculateSurveyScore(answers);
    const ips = mapSurveyToIPS(answers, score, client);
    assert.equal(ips.tax.value, "증여·상속 이벤트");
    assert.equal(ips.tax.score, 4);
  });

  it("requires all scored questions including tax before submit", () => {
    assert.equal(isSurveyComplete(emptySurveyAnswers()), false);
    assert.equal(isSurveyComplete({ ...sampleAnswers, taxConsideration: "" }), false);
    assert.equal(isSurveyComplete(sampleAnswers), true);
  });
});

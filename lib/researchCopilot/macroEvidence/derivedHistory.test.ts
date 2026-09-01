import assert from "node:assert/strict";
import test from "node:test";
import type { MacroTrendObservation } from "./historyTypes";
import {
  deriveMacroSpreadHistory,
  type DeriveMacroSpreadHistoryInput,
} from "./derivedHistory";

function observation(date: string, valueRaw: string): MacroTrendObservation {
  return {
    observationDate: date,
    observationDateRaw: date,
    valueRaw,
    releaseDate: null,
    vintageDate: null,
    preliminaryFinal: null,
    revisionStatus: null,
    availability: {
      releaseDate: "source_not_provided",
      vintageDate: "source_not_provided",
      preliminaryFinal: "source_not_provided",
      revisionStatus: "source_not_provided",
    },
  };
}

function spreadInput(): DeriveMacroSpreadHistoryInput {
  return {
    left: {
      seriesId: "corp-aa-minus-3y",
      unit: "%",
      definitionVersion: "corp-aa-v1",
      observations: [observation("2026-08-31", "3.10"), observation("2026-09-01", "3.15")],
    },
    right: {
      seriesId: "ktb-3y",
      unit: "%",
      definitionVersion: "ktb-3y-v1",
      observations: [observation("2026-08-31", "2.60"), observation("2026-09-01", "2.55")],
    },
    definition: {
      outputSeriesId: "corp-aa-minus-3y-spread",
      outputUnit: "bp",
      formula: "(credit yield - KTB 3Y yield) * 100",
      leftSeriesId: "corp-aa-minus-3y",
      rightSeriesId: "ktb-3y",
      leftDefinitionVersion: "corp-aa-v1",
      rightDefinitionVersion: "ktb-3y-v1",
      inputUnit: "%",
      multiplier: 100,
    },
  };
}

test("spread history uses only exact same-date inputs and deterministic arithmetic", () => {
  const result = deriveMacroSpreadHistory(spreadInput());
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(result.observations.map(({ observationDate, valueRaw }) => ({ observationDate, valueRaw })), [
    { observationDate: "2026-08-31", valueRaw: "50" },
    { observationDate: "2026-09-01", valueRaw: "60" },
  ]);
  assert.ok(result.observations.every(({ releaseDate, revisionStatus }) =>
    releaseDate === null && revisionStatus === null
  ));
});
test("spread history blocks unit and approved-definition mismatches", () => {
  const wrongUnit = spreadInput();
  wrongUnit.right.unit = "bp";
  const unitResult = deriveMacroSpreadHistory(wrongUnit);
  assert.equal(unitResult.status === "blocked" && unitResult.code, "UNIT_MISMATCH");

  const wrongDefinition = spreadInput();
  wrongDefinition.left.definitionVersion = "unapproved-definition";
  const definitionResult = deriveMacroSpreadHistory(wrongDefinition);
  assert.equal(
    definitionResult.status === "blocked" && definitionResult.code,
    "DEFINITION_MISMATCH",
  );
});

test("spread history blocks different observation-date sets instead of joining or filling", () => {
  const input = spreadInput();
  input.right.observations = [
    observation("2026-08-31", "2.60"),
    observation("2026-09-02", "2.55"),
  ];
  const result = deriveMacroSpreadHistory(input);
  assert.equal(result.status === "blocked" && result.code, "DATE_MISMATCH");
});

test("spread history blocks missing and conflicting values instead of zero-filling", () => {
  const missing = spreadInput();
  missing.left.observations = [observation("2026-08-31", ""), observation("2026-09-01", "3.15")];
  const missingResult = deriveMacroSpreadHistory(missing);
  assert.equal(missingResult.status === "blocked" && missingResult.code, "DATA_MISSING");

  const conflict = spreadInput();
  conflict.left.observations = [
    observation("2026-08-31", "3.10"),
    observation("2026-08-31", "3.11"),
  ];
  const conflictResult = deriveMacroSpreadHistory(conflict);
  assert.equal(conflictResult.status === "blocked" && conflictResult.code, "DATA_CONFLICT");
});

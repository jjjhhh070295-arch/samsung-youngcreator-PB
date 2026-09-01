import assert from "node:assert/strict";
import test from "node:test";
import type { MacroTrendObservation } from "./historyTypes";
import {
  collectMacroTrendCalendarGaps,
  computeMacroTrendWindow,
  filterMacroTrendObservationsByRange,
  isMacroTrendRange,
  macroTrendCoverage,
  macroTrendDisplayMode,
} from "./historyRange";

function observation(observationDate: string): MacroTrendObservation {
  return {
    observationDate,
    observationDateRaw: observationDate,
    valueRaw: "1",
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

test("trend ranges are allowlisted and anchored to the latest observation date", () => {
  assert.equal(isMacroTrendRange("1D"), true);
  assert.equal(isMacroTrendRange("30Y"), true);
  assert.equal(isMacroTrendRange("ALL"), false);
  assert.deepEqual(computeMacroTrendWindow("1D", "2026-09-01"), {
    startDate: "2026-08-31",
    endDate: "2026-09-01",
  });
  assert.deepEqual(computeMacroTrendWindow("1W", "2026-09-01"), {
    startDate: "2026-08-25",
    endDate: "2026-09-01",
  });
  assert.deepEqual(computeMacroTrendWindow("1M", "2024-03-31"), {
    startDate: "2024-02-29",
    endDate: "2024-03-31",
  });
  assert.deepEqual(computeMacroTrendWindow("1Y", "2024-02-29"), {
    startDate: "2023-02-28",
    endDate: "2024-02-29",
  });
  const expectedLongRanges = {
    "3M": "2026-06-01",
    "6M": "2026-03-01",
    "3Y": "2023-09-01",
    "5Y": "2021-09-01",
    "10Y": "2016-09-01",
    "20Y": "2006-09-01",
  } as const;
  for (const [range, startDate] of Object.entries(expectedLongRanges)) {
    assert.equal(
      computeMacroTrendWindow(range as keyof typeof expectedLongRanges, "2026-09-01").startDate,
      startDate,
    );
  }
  assert.deepEqual(computeMacroTrendWindow("30Y", "2026-09-01"), {
    startDate: "1996-09-01",
    endDate: "2026-09-01",
  });
});

test("range filtering is inclusive and never invents an observation", () => {
  const source = [
    observation("2026-08-24"),
    observation("2026-08-25"),
    observation("2026-09-01"),
    observation("2026-09-02"),
  ];
  assert.deepEqual(
    filterMacroTrendObservationsByRange(source, "2026-08-25", "2026-09-01")
      .map(({ observationDate }) => observationDate),
    ["2026-08-25", "2026-09-01"],
  );
});

test("display mode follows the exact 1 / 2-7 / 8+ thresholds", () => {
  assert.equal(macroTrendDisplayMode(1), "latest");
  assert.equal(macroTrendDisplayMode(2), "table");
  assert.equal(macroTrendDisplayMode(7), "table");
  assert.equal(macroTrendDisplayMode(8), "line");
  assert.throws(() => macroTrendDisplayMode(0), RangeError);
});

test("coverage and calendar gaps retain the observed boundaries without claiming interpolation", () => {
  const daily = [
    observation("2026-08-28"),
    observation("2026-08-31"),
    observation("2026-09-01"),
  ];
  assert.deepEqual(macroTrendCoverage(daily), {
    startDate: "2026-08-28",
    endDate: "2026-09-01",
    calendarDaySpan: 4,
  });
  assert.deepEqual(collectMacroTrendCalendarGaps(daily, "D"), [{
    afterObservationDate: "2026-08-28",
    beforeObservationDate: "2026-08-31",
    calendarDaysBetween: 3,
  }]);

  const monthly = [observation("2026-01-01"), observation("2026-02-01"), observation("2026-04-01")];
  assert.deepEqual(collectMacroTrendCalendarGaps(monthly, "M"), [{
    afterObservationDate: "2026-02-01",
    beforeObservationDate: "2026-04-01",
    calendarDaysBetween: 59,
  }]);
});

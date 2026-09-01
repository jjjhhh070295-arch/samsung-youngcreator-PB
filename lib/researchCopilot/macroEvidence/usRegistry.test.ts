import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTreasuryFeedUrl,
  expectedOfficialUsObservationDate,
  getUsMacroDefinition,
  NY_FED_LATEST_RATES_URL,
  NY_FED_SERIES_IDS,
  TREASURY_FEED_TEMPLATE,
  TREASURY_SERIES_IDS,
  US_MACRO_ALLOWLIST,
  validateUsObservationFreshness,
} from "./usRegistry";

test("U.S. P0 registry contains only Treasury yields and NY Fed policy rates", () => {
  assert.deepEqual(Object.keys(US_MACRO_ALLOWLIST), [
    "ust-cmt-2y",
    "ust-cmt-5y",
    "ust-cmt-10y",
    "ust-cmt-30y",
    "nyfed-effr",
    "nyfed-target-lower",
    "nyfed-target-upper",
  ]);
  assert.deepEqual(TREASURY_SERIES_IDS, ["ust-cmt-2y", "ust-cmt-5y", "ust-cmt-10y", "ust-cmt-30y"]);
  assert.deepEqual(NY_FED_SERIES_IDS, ["nyfed-effr", "nyfed-target-lower", "nyfed-target-upper"]);
  assert.deepEqual(
    new Set(Object.values(US_MACRO_ALLOWLIST).map((definition) => definition.providerId)),
    new Set(["us-treasury", "ny-fed"]),
  );
  assert.doesNotMatch(JSON.stringify(US_MACRO_ALLOWLIST), /fred|cboe|ice/i);
});

test("official endpoints, units and internal-only rights are pinned", () => {
  assert.equal(
    buildTreasuryFeedUrl(2026),
    TREASURY_FEED_TEMPLATE.replace("{YEAR}", "2026"),
  );
  assert.equal(getUsMacroDefinition("nyfed-effr").dataUrlTemplate, NY_FED_LATEST_RATES_URL);
  for (const definition of Object.values(US_MACRO_ALLOWLIST)) {
    assert.equal(definition.frequency, "D");
    assert.equal(definition.unit, "Percent");
    assert.equal(definition.releaseDate, "source_not_provided");
    assert.equal(definition.vintageDate, "source_not_provided");
    assert.equal(definition.preliminaryFinal, "source_not_provided");
  }
  for (const seriesId of TREASURY_SERIES_IDS) {
    assert.equal(getUsMacroDefinition(seriesId).rightsStatus, "pb-internal-use-approved");
  }
  for (const seriesId of NY_FED_SERIES_IDS) {
    assert.equal(getUsMacroDefinition(seriesId).rightsStatus, "official-source-rights-review-required");
  }
  assert.equal(getUsMacroDefinition("ust-cmt-2y").revisionStatus, "source_not_provided");
  assert.equal(getUsMacroDefinition("nyfed-effr").revisionStatus, "provided_when_flagged");
});

test("provider publication cutoffs require the expected New York business-date observation", () => {
  assert.equal(expectedOfficialUsObservationDate("us-treasury", new Date("2026-08-31T16:00:00.000Z")), "2026-08-28");
  assert.equal(expectedOfficialUsObservationDate("us-treasury", new Date("2026-08-31T23:00:00.000Z")), "2026-08-31");
  assert.equal(expectedOfficialUsObservationDate("ny-fed", new Date("2026-08-31T12:00:00.000Z")), "2026-08-27");
  assert.equal(expectedOfficialUsObservationDate("ny-fed", new Date("2026-08-31T14:00:00.000Z")), "2026-08-28");
  assert.equal(expectedOfficialUsObservationDate("us-treasury", new Date("2026-09-06T12:00:00.000Z")), "2026-09-04");
});

test("invalid Treasury year and stale, future or invalid dates fail closed", () => {
  assert.throws(() => buildTreasuryFeedUrl(1989));
  assert.throws(() => buildTreasuryFeedUrl(2026.5));
  assert.equal(validateUsObservationFreshness("2026-08-28", new Date("2026-08-31T12:00:00.000Z"), 4), "ready");
  assert.equal(validateUsObservationFreshness("2026-08-28", new Date("2026-09-02T12:00:00.000Z"), 4), "stale");
  assert.equal(validateUsObservationFreshness("2026-09-01", new Date("2026-08-31T12:00:00.000Z"), 4), "future");
  assert.equal(validateUsObservationFreshness("2026-02-30", new Date("2026-08-31T12:00:00.000Z"), 4), "invalid");
});

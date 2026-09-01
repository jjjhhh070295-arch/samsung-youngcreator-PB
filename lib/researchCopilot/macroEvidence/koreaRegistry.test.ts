import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEcosRequestDescriptor,
  getKoreaMacroDefinition,
  KOREA_MACRO_ALLOWLIST,
} from "./koreaRegistry";

test("Korean P0 allowlist pins the official ECOS table and item codes", () => {
  assert.deepEqual(getKoreaMacroDefinition("bok-policy-rate").itemCodes, ["0101000"]);
  assert.equal(getKoreaMacroDefinition("bok-policy-rate").statCode, "722Y001");
  assert.equal(getKoreaMacroDefinition("ktb-3y").itemCodes[0], "010200000");
  assert.equal(getKoreaMacroDefinition("corp-aa-minus-3y").itemCodes[0], "010300000");
  assert.equal(getKoreaMacroDefinition("corp-bbb-minus-3y").itemCodes[0], "010320000");
  assert.equal(getKoreaMacroDefinition("real-gdp-sa").statCode, "200Y104");
  assert.equal(getKoreaMacroDefinition("cpi-headline").itemCodes[0], "0");
  assert.equal(getKoreaMacroDefinition("cpi-core-food-energy-excluded").itemCodes[0], "DB");
  assert.equal(getKoreaMacroDefinition("usd-krw-close-1530").itemCodes[0], "0000003");

  const curve = ["ktb-2y", "ktb-3y", "ktb-5y", "ktb-10y", "ktb-20y", "ktb-30y", "ktb-50y"] as const;
  assert.deepEqual(
    curve.map((id) => KOREA_MACRO_ALLOWLIST[id].itemCodes[0]),
    ["010195000", "010200000", "010200001", "010210000", "010220000", "010230000", "010240000"],
  );
  assert.deepEqual(curve.map((id) => KOREA_MACRO_ALLOWLIST[id].frequency), curve.map(() => "D"));
  assert.deepEqual(curve.map((id) => KOREA_MACRO_ALLOWLIST[id].unit), curve.map(() => "연%"));
});

test("metadata absent from ECOS responses stays explicit source_not_provided", () => {
  for (const series of Object.values(KOREA_MACRO_ALLOWLIST)) {
    assert.deepEqual(series.releaseDate, { value: null, status: "source_not_provided" });
    assert.deepEqual(series.vintageDate, { value: null, status: "source_not_provided" });
    assert.deepEqual(series.preliminaryFinal, { value: null, status: "source_not_provided" });
    assert.deepEqual(series.revisionStatus, { value: null, status: "source_not_provided" });
  }
});

test("request descriptor never contains a credential value", () => {
  const descriptor = buildEcosRequestDescriptor("cpi-headline", "202601", "202608");
  assert.match(descriptor.pathTemplate, /\{SERVER_CREDENTIAL\}/);
  assert.doesNotMatch(descriptor.pathTemplate, /ECOS_API_KEY/);
  assert.equal(descriptor.sourceUrl, "https://ecos.bok.or.kr/api/");
});

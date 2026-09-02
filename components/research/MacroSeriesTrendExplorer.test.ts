import test from "node:test";
import assert from "node:assert/strict";
import {
  findOnlyValidMacroTrendObservation,
  nextMacroTrendRangeIndex,
  parseMacroTrendValue,
  parseMacroWorkspaceIdentity,
} from "./MacroSeriesTrendExplorer";

test("PB·고객 identity를 분리하고 불완전한 문맥은 fail-closed 처리한다", () => {
  assert.deepEqual(parseMacroWorkspaceIdentity("pb-1:client-1"), { pbId: "pb-1", clientId: "client-1" });
  assert.deepEqual(parseMacroWorkspaceIdentity("pb-1:book"), { pbId: "pb-1", clientId: "book" });
  assert.equal(parseMacroWorkspaceIdentity("pb-only"), null);
  assert.equal(parseMacroWorkspaceIdentity(":client-1"), null);
  assert.equal(parseMacroWorkspaceIdentity("pb-1:"), null);
});

test("원문 숫자만 파싱하고 결측·임의 문구를 0으로 바꾸지 않는다", () => {
  assert.equal(parseMacroTrendValue("1,234.50"), 1234.5);
  assert.equal(parseMacroTrendValue("-0.25"), -0.25);
  assert.equal(parseMacroTrendValue("0"), 0);
  assert.equal(parseMacroTrendValue(""), null);
  assert.equal(parseMacroTrendValue("N/A"), null);
  assert.equal(parseMacroTrendValue("-"), null);
  assert.equal(parseMacroTrendValue("3.5%"), null);
});

test("유효값 1개 뒤 최신 결측 행이 있어도 빈 값을 최신값으로 오인하지 않는다", () => {
  const olderValid = { observationDate: "2026-08-01", valueRaw: "2.50" };
  const latestMissing = { observationDate: "2026-09-01", valueRaw: "" };
  assert.equal(findOnlyValidMacroTrendObservation([olderValid, latestMissing]), olderValid);
  assert.equal(findOnlyValidMacroTrendObservation([latestMissing]), null);
});

test("기간 radiogroup의 화살표·Home·End 이동은 순환하며 결정론적이다", () => {
  assert.equal(nextMacroTrendRangeIndex("ArrowRight", 10), 0);
  assert.equal(nextMacroTrendRangeIndex("ArrowDown", 2), 3);
  assert.equal(nextMacroTrendRangeIndex("ArrowLeft", 0), 10);
  assert.equal(nextMacroTrendRangeIndex("ArrowUp", 3), 2);
  assert.equal(nextMacroTrendRangeIndex("Home", 7), 0);
  assert.equal(nextMacroTrendRangeIndex("End", 1), 10);
  assert.equal(nextMacroTrendRangeIndex("Enter", 4), 4);
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { comparePriorityRows } from "./BookDashboard";
import type { ClientBookRow } from "../../lib/advisory/types";

function row(overrides: Partial<ClientBookRow>): ClientBookRow {
  return {
    clientId: "id",
    code: "C-1",
    name: "이름",
    clientType: "individual",
    birthDate: "",
    totalAssets: 0,
    investedAmount: 0,
    totalReturnPct: null,
    riskGrade: "위험중립",
    riskScore: null,
    holdings: [],
    lastConsultation: null,
    flags: [{ kind: "heritage", reason: "테스트" }],
    cashNeed12m: 0,
    ...overrides,
  };
}

describe("comparePriorityRows — BookDashboard 우선 확인 고객 정렬 시뮬레이션", () => {
  it("78세(즉시, score낮음)가 45세(1년 내, score높음)보다 위로 온다", () => {
    const old78 = row({ clientId: "old78", heritagePriority: { urgencyLevel: "즉시", score: 44 } });
    const young45 = row({ clientId: "young45", heritagePriority: { urgencyLevel: "1년 내", score: 90 } });
    const sorted = [young45, old78].sort(comparePriorityRows);
    assert.deepEqual(sorted.map((r) => r.clientId), ["old78", "young45"]);
  });

  it("긴급도가 같으면 score로 2차 정렬한다", () => {
    const a = row({ clientId: "a", heritagePriority: { urgencyLevel: "즉시", score: 90 } });
    const b = row({ clientId: "b", heritagePriority: { urgencyLevel: "즉시", score: 60 } });
    const sorted = [b, a].sort(comparePriorityRows);
    assert.deepEqual(sorted.map((r) => r.clientId), ["a", "b"]);
  });

  it("heritagePriority가 없는 고객(다른 사유로 플래그된 고객)은 있는 고객보다 항상 아래로 밀린다", () => {
    const heritageClient = row({ clientId: "h", heritagePriority: { urgencyLevel: "1년 내", score: 10 } });
    const otherFlagged = row({
      clientId: "o",
      flags: [
        { kind: "high_risk", reason: "x" },
        { kind: "low_return", reason: "y" },
        { kind: "low_liquidity", reason: "z" },
      ],
    });
    const sorted = [otherFlagged, heritageClient].sort(comparePriorityRows);
    assert.deepEqual(sorted.map((r) => r.clientId), ["h", "o"]);
  });

  it("heritagePriority가 둘 다 없으면 기존처럼 flags 개수로 비교한다", () => {
    const many = row({ clientId: "many", flags: [{ kind: "high_risk", reason: "a" }, { kind: "low_return", reason: "b" }] });
    const few = row({ clientId: "few", flags: [{ kind: "low_liquidity", reason: "c" }] });
    const sorted = [few, many].sort(comparePriorityRows);
    assert.deepEqual(sorted.map((r) => r.clientId), ["many", "few"]);
  });
});

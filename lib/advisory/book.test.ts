import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildClientBookRow, analyzeBook } from "./book";
import { emptyIPS } from "../types";
import type { Client } from "../types";
import type { HeritageAssessmentInput } from "../heritage";

const ASOF = "2026-08-24T00:00:00.000Z";

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: "client-1",
    code: "C-2026-0001",
    clientType: "individual",
    name: "홍길동",
    birthDate: "1956-01-01",
    assignedPbId: "pb-1",
    assetSize: 3_200_000_000,
    consultationNotes: "",
    ips: emptyIPS(),
    cashFlows: [],
    portfolios: [],
    stages: {},
    createdAt: ASOF,
    ...overrides,
  };
}

function heritageInput(overrides: Partial<HeritageAssessmentInput> = {}): HeritageAssessmentInput {
  return {
    asOf: new Date(ASOF),
    clientType: "individual",
    birthDate: "1956-01-01", // 70세 근처
    assetSizeWon: 3_200_000_000,
    realEstateWeightPct: 30,
    hasSpouse: true,
    childrenCount: 2,
    givenGiftEvents: [],
    taxTagIds: [],
    ...overrides,
  };
}

describe("buildClientBookRow — heritage 플래그 통합", () => {
  it("heritageInput을 넘기지 않으면 heritage 플래그도, heritagePriority도 생기지 않는다", () => {
    const row = buildClientBookRow(makeClient(), [], [], ASOF);
    assert.equal(row.flags.some((f) => f.kind === "heritage"), false);
    assert.equal(row.heritagePriority, undefined);
  });

  it("heritageInput의 수요가 있으면(hasNeed) heritage 플래그와 heritagePriority가 생긴다", () => {
    const row = buildClientBookRow(makeClient(), [], [], ASOF, heritageInput());
    const flag = row.flags.find((f) => f.kind === "heritage");
    assert.ok(flag, "heritage flag should exist");
    assert.ok(row.heritagePriority);
    assert.ok(row.heritagePriority!.urgencyLevel !== "해당없음");
    // 권고 문장("따라서 ... 권합니다")이 flag reason으로 쓰인다 — 시스템 내부 표현이 아닌
    // PB가 그대로 읽을 수 있는 문장이어야 한다(기존 heritage 모듈 규칙과 동일).
    assert.match(flag!.reason, /^따라서/);
  });

  it("heritageInput이 있어도 수요가 없으면(저자산 등) heritage 플래그가 생기지 않는다", () => {
    const row = buildClientBookRow(
      makeClient({ assetSize: 300_000_000 }),
      [],
      [],
      ASOF,
      heritageInput({ assetSizeWon: 300_000_000, hasSpouse: false, childrenCount: 0 }),
    );
    assert.equal(row.flags.some((f) => f.kind === "heritage"), false);
    assert.equal(row.heritagePriority, undefined);
  });
});

describe("analyzeBook — flagged.heritage 집계", () => {
  it("heritage 플래그가 있는 행만 flagged.heritage에 들어간다", () => {
    const withNeed = buildClientBookRow(makeClient({ id: "c1" }), [], [], ASOF, heritageInput());
    const withoutNeed = buildClientBookRow(makeClient({ id: "c2" }), [], [], ASOF);
    const analysis = analyzeBook([withNeed, withoutNeed], [], ASOF, "test");
    assert.equal(analysis.flagged.heritage.length, 1);
    assert.equal(analysis.flagged.heritage[0].clientId, "c1");
  });
});

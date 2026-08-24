import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveHeritageInputsBulk } from "./resolveBulk";
import { buildMajorityShareholderMap } from "./succession";
import { assessHeritage } from "./index";
import { emptyIPS } from "../types";
import type { Client, PartyRelationship, TransferEvent } from "../types";
import type { RealEstateWithDebtBulkResult } from "../store";

const ASOF = new Date("2026-08-24T00:00:00.000Z");

function makeClient(overrides: Partial<Client>): Client {
  return {
    id: "id",
    code: "C-2026-0001",
    clientType: "individual",
    name: "이름",
    birthDate: "1956-01-01",
    assignedPbId: "pb-1",
    assetSize: 0,
    consultationNotes: "",
    ips: emptyIPS(),
    cashFlows: [],
    portfolios: [],
    stages: {},
    createdAt: ASOF.toISOString(),
    ...overrides,
  };
}

function rel(fromPartyId: string, toPartyId: string, relationType: PartyRelationship["relationType"], ownershipPct: number | null = null): PartyRelationship {
  return {
    id: `${fromPartyId}-${toPartyId}-${relationType}`,
    fromPartyId,
    toPartyId,
    relationType,
    ownershipPct,
    validFrom: "2020-01-01",
    validTo: null,
    createdAt: "2020-01-01T00:00:00.000Z",
  };
}

function gift(fromPartyId: string, amount: number, yearsAgo: number): TransferEvent {
  const d = new Date(ASOF);
  d.setFullYear(d.getFullYear() - yearsAgo);
  return {
    id: `gift-${fromPartyId}-${amount}`,
    eventType: "gift",
    fromPartyId,
    toPartyId: "child-x",
    assetKind: "cash",
    assetRef: null,
    amount,
    eventDate: d.toISOString().slice(0, 10),
    note: null,
    createdAt: d.toISOString(),
  };
}

describe("buildMajorityShareholderMap — 법인 역스캔 (신호 A)", () => {
  it("법인 레코드의 linkedClientId+isMajorityShareholder를 개인 id 기준으로 뒤집는다", () => {
    const individual = makeClient({ id: "ind-1", clientType: "individual" });
    const corp1 = makeClient({ id: "corp-1", clientType: "corporate", name: "회사A", linkedClientId: "ind-1", isMajorityShareholder: true });
    const corp2 = makeClient({ id: "corp-2", clientType: "corporate", name: "회사B", linkedClientId: "ind-1", isMajorityShareholder: false });
    const map = buildMajorityShareholderMap([individual, corp1, corp2]);
    const links = map.get("ind-1") ?? [];
    assert.equal(links.length, 1, "최대주주 아닌 회사B는 포함되지 않아야 한다");
    assert.equal(links[0].corporatePartyId, "corp-1");
  });

  it("이 함수는 순수 in-memory 연산 — Supabase 쿼리를 새로 만들지 않는다(listClients() 결과만 재사용)", () => {
    const map = buildMajorityShareholderMap([]);
    assert.equal(map.size, 0);
  });
});

describe("resolveHeritageInputsBulk — 벌크 조회 결과를 clientId별 Map으로 조립", () => {
  const clientA = makeClient({ id: "A", assetSize: 2_000_000_000 }); // 등록 총자산 20억(부동산 시가로 보정될 것)
  const clientB = makeClient({ id: "B", assetSize: 500_000_000 });
  const corp = makeClient({ id: "corp-1", clientType: "corporate", name: "A대표법인", linkedClientId: "A", isMajorityShareholder: true });

  const realEstate: RealEstateWithDebtBulkResult = {
    properties: [
      { id: "prop-1", ownerPartyId: "A", marketValue: 3_200_000_000, ownershipShare: 1 },
    ],
    debtByPropertyId: new Map([["prop-1", 500_000_000]]),
  };

  const result = resolveHeritageInputsBulk({
    allClients: [clientA, clientB, corp],
    targetClientIds: ["A", "B"],
    ownershipRelationships: [rel("B", "corp-9", "owns", 60)],
    familyRelationships: [rel("A", "spouse-a", "spouse"), rel("A", "child-a1", "child"), rel("A", "child-a2", "child")],
    realEstate,
    giftEvents: [gift("A", 300_000_000, 3), gift("B", 100_000_000, 20)], // B의 증여는 20년 전 — 세액 계산에서 걸러져야 함
    asOf: ASOF,
  });

  it("A: 부동산 시가(32억)가 등록 자산(20억)보다 크면 그쪽을 쓴다, 채무는 별도로 남긴다", () => {
    const input = result.heritageInputs.get("A");
    assert.ok(input);
    assert.equal(input!.assetSizeWon, 3_200_000_000);
    assert.equal(input!.debtWon, 500_000_000);
    assert.equal(input!.realEstateWeightPct, 100);
  });

  it("A: 가족관계에서 배우자 있음 + 자녀 2명이 반영된다", () => {
    const input = result.heritageInputs.get("A");
    assert.equal(input!.hasSpouse, true);
    assert.equal(input!.childrenCount, 2);
  });

  it("A: 증여이력이 fromPartyId 기준으로만 들어간다(B의 증여가 섞이지 않는다)", () => {
    const input = result.heritageInputs.get("A");
    assert.equal(input!.givenGiftEvents.length, 1);
    assert.equal(input!.givenGiftEvents[0].amount, 300_000_000);
  });

  it("A: 최대주주 신호(A)가 succession 신호에 반영된다", () => {
    const signal = result.successionSignals.get("A");
    assert.equal(signal!.isMajorityShareholderViaCorporateLink, true);
  });

  it("B: 부동산이 없으면 등록 자산(5억)을 그대로 쓰고 부동산 비중은 0%다", () => {
    const input = result.heritageInputs.get("B");
    assert.equal(input!.assetSizeWon, 500_000_000);
    assert.equal(input!.realEstateWeightPct, 0);
  });

  it("B: 가족관계 행이 하나도 없으면 hasSpouse/childrenCount가 false/0이 아니라 null(미상)이다", () => {
    const input = result.heritageInputs.get("B");
    assert.equal(input!.hasSpouse, null);
    assert.equal(input!.childrenCount, null);
  });

  it("B: 지분율 신호(B)가 succession 신호에 반영된다(owns 60%)", () => {
    const signal = result.successionSignals.get("B");
    assert.equal(signal!.maxOwnershipPct, 60);
    assert.equal(signal!.isMajorityShareholderViaCorporateLink, false);
  });

  it("법인 클라이언트 자신은 targetClientIds에 있어도 결과에서 제외된다", () => {
    const result2 = resolveHeritageInputsBulk({
      allClients: [clientA, corp],
      targetClientIds: ["A", "corp-1"],
      ownershipRelationships: [],
      familyRelationships: [],
      realEstate: { properties: [], debtByPropertyId: new Map() },
      giftEvents: [],
      asOf: ASOF,
    });
    assert.equal(result2.heritageInputs.has("corp-1"), false);
  });

  it("조립된 입력을 assessHeritage에 그대로 넣으면 채무 차감이 반영된 세액 구간이 나온다", () => {
    const input = result.heritageInputs.get("A")!;
    const assessment = assessHeritage(input);
    assert.ok(assessment.taxRange);
    assert.equal(assessment.taxRange!.breakdown.debtWon, 500_000_000);
    assert.equal(assessment.taxRange!.breakdown.netAssetWon, 2_700_000_000);
    assert.equal(assessment.dataAssumptionsUsed, false, "A는 가족관계가 모두 확인됐으므로 가정 배지가 뜨면 안 된다");
  });

  it("B(가족관계 미상)를 assessHeritage에 넣으면 가정이 쓰였다는 배지가 뜬다", () => {
    const input = result.heritageInputs.get("B")!;
    const assessment = assessHeritage(input);
    assert.equal(assessment.demand.hasSpouseAssumed, true);
    assert.equal(assessment.demand.childrenCountAssumed, true);
    assert.equal(assessment.dataAssumptionsUsed, true);
    assert.ok(assessment.demand.reasons.some((r) => r.code === "has_spouse_assumed"));
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyIPS } from "../types";
import type { Client } from "../types";
import { extractIpsFromClientProfile, ipsExtractionMissingReasons } from "./ipsExtraction";

function sampleClient(): Client {
  const client: Client = {
    id: "c1",
    code: "C-1",
    clientType: "individual",
    name: "테스트",
    birthDate: "1980-01-01",
    assignedPbId: "PB-001",
    assetSize: 1_000_000_000,
    consultationNotes: "",
    ips: emptyIPS(),
    cashFlows: [],
    portfolios: [],
    stages: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    financialIncomeComprehensiveTax: true,
  };
  client.ips.return = { ...client.ips.return, value: "8%", status: "explicit" };
  client.ips.risk = { ...client.ips.risk, value: "중위험", status: "explicit" };
  return client;
}

describe("ipsExtraction", () => {
  it("기본정보·세금 플래그로 IPS 요인을 확정한다", () => {
    const ips = extractIpsFromClientProfile(sampleClient());
    assert.equal(ips.return.reviewed, true);
    assert.match(ips.tax.value, /종합과세/);
    assert.equal(ipsExtractionMissingReasons(sampleClient()).length, 0);
  });

  it("이름·코드·요인이 없으면 한국어 사유를 반환한다", () => {
    const empty = sampleClient();
    empty.name = "";
    empty.code = "";
    empty.ips = emptyIPS();
    const reasons = ipsExtractionMissingReasons(empty);
    assert.ok(reasons.some((r) => r.includes("이름")));
    assert.ok(reasons.some((r) => r.includes("식별코드")));
    assert.ok(reasons.some((r) => r.includes("7요인")));
  });
});

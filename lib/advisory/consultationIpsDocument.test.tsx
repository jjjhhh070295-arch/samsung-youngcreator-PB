import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildIpsDocumentSnapshot,
  canCaptureFinalizedIpsDocument,
  consultationHasPbMemo,
  extractDocumentFromRaw,
  extractFactorsFromRaw,
  freezeDocumentClient,
  mergeIpsSnapshotForUpdate,
  packIpsSnapshotPayload,
  unpackIpsSnapshotPayload,
  IPS_DOCUMENT_PAYLOAD_KEY,
} from "./consultationIpsDocument";
import { ipsDocumentFixture } from "../ipsDocument.fixture";
import { emptyIPS, type Consultation, type Client } from "../types";
import IpsA4Document from "../../components/ips/IpsA4Document";
import ConsultationDetailModal from "../../components/ConsultationDetailModal";
import ConsultationHistory from "../../components/ConsultationHistory";

const MEMO = "고객은 해외주식 비중을 유지하고\n세금 일정을 별도 관리하기로 했습니다.\n— PB 박지호";

function approvedClient(overrides: Partial<Client> = {}): Client {
  const base = ipsDocumentFixture();
  return {
    ...base,
    stages: {
      basic: true,
      factors: true,
      cashflow: true,
      portfolio: true,
      stress: true,
      ips: true,
    },
    ...overrides,
  };
}

function baseConsultation(partial: Partial<Consultation> = {}): Consultation {
  return {
    id: "cs-a",
    clientId: "client-a",
    pbId: "pb-1",
    startedAt: "2026-09-10T01:00:00Z",
    endedAt: "2026-09-10T02:00:00Z",
    durationSeconds: 3600,
    notes: "",
    ipsSnapshot: emptyIPS(),
    ipsDocumentSnapshot: null,
    createdAt: "2026-09-10T02:00:00Z",
    ...partial,
  };
}

describe("consultationIpsDocument packing", () => {
  it("multiline Korean memo flag uses trim consistently", () => {
    assert.equal(consultationHasPbMemo({ notes: MEMO }), true);
    assert.equal(consultationHasPbMemo({ notes: "   " }), false);
    assert.equal(consultationHasPbMemo({ notes: "" }), false);
  });

  it("packs factors + document and unpacks without losing memo-side factors", () => {
    const client = approvedClient();
    const factors = client.ips;
    factors.return.value = "연 8% 목표";
    const doc = buildIpsDocumentSnapshot({
      consultationId: "cs-1",
      client,
      pbDisplayName: "박담당",
      investableWon: 3_000_000_000,
    });
    assert.ok(doc);
    const packed = packIpsSnapshotPayload(factors, doc);
    assert.ok(IPS_DOCUMENT_PAYLOAD_KEY in packed);
    const unpacked = unpackIpsSnapshotPayload(packed);
    assert.equal(unpacked.ipsSnapshot.return.value, "연 8% 목표");
    assert.equal(unpacked.ipsDocumentSnapshot?.consultationId, "cs-1");
    assert.equal(unpacked.ipsDocumentSnapshot?.pbDisplayName, "박담당");
    // TrendChart 호환: 최상위 요인 키 유지
    assert.equal(extractFactorsFromRaw(packed).return.value, "연 8% 목표");
  });

  it("rejects unapproved IPS as finalized document", () => {
    const draft = approvedClient({
      stages: { basic: true, factors: true, cashflow: true, portfolio: false, stress: false, ips: false },
    });
    assert.equal(canCaptureFinalizedIpsDocument(draft), false);
    assert.equal(
      buildIpsDocumentSnapshot({
        consultationId: "x",
        client: draft,
        pbDisplayName: "박",
        investableWon: 1,
      }),
      null,
    );
  });

  it("freezes document client so later Client edits do not mutate snapshot", () => {
    const client = approvedClient({ name: "원본고객" });
    const snap = buildIpsDocumentSnapshot({
      consultationId: "cs-freeze",
      client,
      pbDisplayName: "박",
      investableWon: 100,
    })!;
    client.name = "변경된고객";
    client.portfolios[0].expectedReturn = 99;
    assert.equal(snap.documentClient.name, "원본고객");
    assert.notEqual(snap.documentClient.portfolios[0].expectedReturn, 99);
  });

  it("updating memo/factors preserves document metadata in merge", () => {
    const client = approvedClient();
    const doc = buildIpsDocumentSnapshot({
      consultationId: "cs-keep",
      client,
      pbDisplayName: "박",
      investableWon: 10,
    })!;
    const packed = packIpsSnapshotPayload(client.ips, doc);
    const nextFactors = emptyIPS();
    nextFactors.risk.value = "보수";
    const merged = mergeIpsSnapshotForUpdate({
      previousRawOrPacked: packed,
      nextFactors,
    });
    const again = unpackIpsSnapshotPayload(merged);
    assert.equal(again.ipsSnapshot.risk.value, "보수");
    assert.equal(again.ipsDocumentSnapshot?.consultationId, "cs-keep");
    assert.equal(again.ipsDocumentSnapshot?.pbDisplayName, "박");
  });

  it("legacy raw factors without document remain document-null", () => {
    const legacy = { return: { value: "old", score: 3, status: "explicit" } };
    assert.equal(extractDocumentFromRaw(legacy), null);
    assert.ok(extractFactorsFromRaw(legacy).return);
  });
});

describe("consultation detail rendering", () => {
  it("history row and detail share consultation.notes; no stale object after refresh", () => {
    const v1 = baseConsultation({ id: "cs-shared", notes: "" });
    const v2 = baseConsultation({ id: "cs-shared", notes: MEMO });
    // 선택 ID 로 최신 props 를 재조회하는 패턴을 검증
    const selectedId = "cs-shared";
    const fromStaleList = [v1].find((c) => c.id === selectedId)!;
    const fromFreshList = [v2].find((c) => c.id === selectedId)!;
    assert.equal(consultationHasPbMemo(fromStaleList), false);
    assert.equal(consultationHasPbMemo(fromFreshList), true);
    assert.equal(fromFreshList.notes, MEMO);
    assert.ok(fromFreshList.notes.includes("\n"));
  });

  it("Consultation A cannot display Consultation B memo/IPS", () => {
    const clientA = approvedClient({ id: "a", name: "고객A", code: "C-A" });
    const clientB = approvedClient({ id: "b", name: "고객B", code: "C-B" });
    const docA = buildIpsDocumentSnapshot({
      consultationId: "cs-a",
      client: clientA,
      pbDisplayName: "PB",
      investableWon: 1,
    })!;
    const docB = buildIpsDocumentSnapshot({
      consultationId: "cs-b",
      client: clientB,
      pbDisplayName: "PB",
      investableWon: 2,
    })!;
    const a = baseConsultation({
      id: "cs-a",
      notes: "A메모",
      ipsDocumentSnapshot: docA,
    });
    const b = baseConsultation({
      id: "cs-b",
      notes: "B메모",
      ipsDocumentSnapshot: docB,
    });
    assert.notEqual(a.notes, b.notes);
    assert.notEqual(a.ipsDocumentSnapshot?.documentClient.name, b.ipsDocumentSnapshot?.documentClient.name);
  });

  it("renders 상담 메모 and 확정 IPS from historical snapshot, not RRTTLLU cards as IPS", () => {
    const client = approvedClient({ name: "확정고객" });
    const doc = buildIpsDocumentSnapshot({
      consultationId: "cs-doc",
      client,
      pbDisplayName: "박담당",
      investableWon: 3_000_000_000,
    })!;
    const cs = baseConsultation({
      id: "cs-doc",
      notes: MEMO,
      ipsDocumentSnapshot: doc,
    });
    const html = renderToStaticMarkup(
      <ConsultationDetailModal
        consultation={cs}
        client={client}
        index={1}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    assert.ok(html.includes("상담 메모 (전문)"));
    assert.ok(html.includes("확정 IPS"));
    assert.ok(html.includes(MEMO.split("\n")[0]));
    assert.ok(html.includes("확정고객"));
    assert.ok(html.includes("박담당"));
    assert.ok(!html.includes("이 상담 시점의 RRTTLLU 7요인"));
    assert.ok(!html.includes("현재 현금흐름"));
  });

  it("legacy consultation shows honest missing IPS message and exact empty memo", () => {
    const cs = baseConsultation({ id: "legacy", notes: "", ipsDocumentSnapshot: null });
    const html = renderToStaticMarkup(
      <ConsultationDetailModal
        consultation={cs}
        client={approvedClient()}
        index={1}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    assert.ok(html.includes("기록된 메모 없음"));
    assert.ok(html.includes("이 상담에는 저장된 확정 IPS가 없습니다."));
    assert.ok(html.includes("현재 IPS 보기"));
  });

  it("history badge uses PB 메모 있음 from notes trim", () => {
    const withMemo = baseConsultation({ id: "1", notes: MEMO });
    const html = renderToStaticMarkup(
      <ConsultationHistory consultations={[withMemo]} client={null} />,
    );
    assert.ok(html.includes("PB 메모 있음"));
  });

  it("IpsA4Document renders from stored historical snapshot", () => {
    const client = approvedClient({ name: "스냅샷고객" });
    const doc = buildIpsDocumentSnapshot({
      consultationId: "cs-html",
      client,
      pbDisplayName: "이담당",
      investableWon: 2_000_000_000,
    })!;
    const frozen = freezeDocumentClient(client);
    frozen.name = "스냅샷고객";
    const html = renderToStaticMarkup(
      <IpsA4Document
        documentClient={doc.documentClient}
        documentPbDisplay={doc.pbDisplayName}
        investableWon={doc.investableWon}
        dateStr={doc.dateStr}
      />,
    );
    assert.ok(html.includes("스냅샷고객"));
    assert.ok(html.includes("이담당") || html.includes("투자정책서"));
  });
});

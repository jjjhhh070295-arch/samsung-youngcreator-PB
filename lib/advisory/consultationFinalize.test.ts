/**
 * finalizeConsultationRecord / updateConsultation 로컬 폴백 경로.
 * Supabase 없이 메모·문서 스냅샷 일관성을 검증한다.
 */
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { ipsDocumentFixture } from "../ipsDocument.fixture";
import {
  buildIpsDocumentSnapshot,
  packIpsSnapshotPayload,
  unpackIpsSnapshotPayload,
} from "./consultationIpsDocument";
import { emptyIPS } from "../types";

// store 는 window/localStorage 에 의존 — 테스트에서 최소 스텁
const g = globalThis as any;
if (!g.window) {
  const store = new Map<string, string>();
  g.window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  g.localStorage = g.window.localStorage;
}

describe("consultation finalize local store", () => {
  let createConsultation: typeof import("../store").createConsultation;
  let updateConsultation: typeof import("../store").updateConsultation;
  let finalizeConsultationRecord: typeof import("../store").finalizeConsultationRecord;
  let listConsultations: typeof import("../store").listConsultations;

  before(async () => {
    // 로컬 폴백 강제 — 환경에 supabase 가 있어도 테스트는 in-memory 경로를 탄다
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
    const store = await import("../store");
    createConsultation = store.createConsultation;
    updateConsultation = store.updateConsultation;
    finalizeConsultationRecord = store.finalizeConsultationRecord;
    listConsultations = store.listConsultations;
  });

  it("multiline memo survives create → map → update without truncation", async () => {
    const memo =
      "첫 줄 한글 메모입니다.\n둘째 줄 — 긴 내용 ".repeat(20) + "끝.";
    const client = ipsDocumentFixture();
    client.stages = {
      basic: true,
      factors: true,
      cashflow: true,
      portfolio: true,
      stress: true,
      ips: true,
    };
    const created = await createConsultation({
      clientId: client.id,
      pbId: "demo-pb",
      startedAt: "2026-09-10T01:00:00Z",
      endedAt: "2026-09-10T02:00:00Z",
      durationSeconds: 3600,
      notes: memo,
      ipsSnapshot: client.ips,
    });
    assert.equal(created.notes, memo);
    assert.ok(created.notes.includes("\n"));
    assert.ok(created.notes.length > 200);

    await updateConsultation(created.id, { notes: memo + "\n추가" });
    const listed = await listConsultations(client.id);
    const again = listed.find((c) => c.id === created.id);
    assert.ok(again);
    assert.equal(again!.notes, memo + "\n추가");
  });

  it("finalize saves memo + document to same id; repeat does not duplicate", async () => {
    const client = ipsDocumentFixture();
    client.id = `finalize-${Date.now()}`;
    client.stages = {
      basic: true,
      factors: true,
      cashflow: true,
      portfolio: true,
      stress: true,
      ips: true,
    };
    const memo = "완료 메모\n두 줄";
    const first = await finalizeConsultationRecord({
      clientId: client.id,
      pbId: "demo-pb",
      notes: memo,
      ipsSnapshot: client.ips,
      buildDocument: (id) =>
        buildIpsDocumentSnapshot({
          consultationId: id,
          client,
          pbDisplayName: "박담당",
          investableWon: 3_000_000_000,
        }),
    });
    assert.equal(first.notes, memo);
    assert.ok(first.ipsDocumentSnapshot);
    assert.equal(first.ipsDocumentSnapshot!.documentClient.name, client.name);

    const second = await finalizeConsultationRecord({
      consultationId: first.id,
      clientId: client.id,
      pbId: "demo-pb",
      notes: memo + " 수정",
      ipsSnapshot: client.ips,
      buildDocument: (id) =>
        buildIpsDocumentSnapshot({
          consultationId: id,
          client: { ...client, name: "바뀐이름" },
          pbDisplayName: "박담당",
          investableWon: 1,
        }),
    });
    assert.equal(second.id, first.id);
    assert.equal(second.notes, memo + " 수정");
    // 문서는 불변 — 첫 스냅샷 유지
    assert.equal(second.ipsDocumentSnapshot!.documentClient.name, client.name);

    const all = await listConsultations(client.id);
    assert.equal(all.filter((c) => c.id === first.id).length, 1);
  });

  it("updateConsultation notes-only preserves packed document", async () => {
    const client = ipsDocumentFixture();
    client.id = `preserve-${Date.now()}`;
    client.stages = {
      basic: true,
      factors: true,
      cashflow: true,
      portfolio: true,
      stress: true,
      ips: true,
    };
    const doc = buildIpsDocumentSnapshot({
      consultationId: "tmp",
      client,
      pbDisplayName: "이담당",
      investableWon: 9,
    })!;
    const created = await createConsultation({
      clientId: client.id,
      pbId: "demo-pb",
      startedAt: "2026-09-10T01:00:00Z",
      endedAt: "2026-09-10T02:00:00Z",
      durationSeconds: 10,
      notes: "원본",
      ipsSnapshot: client.ips,
      ipsDocumentSnapshot: doc,
    });
    await updateConsultation(created.id, {
      notes: "수정만",
      ipsSnapshot: emptyIPS(),
    });
    const listed = await listConsultations(client.id);
    const row = listed.find((c) => c.id === created.id)!;
    assert.equal(row.notes, "수정만");
    assert.ok(row.ipsDocumentSnapshot);
    assert.equal(row.ipsDocumentSnapshot!.pbDisplayName, "이담당");
    // 직렬화 round-trip
    const packed = packIpsSnapshotPayload(row.ipsSnapshot, row.ipsDocumentSnapshot);
    const unpacked = unpackIpsSnapshotPayload(packed);
    assert.equal(unpacked.ipsDocumentSnapshot!.pbDisplayName, "이담당");
  });
});

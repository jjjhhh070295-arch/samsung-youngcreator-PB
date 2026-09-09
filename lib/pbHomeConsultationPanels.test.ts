import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyIPS } from "./types";
import type { Client, Consultation } from "./types";
import {
  buildClientListRows,
  canViewFinalIps,
  compositionCounts,
  consultationsForClient,
  filterAssignedClients,
  memoPreview,
  patchConsultationNotesOnly,
  sanitizeSelectedClientId,
  sortClientsForPbHome,
} from "./pbHomeConsultationPanels";

function client(partial: Partial<Client> & Pick<Client, "id" | "name" | "code" | "assignedPbId">): Client {
  return {
    clientType: "individual",
    assetSize: 0,
    riskTolerance: "moderate",
    investmentGoal: "",
    stages: {
      basic: false,
      cashflow: false,
      portfolio: false,
      factors: false,
      stress: false,
      ips: false,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as Client;
}

function consultation(
  partial: Partial<Consultation> & Pick<Consultation, "id" | "clientId" | "pbId" | "createdAt">,
): Consultation {
  return {
    startedAt: partial.createdAt,
    endedAt: partial.createdAt,
    durationSeconds: 600,
    notes: "",
    ipsSnapshot: emptyIPS(),
    ...partial,
  };
}

describe("pbHomeConsultationPanels selectors", () => {
  const pbA = "PB-001";
  const pbB = "PB-002";
  const clients = [
    client({ id: "c2", name: "가나다", code: "C-2", assignedPbId: pbA }),
    client({ id: "c1", name: "가나다", code: "C-1", assignedPbId: pbA }),
    client({ id: "c3", name: "다른PB", code: "C-3", assignedPbId: pbB, clientType: "corporate" }),
  ];

  it("only lists customers assigned to the active PB", () => {
    const mine = filterAssignedClients(clients, pbA);
    assert.equal(mine.length, 2);
    assert.equal(mine.every((c) => c.assignedPbId === pbA), true);
  });

  it("sorts by Korean name then code", () => {
    const sorted = sortClientsForPbHome(filterAssignedClients(clients, pbA));
    assert.deepEqual(sorted.map((c) => c.code), ["C-1", "C-2"]);
  });

  it("filters logs by pbId + clientId + assigned set; newest first", () => {
    const logs = [
      consultation({ id: "x1", clientId: "c1", pbId: pbA, createdAt: "2026-01-01T10:00:00.000Z", notes: "old" }),
      consultation({ id: "x2", clientId: "c1", pbId: pbA, createdAt: "2026-02-01T10:00:00.000Z", notes: "new" }),
      consultation({ id: "x3", clientId: "c2", pbId: pbA, createdAt: "2026-03-01T10:00:00.000Z" }),
      consultation({ id: "x4", clientId: "c1", pbId: pbB, createdAt: "2026-04-01T10:00:00.000Z" }),
      consultation({ id: "x5", clientId: "c3", pbId: pbA, createdAt: "2026-05-01T10:00:00.000Z" }),
    ];
    const assigned = new Set(["c1", "c2"]);
    const forC1 = consultationsForClient({
      consultations: logs,
      pbId: pbA,
      clientId: "c1",
      assignedClientIds: assigned,
    });
    assert.deepEqual(forC1.map((c) => c.id), ["x2", "x1"]);
    assert.equal(forC1.some((c) => c.pbId === pbB), false);
    assert.equal(forC1.some((c) => c.clientId === "c2"), false);
  });

  it("builds counts and latest consultation dates", () => {
    const mine = filterAssignedClients(clients, pbA);
    const counts = compositionCounts([
      ...mine,
      client({ id: "corp", name: "법인", code: "C-9", assignedPbId: pbA, clientType: "corporate" }),
    ]);
    assert.equal(counts.individual, 2);
    assert.equal(counts.corporate, 1);
    assert.equal(counts.total, 3);

    const rows = buildClientListRows(
      clients,
      [
        consultation({ id: "a", clientId: "c1", pbId: pbA, createdAt: "2026-01-10T00:00:00.000Z" }),
        consultation({ id: "b", clientId: "c1", pbId: pbA, createdAt: "2026-02-10T00:00:00.000Z" }),
      ],
      pbA,
    );
    const c1 = rows.find((r) => r.id === "c1");
    assert.equal(c1?.consultationCount, 2);
    assert.equal(c1?.latestConsultationAt, "2026-02-10T00:00:00.000Z");
  });

  it("patchConsultationNotesOnly updates notes without touching ipsSnapshot", () => {
    const snap = emptyIPS();
    snap.return.score = 7;
    const existing = consultation({
      id: "n1",
      clientId: "c1",
      pbId: pbA,
      createdAt: "2026-01-01T00:00:00.000Z",
      notes: "before",
      ipsSnapshot: snap,
    });
    const next = patchConsultationNotesOnly(existing, {
      pbId: pbA,
      clientId: "c1",
      notes: "  after\nline  ",
    });
    assert.equal(next.notes, "after\nline");
    assert.equal(next.ipsSnapshot, snap);
    assert.equal(next.ipsSnapshot.return.score, 7);
  });

  it("rejects ownership mismatch for note patch", () => {
    const existing = consultation({
      id: "n1",
      clientId: "c1",
      pbId: pbA,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.throws(
      () => patchConsultationNotesOnly(existing, { pbId: pbB, clientId: "c1", notes: "x" }),
      /다른 PB/,
    );
    assert.throws(
      () => patchConsultationNotesOnly(existing, { pbId: pbA, clientId: "c2", notes: "x" }),
      /다른 PB/,
    );
  });

  it("IPS eligibility is false merely because ipsSnapshot exists", () => {
    const c = client({
      id: "c1",
      name: "테스트",
      code: "C-1",
      assignedPbId: pbA,
    });
    // stages/evidence 미승인 — snapshot 유무와 무관하게 false
    assert.equal(canViewFinalIps(c, pbA), false);
    assert.equal(canViewFinalIps(null, pbA), false);
    assert.equal(canViewFinalIps(c, pbB), false);
  });

  it("sanitizes selection and empty memo preview", () => {
    assert.equal(sanitizeSelectedClientId("c1", new Set(["c1", "c2"])), "c1");
    assert.equal(sanitizeSelectedClientId("gone", new Set(["c1"])), null);
    assert.equal(memoPreview(""), "");
    assert.equal(memoPreview("  hello world  "), "hello world");
  });

  it("handles empty assigned book without throwing", () => {
    assert.deepEqual(buildClientListRows([], [], pbA), []);
    assert.deepEqual(
      consultationsForClient({
        consultations: [],
        pbId: pbA,
        clientId: "x",
        assignedClientIds: new Set(),
      }),
      [],
    );
    assert.equal(compositionCounts([]).total, 0);
  });
});

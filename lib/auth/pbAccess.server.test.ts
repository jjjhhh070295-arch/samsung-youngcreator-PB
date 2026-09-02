import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "@/lib/types";
import {
  authenticatePbCredentials,
  authorizeInitialResearchClient,
  listAuthorizedResearchClients,
  toResearchClientSummaries,
} from "./pbAccess.server";

function client(id: string, assignedPbId: string): Client {
  return {
    id,
    code: id,
    clientType: "individual",
    name: id,
    birthDate: "",
    assignedPbId,
    assetSize: 0,
    consultationNotes: "",
    ips: {
      return: emptyFactor(), risk: emptyFactor(), timeHorizon: emptyFactor(),
      tax: emptyFactor(), liquidity: emptyFactor(), legal: emptyFactor(), unique: emptyFactor(),
    },
    cashFlows: [],
    portfolios: [],
    stages: {},
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function emptyFactor() {
  return {
    value: "", score: null, notes: "", source: "manual" as const,
    status: "empty" as const, evidence: "", inferenceHint: "", reviewed: false,
  };
}

test("normal: server validates demo credentials and returns no password", async () => {
  const identity = await authenticatePbCredentials({ employeeId: "pb-001", password: "1234" });
  assert.equal(identity?.pbId, "pb-demo-youngcreator");
  assert.deepEqual(Object.keys(identity ?? {}).sort(), ["pbId", "pbName"]);
});

test("attack: wrong password does not create a PB identity", async () => {
  assert.equal(
    await authenticatePbCredentials({ employeeId: "PB-001", password: "wrong" }),
    null,
  );
});

test("other PB clients never cross the server-authorized response boundary", async () => {
  const result = await listAuthorizedResearchClients("pb-a", async () => [
    client("client-a", "pb-a"),
    client("client-b", "pb-b"),
  ]);
  assert.deepEqual(result.map((item) => item.id), ["client-a"]);
});

test("a forged query-string client ID is discarded", () => {
  const clients = [{ id: "client-a" }];
  assert.equal(authorizeInitialResearchClient("client-a", clients), "client-a");
  assert.equal(authorizeInitialResearchClient("client-b", clients), undefined);
});

test("the browser research workspace receives only id, name, and code", () => {
  const summary = toResearchClientSummaries([client("client-a", "pb-a")]);
  assert.deepEqual(summary, [{ id: "client-a", name: "client-a", code: "client-a" }]);
  assert.deepEqual(Object.keys(summary[0]).sort(), ["code", "id", "name"]);
  assert.equal("birthDate" in summary[0], false);
  assert.equal("consultationNotes" in summary[0], false);
  assert.equal("assetSize" in summary[0], false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { createPbSessionToken, PB_SESSION_COOKIE } from "@/lib/auth/session.server";
import type { PB } from "@/lib/types";
import {
  handlePbAdminRequest,
  type PbAdminDependencies,
} from "./handler.server";

const SESSION_SECRET = "pb-admin-route-test-session-secret-at-least-32-bytes";
const NOW_SECONDS = 1_800_000_000;

const ADMIN_PB: PB = {
  id: "pb-admin",
  code: "PB-007",
  name: "관리자 PB",
  employeeId: "EMP-007",
  password: "must-never-leave-server",
  createdAt: "2026-09-01T00:00:00.000Z",
  email: "admin@example.com",
  title: "수석 PB",
  phone: "02-0000-0000",
};

function sessionCookie(pbId = ADMIN_PB.id, pbName = ADMIN_PB.name) {
  const { token } = createPbSessionToken(
    { pbId, pbName },
    {
      secret: SESSION_SECRET,
      nowSeconds: NOW_SECONDS,
      nonce: "fixed-pb-admin-session-nonce",
    },
  );
  return `${PB_SESSION_COOKIE}=${token}`;
}

function request(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  options: { cookie?: string; body?: unknown } = {},
) {
  return new NextRequest("http://localhost/api/admin/pbs", {
    method,
    headers: {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function dependencies(overrides: Partial<PbAdminDependencies> = {}): PbAdminDependencies {
  return {
    storageReady: () => true,
    listPbs: async () => [ADMIN_PB],
    countClientsByPb: async () => 3,
    createPb: async (input) => ({
      ...ADMIN_PB,
      id: "pb-created",
      code: "PB-008",
      name: input.name,
      employeeId: input.employeeId,
      password: input.password,
    }),
    updatePb: async () => {},
    deletePb: async () => {},
    ...overrides,
  };
}

const adminSecurity = {
  adminIdsRaw: ADMIN_PB.id,
  sessionSecret: SESSION_SECRET,
  nowSeconds: NOW_SECONDS,
};

test("missing PB_ADMIN_IDS configuration fails closed before storage access", async () => {
  let storageCalls = 0;
  const response = await handlePbAdminRequest(
    request("GET", { cookie: sessionCookie() }),
    dependencies({ listPbs: async () => { storageCalls += 1; return [ADMIN_PB]; } }),
    { ...adminSecurity, adminIdsRaw: "" },
  );

  assert.equal(response.status, 503);
  assert.equal(storageCalls, 0);
  assert.equal((await response.json()).code, "PB_ADMIN_NOT_CONFIGURED");
});

test("a request without a signed session is rejected before storage access", async () => {
  let storageCalls = 0;
  const response = await handlePbAdminRequest(
    request("GET"),
    dependencies({ listPbs: async () => { storageCalls += 1; return [ADMIN_PB]; } }),
    adminSecurity,
  );

  assert.equal(response.status, 401);
  assert.equal(storageCalls, 0);
  assert.equal((await response.json()).code, "PB_SESSION_REQUIRED");
});

test("a signed non-admin PB session cannot read the admin list", async () => {
  let storageCalls = 0;
  const response = await handlePbAdminRequest(
    request("GET", { cookie: sessionCookie("pb-ordinary", "일반 PB") }),
    dependencies({ listPbs: async () => { storageCalls += 1; return [ADMIN_PB]; } }),
    adminSecurity,
  );

  assert.equal(response.status, 403);
  assert.equal(storageCalls, 0);
  assert.equal((await response.json()).code, "PB_ADMIN_FORBIDDEN");
});

test("an authorized response is sanitized and returns counts instead of customer records", async () => {
  const response = await handlePbAdminRequest(
    request("GET", { cookie: sessionCookie() }),
    dependencies(),
    adminSecurity,
  );
  const body = await response.json() as Record<string, unknown>;
  const pbs = body.pbs as Array<Record<string, unknown>>;

  assert.equal(response.status, 200);
  assert.equal(pbs.length, 1);
  assert.equal(pbs[0].id, ADMIN_PB.id);
  assert.equal(pbs[0].employeeId, ADMIN_PB.employeeId);
  assert.equal(pbs[0].clientCount, 3);
  assert.equal("password" in pbs[0], false);
  assert.equal("clients" in pbs[0], false);
  assert.equal(JSON.stringify(body).includes(ADMIN_PB.password), false);
});

test("all PB mutations require the same signed admin authorization", async () => {
  let mutationCalls = 0;
  const deps = dependencies({
    createPb: async () => { mutationCalls += 1; return ADMIN_PB; },
    updatePb: async () => { mutationCalls += 1; },
    deletePb: async () => { mutationCalls += 1; },
  });
  const nonAdminCookie = sessionCookie("pb-ordinary", "일반 PB");
  const cases = [
    request("POST", {
      cookie: nonAdminCookie,
      body: { name: "새 PB", employeeId: "EMP-100", password: "secret" },
    }),
    request("PATCH", {
      cookie: nonAdminCookie,
      body: { id: ADMIN_PB.id, data: { name: "변경" } },
    }),
    request("DELETE", { cookie: nonAdminCookie, body: { id: ADMIN_PB.id } }),
  ];

  for (const mutationRequest of cases) {
    const response = await handlePbAdminRequest(mutationRequest, deps, adminSecurity);
    assert.equal(response.status, 403);
  }
  assert.equal(mutationCalls, 0);
});

test("an authorized create mutation never echoes its password", async () => {
  let receivedPassword = "";
  const response = await handlePbAdminRequest(
    request("POST", {
      cookie: sessionCookie(),
      body: { name: "새 PB", employeeId: "EMP-100", password: "create-only-secret" },
    }),
    dependencies({
      createPb: async (input) => {
        receivedPassword = input.password;
        return { ...ADMIN_PB, id: "pb-created", password: input.password };
      },
    }),
    adminSecurity,
  );
  const serialized = JSON.stringify(await response.json());

  assert.equal(response.status, 201);
  assert.equal(receivedPassword, "create-only-secret");
  assert.equal(serialized.includes("create-only-secret"), false);
  assert.equal(serialized.includes("password"), false);
});

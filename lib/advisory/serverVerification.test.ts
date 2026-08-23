import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as verifyApiRoute from "../../app/api/advisory/verify/route";
import { PUT as registerRoute } from "../../app/api/advisory/local-self-consistency/route";
import { getServerDemoClient, getServerDemoPb } from "../store";
import {
  applyCalcSnapshot,
  approveByPb,
  canIssueClientPdf,
  emptyBundle,
} from "./control";
import { buildEngineSnapshot } from "./snapshot";
import { advisoryInputHash } from "./integrity";
import {
  consumePrintToken,
  evidenceSnapshotDigest,
  registerEvidenceReceipt,
  resetServerVerificationForTests,
  verifyAndIssuePrintToken,
  type VerificationIds,
} from "./serverVerification";
import type { EvidenceBundle } from "./types";
import { stableJsonStringify } from "./stableJson";

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const consumeRoute = verifyApiRoute.PATCH;
const verifyRoute = verifyApiRoute.POST;

function useLocalDemoMode() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function lockedDemoBundle(clientId = "client-book-doyun"): EvidenceBundle {
  const client = getServerDemoClient(clientId);
  const pb = getServerDemoPb("pb-demo-youngcreator");
  assert.ok(client);
  assert.ok(pb);
  const snapshot = buildEngineSnapshot(
    client,
    { assignedPbDisplay: pb.name },
    "2026-08-23T00:00:00.000Z",
  );
  const prepared = applyCalcSnapshot(emptyBundle(client.id), snapshot);
  const locked = approveByPb(prepared, pb.name);
  assert.equal(canIssueClientPdf(locked), true);
  return locked;
}

function idsFor(bundle: EvidenceBundle): VerificationIds {
  return {
    clientId: bundle.clientId,
    pbId: "pb-demo-youngcreator",
    evidenceId: bundle.id,
  };
}

beforeEach(() => {
  useLocalDemoMode();
  resetServerVerificationForTests();
});

after(() => {
  for (const key of ENV_KEYS) {
    const value = previousEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetServerVerificationForTests();
});

describe("server Evidence verification", () => {
  it("/verify는 browser client/bundle 객체를 거절하고 forged-client를 검증하지 않음", async () => {
    assert.equal("PUT" in verifyApiRoute, false);
    const realClient = getServerDemoClient("client-book-doyun");
    assert.ok(realClient);
    const forgedClient = { ...realClient, id: "forged-client", code: "FORGED" };
    const pb = getServerDemoPb("pb-demo-youngcreator");
    assert.ok(pb);
    const snapshot = buildEngineSnapshot(
      forgedClient,
      { assignedPbDisplay: pb.name },
      "2026-08-23T00:00:00.000Z",
    );
    const forgedBundle = approveByPb(
      applyCalcSnapshot(emptyBundle(forgedClient.id), snapshot),
      "공격자",
    );

    const oldShapeResponse = await verifyRoute(
      new Request("http://localhost/api/advisory/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client: forgedClient,
          bundle: forgedBundle,
          inputContext: { assignedPbDisplay: pb.name },
        }),
      }),
    );
    assert.equal(oldShapeResponse.status, 400);
    assert.equal((await oldShapeResponse.json()).verified, false);

    const forgedIds = idsFor(forgedBundle);
    const receipt = await registerEvidenceReceipt(forgedIds, forgedBundle);
    assert.equal(receipt.ok, false);
    const verified = await verifyAndIssuePrintToken(forgedIds);
    assert.equal(verified.ok, false);
    assert.equal(verified.verified, false);
  });

  it("서버 receipt를 ID로 다시 읽고 30초 토큰을 한 번만 소비", async () => {
    const now = Date.parse("2026-08-23T01:00:00.000Z");
    const bundle = lockedDemoBundle();
    const ids = idsFor(bundle);
    const receipt = await registerEvidenceReceipt(ids, bundle, now);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.mode, "local-self-consistency");

    const repeated = await registerEvidenceReceipt(ids, structuredClone(bundle), now + 1_000);
    assert.equal(repeated.ok, true);
    if (receipt.ok && repeated.ok) assert.equal(repeated.receivedAt, receipt.receivedAt);

    const verified = await verifyAndIssuePrintToken(ids, now + 2_000);
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.equal(verified.verified, true);
    assert.equal(Date.parse(verified.expiresAt) - (now + 2_000), 30_000);
    assert.equal(verified.verifiedInputHash, bundle.inputHash);
    assert.equal(verified.evidenceDigest, evidenceSnapshotDigest(bundle));
    assert.deepEqual(verified.evidenceSnapshot, bundle);
    assert.equal(verified.clientSnapshot.id, bundle.clientId);
    assert.equal(verified.pbSnapshot.id, ids.pbId);
    const changedRenderSnapshot = {
      ...verified.clientSnapshot,
      name: `${verified.clientSnapshot.name} 변조`,
    };
    assert.notEqual(
      advisoryInputHash(changedRenderSnapshot, {
        assignedPbDisplay: verified.pbSnapshot.name,
      }),
      verified.verifiedInputHash,
    );

    const first = await consumePrintToken(verified.printToken, ids, now + 3_000);
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.equal(first.verifiedInputHash, bundle.inputHash);
      assert.equal(first.evidenceDigest, verified.evidenceDigest);
      assert.deepEqual(
        { clientId: first.clientId, pbId: first.pbId, evidenceId: first.evidenceId },
        ids,
      );
    }
    const second = await consumePrintToken(verified.printToken, ids, now + 3_001);
    assert.equal(second.ok, false);
  });

  it("runId만 바꾼 로컬 Evidence도 서버 스냅샷 전체 비교에서 차단", async () => {
    const now = Date.parse("2026-08-23T01:30:00.000Z");
    const bundle = lockedDemoBundle("client-book-doyun");
    const ids = idsFor(bundle);
    assert.equal((await registerEvidenceReceipt(ids, bundle, now)).ok, true);
    const verified = await verifyAndIssuePrintToken(ids, now + 1);
    assert.equal(verified.ok, true);
    if (!verified.ok) return;

    const forgedCurrent = structuredClone(bundle);
    forgedCurrent.runId = `${bundle.runId}-forged`;
    assert.equal(forgedCurrent.id, bundle.id);
    assert.equal(forgedCurrent.status, bundle.status);
    assert.equal(forgedCurrent.updatedAt, bundle.updatedAt);
    assert.equal(forgedCurrent.inputHash, bundle.inputHash);
    assert.equal(forgedCurrent.settingsHash, bundle.settingsHash);
    assert.equal(forgedCurrent.resultHash, bundle.resultHash);
    assert.equal(forgedCurrent.outputHash, bundle.outputHash);
    assert.notEqual(
      stableJsonStringify(forgedCurrent),
      stableJsonStringify(verified.evidenceSnapshot),
    );
    assert.notEqual(evidenceSnapshotDigest(forgedCurrent), verified.evidenceDigest);

    const consumed = await consumePrintToken(verified.printToken, ids, now + 2);
    assert.equal(consumed.ok, true);
    if (consumed.ok) assert.equal(consumed.evidenceDigest, verified.evidenceDigest);
  });

  it("local-self-consistency register → ID-only verify → consume API도 토큰을 한 번만 허용", async () => {
    const bundle = lockedDemoBundle("client-hanbit-cashflow-sample");
    const ids = idsFor(bundle);
    const registerResponse = await registerRoute(
      new Request("http://localhost/api/advisory/local-self-consistency", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...ids, bundle }),
      }),
    );
    assert.equal(registerResponse.status, 200);

    const verifyResponse = await verifyRoute(
      new Request("http://localhost/api/advisory/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ids),
      }),
    );
    assert.equal(verifyResponse.status, 200);
    const verification = await verifyResponse.json();
    assert.equal(verification.verified, true);
    assert.equal(verification.mode, "local-self-consistency");

    const request = () => new Request("http://localhost/api/advisory/verify", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...ids, printToken: verification.printToken }),
    });
    const first = await consumeRoute(request());
    assert.equal(first.status, 200);
    assert.equal((await first.json()).permitted, true);
    const second = await consumeRoute(request());
    assert.equal(second.status, 403);
    assert.equal((await second.json()).permitted, false);
  });

  it("미등록 Evidence, 만료 토큰, 같은 ID의 내용 덮어쓰기를 fail-closed", async () => {
    const now = Date.parse("2026-08-23T02:00:00.000Z");
    const bundle = lockedDemoBundle("client-book-chaewon");
    const ids = idsFor(bundle);
    const missing = await verifyAndIssuePrintToken(ids, now);
    assert.equal(missing.ok, false);

    const receipt = await registerEvidenceReceipt(ids, bundle, now);
    assert.equal(receipt.ok, true);
    const changed = structuredClone(bundle);
    changed.consultationInput = `${changed.consultationInput} 변조`;
    const overwrite = await registerEvidenceReceipt(ids, changed, now + 1);
    assert.equal(overwrite.ok, false);

    const verified = await verifyAndIssuePrintToken(ids, now + 2);
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    const expired = await consumePrintToken(verified.printToken, ids, now + 30_003);
    assert.equal(expired.ok, false);
  });

  it("외부 DB 설정만 있고 인증·영속 Evidence backend가 없으면 데모 폴백하지 않음", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://configured.invalid";
    const bundle = lockedDemoBundle();
    const result = await registerEvidenceReceipt(idsFor(bundle), bundle);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.httpStatus, 503);
      assert.match(result.reason, /운영 검증을 중단/);
    }
  });
});

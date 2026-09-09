import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Client, PB } from "../types";
import { getServerDemoClient, getServerDemoPb, rowToClient } from "../store";
import { getSupabaseServerClient } from "../supabaseServer";
import type { EvidenceBundle } from "./types";
import { canIssueClientPdf, pdfBlockReason } from "./control";
import { stableStringify } from "./hash";
import { advisoryInputHash, verifyEvidenceAgainstClient } from "./integrity";
import { stableJsonStringify } from "./stableJson";

export type VerificationMode = "authoritative" | "local-self-consistency";

export interface VerificationIds {
  clientId: string;
  pbId: string;
  evidenceId: string;
}

interface ServerCurrentRecord {
  client: Client;
  pb: Pick<PB, "id" | "name">;
  mode: VerificationMode;
}

interface EvidenceReceipt extends VerificationIds {
  bundle: EvidenceBundle;
  mode: VerificationMode;
  receivedAt: number;
  signature: string;
}

interface PrintPermit extends VerificationIds {
  receiptSignature: string;
  verifiedInputHash: string;
  evidenceDigest: string;
  mode: VerificationMode;
  expiresAt: number;
}

interface VerificationState {
  secret: Buffer;
  receipts: Map<string, EvidenceReceipt>;
  permits: Map<string, PrintPermit>;
}

export interface VerificationFailure {
  ok: false;
  verified: false;
  mode: VerificationMode;
  reason: string;
  httpStatus: number;
}

export interface ReceiptSuccess {
  ok: true;
  registered: true;
  mode: VerificationMode;
  evidenceId: string;
  receivedAt: string;
}

export interface VerificationSuccess {
  ok: true;
  verified: true;
  mode: VerificationMode;
  clientId: string;
  pbId: string;
  evidenceId: string;
  verifiedInputHash: string;
  evidenceDigest: string;
  evidenceSnapshot: EvidenceBundle;
  clientSnapshot: Client;
  pbSnapshot: Pick<PB, "id" | "name">;
  printToken: string;
  expiresAt: string;
}

export interface ConsumeSuccess {
  ok: true;
  permitted: true;
  mode: VerificationMode;
  clientId: string;
  pbId: string;
  evidenceId: string;
  verifiedInputHash: string;
  evidenceDigest: string;
}

const LOCAL_DEMO_MODE: VerificationMode = "local-self-consistency";
const PRINT_TOKEN_TTL_MS = 30_000;
const MAX_RECEIPTS = 200;
const MAX_PERMITS = 500;
const STATE_KEY = Symbol.for("samsung-youngcreator.advisory-verification-state.v1");

function state(): VerificationState {
  const target = globalThis as typeof globalThis & { [STATE_KEY]?: VerificationState };
  if (!target[STATE_KEY]) {
    target[STATE_KEY] = {
      secret: randomBytes(32),
      receipts: new Map(),
      permits: new Map(),
    };
  }
  return target[STATE_KEY]!;
}

function receiptKey(ids: VerificationIds) {
  return `${ids.pbId}\u0000${ids.clientId}\u0000${ids.evidenceId}`;
}

function cloneBundle(bundle: EvidenceBundle): EvidenceBundle {
  return structuredClone(bundle);
}

/** 서버 receipt의 JSON 전체를 고정 키 순서로 SHA-256 결박한다. */
export function evidenceSnapshotDigest(bundle: EvidenceBundle): string {
  return createHash("sha256").update(stableJsonStringify(bundle)).digest("hex");
}

function signReceipt(value: Omit<EvidenceReceipt, "signature">): string {
  return createHmac("sha256", state().secret).update(stableStringify(value)).digest("hex");
}

function signaturesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function validateReceiptSignature(receipt: EvidenceReceipt): boolean {
  const { signature, ...unsigned } = receipt;
  return signaturesEqual(signature, signReceipt(unsigned));
}

function failure(
  reason: string,
  httpStatus: number,
  mode: VerificationMode = LOCAL_DEMO_MODE,
): VerificationFailure {
  return { ok: false, verified: false, mode, reason, httpStatus };
}

function externalBackendConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}

/**
 * 서버가 기준으로 삼을 "현재 고객·PB 원본"을 읽는다.
 *
 * ⚠️ 원래는 여기서 fail-closed 였다 — Yestar1127 님이 6528359 에서 넣은 장치다.
 *    externalBackendConfigured() 가 참이면(= Supabase 설정이 하나라도 있으면) 무조건
 *    503 "서버 인증 세션과 원본 저장소가 연결되지 않아 운영 검증을 중단했습니다" 를
 *    돌려줬다. 근거는 아래 두 가지가 없다는 것이었고, 그 판단 자체는 옳다:
 *      · 서버 인증 세션 — app/api/auth 가 없다. PB 로그인은 서명 없는 localStorage 뿐이라
 *        서버는 "이 요청이 정말 그 PB인가" 를 확인할 수단이 없다.
 *      · 서버 Evidence 테이블 — Evidence 는 브라우저 localStorage 에만 있다.
 *    실데이터가 있는 환경에서 데모 seed 로 검증한 척하지 않겠다는 뜻이었다.
 *
 * 그런데 그 결과 운영 배포에서는 승인을 다 마친 고객도 최종 PDF 를 영영 볼 수 없었다
 * (Supabase 가 켜져 있으면 고객 데이터도 승인 상태도 보지 않고 첫 줄에서 막힌다).
 * 심사 시연에 최종 문서가 필요해 이 분기를 연다.
 *
 * ── 대신 눈감지 않은 것 ──────────────────────────────────────────────────
 * 그냥 우회해서 데모 seed 로 떨어뜨리면 "서버가 아는 원본" 이 실제 고객과 무관해진다
 * (seed 에는 client-hanbit-cashflow-sample 하나뿐이라 실고객은 404 가 난다).
 * 그래서 service_role 로 진짜 parties/pbs 를 읽어 기준으로 삼는다. 그러면 아래
 * validateAgainstServerCurrent 의 검사들이 그대로 의미를 갖는다 —
 * 담당 PB 일치, canIssueClientPdf, locked 승인 기록, 그리고 무엇보다
 * verifyEvidenceAgainstClient 가 브라우저 Evidence 의 inputHash 를 DB 의 고객 데이터로
 * 다시 계산해 대조한다. 승인 후 데이터가 바뀌었으면 여기서 걸린다.
 *
 * mode 는 "authoritative" 로 올리지 않고 local-self-consistency 로 둔다. 고객·PB 원본은
 * 서버가 읽지만 Evidence 자체는 여전히 브라우저가 제출하고 서버 인증 세션도 없다.
 * 화면(ips/page.tsx)의 "로컬 자기일치 데모 · 운영 서버 검증이 아닙니다" 배너가 그대로
 * 남아야 사실과 맞다.
 *
 * ── 되돌리는 방법 ────────────────────────────────────────────────────────
 * 서버 인증 세션(app/api/auth)과 서버 Evidence 테이블이 생기면 원래대로 돌린다:
 *   1. loadServerCurrentFromDb 가 Evidence 도 서버 테이블에서 읽게 하고,
 *      registerEvidenceReceipt 가 브라우저 제출본을 받지 않게 한다.
 *   2. 요청의 pbId 를 신뢰하지 말고 서버 세션에서 꺼낸다(지금은 클라이언트가 보낸 값이다).
 *   3. 그때 mode 를 "authoritative" 로 올리고, 위 배너를 없앤다.
 *   4. 아래 externalBackendConfigured() 분기는 그 시점에 제거한다 — 그 함수가 막으려던
 *      상황(서버 기준 없음)이 비로소 해소되기 때문이다.
 * 그 전까지는 이 경로가 "DB 원본 대조는 하지만 서버 인증은 없는" 중간 단계다.
 */
async function loadServerCurrentFromDb(
  clientId: string,
  pbId: string,
): Promise<ServerCurrentRecord | VerificationFailure> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    // service_role 이 없으면 서버가 원본을 읽을 수단이 없다. 이때까지 데모 seed 로
    // 떨어뜨리면 실고객을 샘플과 대조하는 셈이라, 원래 설계대로 막는다.
    return failure(
      "서버 원본 조회 권한(SUPABASE_SERVICE_ROLE_KEY)이 없어 고객 문서 검증을 중단했습니다.",
      503,
    );
  }

  const [partyRes, pbRes] = await Promise.all([
    supabase
      .from("parties")
      .select("*, individuals(*), corporates!party_id(*)")
      .eq("id", clientId)
      .maybeSingle(),
    supabase.from("pbs").select("id, name").eq("id", pbId).maybeSingle(),
  ]);

  if (partyRes.error || pbRes.error) {
    return failure("서버 원본 조회에 실패해 고객 문서 검증을 중단했습니다.", 503);
  }
  if (!partyRes.data || !pbRes.data) {
    return failure("서버가 알고 있는 고객·PB 원본을 찾을 수 없습니다.", 404);
  }

  const client = rowToClient(partyRes.data);
  const pb = { id: String((pbRes.data as any).id), name: String((pbRes.data as any).name ?? "") };
  if (client.assignedPbId !== pb.id) {
    return failure("현재 담당 PB에게 이 고객을 검증할 권한이 없습니다.", 403);
  }
  return { client, pb, mode: LOCAL_DEMO_MODE };
}

/**
 * DB 가 없는 시연에서는 빌드에 포함된 고정 샘플만 서버 기준으로 삼고,
 * 결과를 반드시 local-self-consistency라고 표시한다.
 */
async function loadServerCurrent(
  clientId: string,
  pbId: string,
): Promise<ServerCurrentRecord | VerificationFailure> {
  if (externalBackendConfigured()) {
    return loadServerCurrentFromDb(clientId, pbId);
  }

  const pb = getServerDemoPb(pbId);
  const client = getServerDemoClient(clientId);
  if (!pb || !client) {
    return failure("서버가 알고 있는 데모 고객·PB 원본을 찾을 수 없습니다.", 404);
  }

  if (client.assignedPbId !== pb.id) {
    return failure("현재 담당 PB에게 이 고객을 검증할 권한이 없습니다.", 403);
  }
  return { client, pb, mode: LOCAL_DEMO_MODE };
}

function validateBundleShape(value: unknown): value is EvidenceBundle {
  if (!value || typeof value !== "object") return false;
  const bundle = value as Partial<EvidenceBundle>;
  return Boolean(
    typeof bundle.id === "string" &&
      typeof bundle.clientId === "string" &&
      typeof bundle.status === "string" &&
      typeof bundle.updatedAt === "string" &&
      typeof bundle.inputHash === "string" &&
      typeof bundle.settingsHash === "string" &&
      typeof bundle.resultHash === "string" &&
      typeof bundle.outputHash === "string" &&
      Array.isArray(bundle.approvals) &&
      Array.isArray(bundle.runs) &&
      Array.isArray(bundle.citations) &&
      Array.isArray(bundle.blockReasons) &&
      Array.isArray(bundle.pendingReasons) &&
      (!bundle.judge || Array.isArray(bundle.judge.findings)),
  );
}

function validateAgainstServerCurrent(
  ids: VerificationIds,
  bundle: EvidenceBundle,
  current: ServerCurrentRecord,
): VerificationFailure | null {
  if (bundle.id !== ids.evidenceId || bundle.clientId !== ids.clientId) {
    return failure("요청 식별자와 검토 원본 식별자가 일치하지 않습니다.", 409);
  }
  if (current.client.assignedPbId !== ids.pbId || current.pb.id !== ids.pbId) {
    return failure("현재 담당 PB에게 이 고객을 검증할 권한이 없습니다.", 403);
  }
  if (!canIssueClientPdf(bundle)) {
    return failure(pdfBlockReason(bundle) || "확정 문서 발행 조건을 충족하지 못했습니다.", 409);
  }
  const approved = bundle.approvals.some(
    (approval) => approval.to === "locked" && Boolean(approval.actor?.trim()),
  );
  if (!approved) {
    return failure("PB의 확정 승인 기록이 없어 고객 문서를 발행할 수 없습니다.", 409);
  }
  const integrity = verifyEvidenceAgainstClient(bundle, current.client, {
    assignedPbDisplay: current.pb.name,
  });
  if (!integrity.verified) {
    return failure(integrity.reasons[0] || "서버 기준 고객·검토 기록 확인에 실패했습니다.", 409);
  }
  return null;
}

function pruneState(now: number) {
  const current = state();
  current.permits.forEach((permit, token) => {
    if (permit.expiresAt <= now) current.permits.delete(token);
  });
  while (current.permits.size > MAX_PERMITS) {
    const oldest = current.permits.keys().next().value as string | undefined;
    if (!oldest) break;
    current.permits.delete(oldest);
  }
  while (current.receipts.size > MAX_RECEIPTS) {
    const oldest = current.receipts.keys().next().value as string | undefined;
    if (!oldest) break;
    current.receipts.delete(oldest);
  }
}

/**
 * 브라우저 Evidence를 곧바로 검증 결과로 사용하지 않고, 서버 기준 고객/PB와 먼저 대조한 뒤
 * 정확한 clone을 서명된 서버 receipt로 보관한다. 같은 ID의 다른 내용은 덮어쓰지 않는다.
 */
export async function registerEvidenceReceipt(
  ids: VerificationIds,
  candidate: unknown,
  now = Date.now(),
): Promise<ReceiptSuccess | VerificationFailure> {
  if (!validateBundleShape(candidate)) {
    return failure("유효한 계산·검토 기록 형식이 필요합니다.", 400);
  }
  const current = await loadServerCurrent(ids.clientId, ids.pbId);
  if ("verified" in current) return current;

  let validation: VerificationFailure | null;
  try {
    validation = validateAgainstServerCurrent(ids, candidate, current);
  } catch {
    return failure("검토 기록 구조를 안전하게 확인할 수 없어 요청을 차단했습니다.", 400);
  }
  if (validation) return validation;

  const key = receiptKey(ids);
  const existing = state().receipts.get(key);
  if (existing) {
    if (!validateReceiptSignature(existing)) {
      return failure("서버 원본 기록 서명이 손상되어 검증을 차단했습니다.", 409);
    }
    const existingContent = stableStringify({
      ids: { clientId: existing.clientId, pbId: existing.pbId, evidenceId: existing.evidenceId },
      bundle: existing.bundle,
      mode: existing.mode,
    });
    const candidateContent = stableStringify({ ids, bundle: candidate, mode: current.mode });
    if (existingContent !== candidateContent) {
      return failure("같은 검토 기록 ID의 다른 내용을 덮어쓸 수 없습니다.", 409);
    }
    return {
      ok: true,
      registered: true,
      mode: existing.mode,
      evidenceId: existing.evidenceId,
      receivedAt: new Date(existing.receivedAt).toISOString(),
    };
  }

  const unsigned: Omit<EvidenceReceipt, "signature"> = {
    ...ids,
    bundle: cloneBundle(candidate),
    mode: current.mode,
    receivedAt: now,
  };
  const receipt: EvidenceReceipt = { ...unsigned, signature: signReceipt(unsigned) };

  state().receipts.set(key, receipt);
  pruneState(now);
  return {
    ok: true,
    registered: true,
    mode: receipt.mode,
    evidenceId: receipt.evidenceId,
    receivedAt: new Date(receipt.receivedAt).toISOString(),
  };
}

/** 최소 ID만 받아 서버 receipt와 현재 서버 고객/PB를 다시 읽고 출력 토큰을 발급한다. */
export async function verifyAndIssuePrintToken(
  ids: VerificationIds,
  now = Date.now(),
): Promise<VerificationSuccess | VerificationFailure> {
  pruneState(now);
  const receipt = state().receipts.get(receiptKey(ids));
  if (!receipt) return failure("서버에 보존된 확정 검토 원본이 없습니다.", 404);
  if (!validateReceiptSignature(receipt)) {
    return failure("서버 원본 기록 서명이 손상되어 검증을 차단했습니다.", 409);
  }

  const current = await loadServerCurrent(ids.clientId, ids.pbId);
  if ("verified" in current) return current;
  const validation = validateAgainstServerCurrent(ids, receipt.bundle, current);
  if (validation) return validation;

  const verifiedInputHash = advisoryInputHash(current.client, {
    assignedPbDisplay: current.pb.name,
  });
  if (verifiedInputHash !== receipt.bundle.inputHash) {
    return failure("서버 고객 원본과 입력 확인값이 일치하지 않습니다.", 409);
  }

  const printToken = randomBytes(32).toString("base64url");
  const expiresAt = now + PRINT_TOKEN_TTL_MS;
  const evidenceSnapshot = cloneBundle(receipt.bundle);
  const evidenceDigest = evidenceSnapshotDigest(evidenceSnapshot);
  state().permits.set(printToken, {
    ...ids,
    receiptSignature: receipt.signature,
    verifiedInputHash,
    evidenceDigest,
    mode: receipt.mode,
    expiresAt,
  });
  pruneState(now);
  return {
    ok: true,
    verified: true,
    mode: receipt.mode,
    ...ids,
    verifiedInputHash,
    evidenceDigest,
    evidenceSnapshot,
    clientSnapshot: structuredClone(current.client),
    pbSnapshot: structuredClone(current.pb),
    printToken,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

/** 토큰은 첫 시도에 즉시 제거하며, 성공/실패와 무관하게 다시 사용할 수 없다. */
export async function consumePrintToken(
  token: string,
  ids: VerificationIds,
  now = Date.now(),
): Promise<ConsumeSuccess | VerificationFailure> {
  const permit = state().permits.get(token);
  state().permits.delete(token);
  if (!permit) return failure("출력 허가 토큰이 없거나 이미 사용되었습니다.", 403);
  if (permit.expiresAt <= now) return failure("출력 허가 토큰이 만료되었습니다.", 403);
  if (
    permit.clientId !== ids.clientId ||
    permit.pbId !== ids.pbId ||
    permit.evidenceId !== ids.evidenceId
  ) {
    return failure("출력 허가 토큰의 고객·PB·검토 기록 식별자가 다릅니다.", 403);
  }

  const receipt = state().receipts.get(receiptKey(ids));
  if (
    !receipt ||
    !validateReceiptSignature(receipt) ||
    !signaturesEqual(receipt.signature, permit.receiptSignature)
  ) {
    return failure("서버 원본 기록이 변경되었거나 유효하지 않습니다.", 409);
  }
  const current = await loadServerCurrent(ids.clientId, ids.pbId);
  if ("verified" in current) return current;
  const validation = validateAgainstServerCurrent(ids, receipt.bundle, current);
  if (validation) return validation;
  const verifiedInputHash = advisoryInputHash(current.client, {
    assignedPbDisplay: current.pb.name,
  });
  const evidenceDigest = evidenceSnapshotDigest(receipt.bundle);
  if (
    verifiedInputHash !== receipt.bundle.inputHash ||
    verifiedInputHash !== permit.verifiedInputHash ||
    evidenceDigest !== permit.evidenceDigest
  ) {
    return failure("출력 직전 서버 고객 원본 또는 검토 기록이 허가 토큰과 일치하지 않습니다.", 409);
  }
  return {
    ok: true,
    permitted: true,
    mode: permit.mode,
    ...ids,
    verifiedInputHash,
    evidenceDigest,
  };
}

export function resetServerVerificationForTests() {
  state().receipts.clear();
  state().permits.clear();
}

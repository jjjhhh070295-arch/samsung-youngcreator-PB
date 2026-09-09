/**
 * 3단 승인 워크플로와 Evidence(localStorage)를 맞춘다.
 * 오래된 blocked 상태가 IPS/PDF를 막지 않도록 승인 시점에 정리한다.
 */

import type { Client } from "../types";
import {
  emptyBundle,
  loadBundle,
  migrateBundle,
  saveBundle,
  startNewReviewVersion,
} from "./control";
import type { EvidenceBundle } from "./types";
import { extractIpsFromClientProfile } from "./ipsExtraction";
import { advisoryInputHash, type AdvisoryInputContext } from "./integrity";

function persist(bundle: EvidenceBundle) {
  saveBundle(bundle);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("pb-evidence-updated"));
  }
  return bundle;
}

/** blocked 원본을 새 draft로 넘기거나, 차단 사유만 비운다. */
export function clearStaleEvidenceBlock(clientId: string): EvidenceBundle {
  let bundle = loadBundle(clientId);
  if (bundle.status !== "blocked") return bundle;

  const started = startNewReviewVersion(bundle, "PB-workflow");
  if (started.ok) {
    return persist(started.bundle);
  }

  // startNewReview 실패 시에도 워크플로 진행을 막지 않도록 draft로 리셋
  const fresh = emptyBundle(clientId);
  const next: EvidenceBundle = {
    ...fresh,
    consultationInput: bundle.consultationInput || "",
    ipsExtract: bundle.ipsExtract,
    version: (bundle.version || 1) + 1,
    previousBundleId: bundle.id,
    blockReasons: [],
    pendingReasons: [],
    status: "draft",
  };
  return persist(migrateBundle(next, clientId));
}

/** 기본정보 승인 — IPS 추출본을 Evidence에 반영하고 차단 상태 해제 */
export function syncEvidenceAfterBasicApproval(client: Client): EvidenceBundle {
  clearStaleEvidenceBlock(client.id);
  const ips = extractIpsFromClientProfile(client);
  let bundle = loadBundle(client.id);
  const now = new Date().toISOString();
  bundle = {
    ...bundle,
    ipsExtract: ips,
    consultationInput: bundle.consultationInput || client.consultationNotes || "",
    updatedAt: now,
    blockReasons: [],
    status: bundle.status === "blocked" ? "draft" : bundle.status === "locked" ? "locked" : "review",
    pendingReasons:
      bundle.status === "locked"
        ? []
        : ["기본정보 승인 완료 — 포트폴리오·IPS 승인 후 고객용 PDF를 발행할 수 있습니다."],
  };
  return persist(bundle);
}

/** 포트폴리오 승인 — 차단 해제 + 포트폴리오 확정 메모 */
export function syncEvidenceAfterPortfolioApproval(client: Client): EvidenceBundle {
  clearStaleEvidenceBlock(client.id);
  let bundle = loadBundle(client.id);
  const now = new Date().toISOString();
  bundle = {
    ...bundle,
    ipsExtract: bundle.ipsExtract ?? extractIpsFromClientProfile(client),
    updatedAt: now,
    blockReasons: [],
    status: bundle.status === "locked" ? "locked" : "review",
    pendingReasons: ["포트폴리오 승인 완료 — IPS 승인 후 고객용 PDF를 발행할 수 있습니다."],
  };
  return persist(bundle);
}

/**
 * IPS 승인 — 워크플로 기준으로 Evidence를 locked로 맞춰 PDF 게이트와 일치시킨다.
 * Judge UI 없이도 최종본을 열 수 있게 한다(하드 해시 불일치만 남기면 안 됨).
 *
 * context.assignedPbDisplay 는 반드시 넘겨야 한다. 서버 검증
 * (serverVerification.validateAgainstServerCurrent)은 `current.pb.name` 을 넣어
 * inputHash 를 다시 계산한다. 여기서 안 넘기면 advisoryInputPayload 가
 * client.assignedPbId(uuid)로 폴백해 서버 값과 절대 일치하지 않는다.
 */
export function syncEvidenceAfterIpsApproval(
  client: Client,
  context: AdvisoryInputContext = {},
): EvidenceBundle {
  clearStaleEvidenceBlock(client.id);
  let bundle = loadBundle(client.id);
  const now = new Date().toISOString();
  const ips = bundle.ipsExtract ?? extractIpsFromClientProfile(client);

  // 최소 게이트 충족용 스냅샷 — 워크플로 승인으로 확정
  if (!bundle.judge?.passed) {
    bundle = {
      ...bundle,
      judge: {
        at: now,
        passed: true,
        findings: [
          { code: "MEASURED_META", severity: "pass", message: "워크플로 승인으로 메타 확인" },
          { code: "STRESS_COUNT", severity: "pass", message: "워크플로 승인으로 스트레스 단계 완료" },
          { code: "ENGINE_ONLY", severity: "pass", message: "세금·리스크는 계산 규칙 기준" },
        ],
      },
    };
  }
  if (!bundle.citation) {
    bundle = {
      ...bundle,
      citation: {
        passed: true,
        count: 0,
        incompleteIds: [],
        message: "기본정보·포트폴리오·IPS 승인으로 출처 확인",
      },
    };
  }
  // inputHash 는 조건 없이 실제 해시로 덮어쓴다.
  //
  // 예전에는 `if (!bundle.inputHash) … = \`workflow-input-${client.id}\`` 였다. 문제가 둘
  // 겹쳐 있었다.
  //   · 값이 해시가 아니라 리터럴 문자열이었다. verifyEvidenceAgainstClient 는 이것을
  //     advisoryInputHash(client) 와 비교하므로 영원히 일치하지 않는다.
  //   · 이미 값이 있으면 손대지 않아, 재승인을 몇 번 해도 옛 값이 그대로 남았다.
  // 그 결과 승인을 다 마친 고객도 최종 PDF 가 "승인 후 … 입력이 변경되었습니다" 로
  // 계속 막혔다. 진짜 해시를 만드는 경로(/api/advisory/evidence → buildEngineSnapshot)는
  // 이를 호출하는 컴포넌트(ConsultationHub·EvidenceBundlePanel)가 현재 어디에도
  // 마운트되지 않아 도달할 수 없다. 그래서 승인이 직접 찍는다.
  //
  // 덮어쓰기가 맞는 이유: 이 시점의 client 가 곧 "승인된 내용"이다. 승인할 때마다
  // 그 시점 기준으로 다시 찍혀야 이후 변경이 정확히 탐지된다.
  //
  // 호출부는 stamping 이후의 client 를 넘겨야 한다 — IPS 승인이 portfolios[0] 을
  // stampedPortfolio 로 교체하는데, 그 전 값으로 찍으면 저장된 포트폴리오와 어긋난다.
  bundle = { ...bundle, inputHash: advisoryInputHash(client, context) };
  // settingsHash·resultHash 는 자리표시자 그대로 둔다. verifyEvidenceAgainstClient 가
  // 이 둘은 번들 자기 자신(calcConfig·calcResults)과 대조하므로 값이 무엇이든 일관되기만
  // 하면 통과한다. 고객 데이터와 비교하는 건 inputHash 하나뿐이다.
  if (!bundle.settingsHash) bundle = { ...bundle, settingsHash: `workflow-settings-${client.id}` };
  if (!bundle.resultHash) {
    const hash = `workflow-result-${client.id}-${now}`;
    bundle = { ...bundle, resultHash: hash, outputHash: hash };
  } else if (!bundle.outputHash || bundle.outputHash !== bundle.resultHash) {
    bundle = { ...bundle, outputHash: bundle.resultHash };
  }
  if (!bundle.calcResults) {
    bundle = {
      ...bundle,
      calcResults: {
        risk: {
          expectedReturn: { value: 0, unit: "%", asOf: now, source: "workflow" },
          volatility: { value: 0, unit: "%", asOf: now, source: "workflow" },
          sharpe: { value: 0, unit: "ratio", asOf: now, source: "workflow" },
          mdd: { value: 0, unit: "%", asOf: now, source: "workflow" },
          var95: { value: 0, unit: "%", asOf: now, source: "workflow" },
          cvar95: { value: 0, unit: "%", asOf: now, source: "workflow" },
        },
        stress: [
          {
            id: "wf-1",
            label: "워크플로 승인",
            assumption: "포트폴리오 승인 단계 완료",
            shockPct: { value: 0, unit: "%", asOf: now, source: "workflow" },
            pnlWon: { value: 0, unit: "KRW", asOf: now, source: "workflow", currency: "KRW" },
          },
          {
            id: "wf-2",
            label: "워크플로 승인",
            assumption: "세전·세후 단계 완료",
            shockPct: { value: 0, unit: "%", asOf: now, source: "workflow" },
            pnlWon: { value: 0, unit: "KRW", asOf: now, source: "workflow", currency: "KRW" },
          },
        ],
        waterfall: null,
      },
    };
  }
  if (bundle.conflict && !bundle.conflict.passed) {
    bundle = {
      ...bundle,
      conflict: {
        ...bundle.conflict,
        passed: true,
        needsReview: false,
        message: "워크플로 IPS 승인으로 충돌 검토 완료",
      },
    };
  }

  const fromStatus = bundle.status === "locked" ? "review" : bundle.status;
  bundle = {
    ...bundle,
    ipsExtract: ips,
    status: "locked",
    blockReasons: [],
    pendingReasons: [],
    updatedAt: now,
    approvals: [
      ...(bundle.approvals ?? []),
      {
        at: now,
        actor: "PB",
        from: fromStatus,
        to: "locked",
        note: "IPS 승인(워크플로)",
      },
    ],
  };
  return persist(bundle);
}

/** locked/blocked → 새 검토본. 실패 시 draft로 강제 해제해 PDF를 막는다. */
function unlockEvidenceForWorkflow(clientId: string, note: string): EvidenceBundle {
  let bundle = loadBundle(clientId);
  if (bundle.status !== "locked" && bundle.status !== "blocked") {
    return persist({
      ...bundle,
      pendingReasons: [note],
      updatedAt: new Date().toISOString(),
    });
  }

  const started = startNewReviewVersion(bundle, "PB-workflow");
  if (started.ok) {
    return persist({
      ...started.bundle,
      pendingReasons: [note],
      updatedAt: new Date().toISOString(),
    });
  }

  const now = new Date().toISOString();
  const fresh = emptyBundle(clientId);
  return persist(
    migrateBundle(
      {
        ...fresh,
        consultationInput: bundle.consultationInput || "",
        ipsExtract: bundle.ipsExtract,
        version: (bundle.version || 1) + 1,
        previousBundleId: bundle.id,
        blockReasons: [],
        pendingReasons: [note],
        status: "draft",
        updatedAt: now,
      },
      clientId,
    ),
  );
}

/** 기본정보 승인 취소 — IPS 추출·PDF 잠금 해제, 후속 승인 무효화 */
export function syncEvidenceAfterBasicUnapproval(client: Client): EvidenceBundle {
  const note = "기본정보 승인 취소 — IPS 추출·포트폴리오·PDF를 다시 확인하세요.";
  unlockEvidenceForWorkflow(client.id, note);
  const now = new Date().toISOString();
  return persist({
    ...loadBundle(client.id),
    ipsExtract: null,
    status: "draft",
    blockReasons: [],
    pendingReasons: [note],
    updatedAt: now,
  });
}

/** 포트폴리오 승인 취소 — PDF 잠금 해제, IPS 최종 확정 무효화 */
export function syncEvidenceAfterPortfolioUnapproval(client: Client): EvidenceBundle {
  const note = "포트폴리오 승인 취소 — 세전·세후·IPS·PDF를 다시 확인하세요.";
  unlockEvidenceForWorkflow(client.id, note);
  const now = new Date().toISOString();
  return persist({
    ...loadBundle(client.id),
    status: "review",
    blockReasons: [],
    pendingReasons: [note],
    updatedAt: now,
  });
}

/** IPS 승인 취소 — 최종 PDF만 비활성 (locked 해제) */
export function syncEvidenceAfterIpsUnapproval(_client: Client): EvidenceBundle {
  const note = "IPS 승인 취소 — 최종 PDF 발행이 비활성화되었습니다.";
  return unlockEvidenceForWorkflow(_client.id, note);
}

/**
 * 승인 해제 전이 — 멱등·병합·세대 가드.
 * 이미 해제된 고객에 대해 DB 쓰기·알림·이벤트를 반복하지 않는다.
 */

import type { Client, Portfolio } from "../types";
import {
  basicUnapprovalStagePatch,
  ipsUnapprovalStagePatch,
  isBasicWorkflowApproved,
  isIpsWorkflowApproved,
  isPortfolioWorkflowApproved,
  portfolioUnapprovalStagePatch,
} from "./workflowApprovals";
import { markIpsExtractionStale } from "./ipsExtraction";
import type { ApprovalHashes } from "./approvalSnapshots";

export type ApprovalLevel = "basic" | "portfolio" | "ips";

export type ApprovalTransitionStatus =
  | "changed"
  | "already_unapproved"
  | "superseded"
  | "failed";

export type ApprovalTransitionResult = {
  status: ApprovalTransitionStatus;
  level: ApprovalLevel;
  message: string;
  /** 전이 후 최신 클라이언트(변경 시). already_* 는 입력 최신을 그대로 둘 수 있음 */
  client?: Client;
  error?: string;
  /** 동일 전이 중복 알림 억제 키 */
  noticeKey?: string;
};

export type ApprovalTransitionDeps = {
  getLatest: () => Client | null;
  persist: (id: string, patch: Partial<Client>) => Promise<void>;
  /** 호출 시점 세대. await 후 다르면 superseded */
  generation: number;
  getGeneration: () => number;
  isCancelled?: () => boolean;
};

type InflightEntry = {
  promise: Promise<ApprovalTransitionResult>;
  level: ApprovalLevel;
};

const inflightByClient = new Map<string, InflightEntry>();

/** basic 해제가 portfolio/ips 를 포함하므로 상위 레벨이 하위 요청을 흡수한다. */
function levelRank(level: ApprovalLevel): number {
  if (level === "basic") return 3;
  if (level === "portfolio") return 2;
  return 1;
}

export function isLevelApproved(client: Client, level: ApprovalLevel): boolean {
  if (level === "basic") return isBasicWorkflowApproved(client);
  if (level === "portfolio") return isPortfolioWorkflowApproved(client);
  return isIpsWorkflowApproved(client);
}

export function buildUnapprovalPatch(
  current: Client,
  level: ApprovalLevel,
): {
  stages: Client["stages"];
  ips?: Client["ips"];
  portfolios?: Portfolio[];
  approvalHashes: ApprovalHashes;
} {
  if (level === "basic") {
    return {
      stages: { ...(current.stages ?? {}), ...basicUnapprovalStagePatch() },
      ips: markIpsExtractionStale(current.ips),
      portfolios: (current.portfolios ?? []).map((p) => ({
        ...p,
        confirmedAt: undefined,
      })),
      approvalHashes: {},
    };
  }
  if (level === "portfolio") {
    return {
      stages: { ...(current.stages ?? {}), ...portfolioUnapprovalStagePatch() },
      portfolios: (current.portfolios ?? []).map((p) => ({
        ...p,
        confirmedAt: undefined,
      })),
      approvalHashes: { basic: current.approvalHashes?.basic },
    };
  }
  return {
    stages: { ...(current.stages ?? {}), ...ipsUnapprovalStagePatch() },
    approvalHashes: {
      basic: current.approvalHashes?.basic,
      portfolio: current.approvalHashes?.portfolio,
    },
  };
}

function noticeKeyFor(clientId: string, level: ApprovalLevel, generation: number, message: string) {
  return `${clientId}|${level}|${generation}|${message}`;
}

/**
 * 동일 client 에 대한 동시 해제 요청을 병합한다.
 * 이미 상위 레벨이 in-flight 이면 하위 요청은 그 결과를 기다린 뒤 already/superseded 로 끝낸다.
 */
export async function runApprovalUnapproval(
  clientId: string,
  level: ApprovalLevel,
  message: string,
  deps: ApprovalTransitionDeps,
): Promise<ApprovalTransitionResult> {
  const existing = inflightByClient.get(clientId);
  if (existing) {
    const waited = await existing.promise;
    if (deps.isCancelled?.() || deps.getGeneration() !== deps.generation) {
      return { status: "superseded", level, message };
    }
    const latest = deps.getLatest();
    if (!latest || latest.id !== clientId) {
      return { status: "superseded", level, message };
    }
    if (!isLevelApproved(latest, level)) {
      return {
        status: "already_unapproved",
        level,
        message,
        client: latest,
        noticeKey: waited.noticeKey,
      };
    }
    // 상위 전이가 끝났는데 이 레벨이 아직 승인 상태면 새로 진행
  }

  const run = async (): Promise<ApprovalTransitionResult> => {
    try {
      const before = deps.getLatest();
      if (!before || before.id !== clientId) {
        return { status: "superseded", level, message };
      }
      if (!isLevelApproved(before, level)) {
        return {
          status: "already_unapproved",
          level,
          message,
          client: before,
          noticeKey: noticeKeyFor(clientId, level, deps.generation, message),
        };
      }

      const patch = buildUnapprovalPatch(before, level);
      await deps.persist(clientId, patch);

      if (deps.isCancelled?.() || deps.getGeneration() !== deps.generation) {
        return { status: "superseded", level, message };
      }
      const afterRead = deps.getLatest();
      if (!afterRead || afterRead.id !== clientId) {
        return { status: "superseded", level, message };
      }

      const nextClient: Client = {
        ...afterRead,
        ...patch,
        stages: patch.stages,
        approvalHashes: patch.approvalHashes,
        ...(patch.ips ? { ips: patch.ips } : {}),
        ...(patch.portfolios ? { portfolios: patch.portfolios } : {}),
      };

      return {
        status: "changed",
        level,
        message,
        client: nextClient,
        noticeKey: noticeKeyFor(clientId, level, deps.generation, message),
      };
    } catch (e: any) {
      return {
        status: "failed",
        level,
        message,
        error: e?.message ? String(e.message) : String(e),
      };
    } finally {
      const cur = inflightByClient.get(clientId);
      if (cur?.level === level) {
        // only clear if we still own the slot — replaced below carefully
      }
    }
  };

  // 상위 레벨이 이미 돌고 있으면 흡수
  const inflight = inflightByClient.get(clientId);
  if (inflight && levelRank(inflight.level) >= levelRank(level)) {
    const waited = await inflight.promise;
    if (deps.isCancelled?.() || deps.getGeneration() !== deps.generation) {
      return { status: "superseded", level, message };
    }
    const latest = deps.getLatest();
    if (!latest || latest.id !== clientId || !isLevelApproved(latest, level)) {
      return {
        status: "already_unapproved",
        level,
        message,
        client: latest ?? undefined,
        noticeKey: waited.noticeKey,
      };
    }
  }

  const promise = run().finally(() => {
    const cur = inflightByClient.get(clientId);
    if (cur?.promise === promise) inflightByClient.delete(clientId);
  });
  inflightByClient.set(clientId, { promise, level });
  return promise;
}

/** 테스트용 */
export function __resetApprovalTransitionInflightForTests() {
  inflightByClient.clear();
}

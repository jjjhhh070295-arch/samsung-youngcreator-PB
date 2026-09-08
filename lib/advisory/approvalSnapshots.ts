/**
 * 승인 스냅샷 해시 — 승인 시점 입력과 현재 입력을 비교해 스테일 승인을 해제한다.
 */

import type { Client, IPS, Portfolio } from "../types";
import { stableJsonStringify } from "./stableJson";
import { loadManualPortfolioDraft, type ManualPortfolioDraft } from "../manualPortfolioDraft";
import {
  basicUnapprovalStagePatch,
  portfolioUnapprovalStagePatch,
  ipsUnapprovalStagePatch,
  isBasicWorkflowApproved,
  isPortfolioWorkflowApproved,
  isIpsWorkflowApproved,
} from "./workflowApprovals";

export type ApprovalHashes = {
  basic?: string;
  portfolio?: string;
  ips?: string;
};

export const MSG_BASIC_STALE =
  "고객 정보가 수정되어 기본정보 승인이 해제되었습니다. 다시 승인해주세요.";
export const MSG_PORTFOLIO_STALE =
  "포트폴리오가 수정되어 포트폴리오 승인이 해제되었습니다. 다시 승인해주세요.";
export const MSG_IPS_STALE = "IPS 내용이 변경되어 IPS 승인이 해제되었습니다.";

// 이 자리에 assetRevision(localStorage 카운터)이 있었다. 보유종목·부동산은 parties 가
// 아니라 client_holdings / client_real_estate 에 있어서, 기본정보 해시가 parties 한 행만
// 보는 한 자산 변경을 못 잡는다 — 그 공백을 메우려고 "변경이 있었다"는 사실만 숫자로
// 넣었던 값이다.
//
// 그런데 그 카운터가 localStorage 에 있어서 기기마다 달랐다. 기기 A 에서 자산을 고치고
// 재승인하면 해시에 rev=1 이 박히는데, 기기 B 에서는 같은 키가 "0" 이라 해시가 어긋난다.
// 그러면 로드 직후 detectApprovalInvalidation 이 스테일로 판정하고 applyInvalidation 이
// 승인을 해제해 DB 에 기록한다 — 자산을 전혀 건드리지 않아도 기기만 바꾸면 basic 이
// 풀리고 portfolio·stress·ips 까지 연쇄로 해제되며, portfolios[].confirmedAt 도 지워진다.
// 조용한 오판정이 아니라 공유 데이터를 망가뜨리는 쪽이라 걷어낸다.
//
// 자산 변경 감지 자체는 그대로 살아 있다. HoldingsExtractor·RealEstateModule 이
// onAssetsChanged 로 onBasicAssetsChanged 를 부르고, 거기서 invalidateAfterEdit(_, "basic")
// 이 해시 비교를 거치지 않고 곧바로 승인을 해제한다 — 실제 무효화는 처음부터 이쪽이 했다.
// 잃는 것은 "다른 기기에서 자산을 고쳤을 때 이쪽 승인이 나중에 스테일로 잡히는" 경우인데,
// 그건 지금까지도 제대로 동작한 적이 없다(오판정만 냈다).
//
// 제대로 하려면 카운터가 아니라 자산 실측값(client_holdings/client_real_estate 집계)을
// payload 에 넣어야 한다. 다만 그러면 해시 계산이 async 가 되어 computeBasicApprovalHash
// 호출부 전체가 바뀐다 — 승인 로직이 안정된 뒤 별건으로 다룬다.

function djb2Hex(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

export function hashApprovalPayload(value: unknown): string {
  return djb2Hex(stableJsonStringify(value));
}

export function buildBasicApprovalPayload(client: Client) {
  return {
    code: client.code,
    name: client.name,
    clientType: client.clientType,
    birthDate: client.birthDate,
    assetSize: client.assetSize,
    linkedClientId: client.linkedClientId ?? null,
    ownershipPct: client.ownershipPct ?? null,
    isMajorityShareholder: client.isMajorityShareholder ?? null,
    accountSeparation: client.accountSeparation ?? null,
    ips: simplifyIps(client.ips),
    cashFlows: client.cashFlows ?? [],
    cashflowPeriodType: client.cashflowPeriodType ?? null,
    financialIncomeComprehensiveTax: !!client.financialIncomeComprehensiveTax,
    financialIncomeProfile: client.financialIncomeProfile ?? null,
  };
}

export function buildPortfolioApprovalPayload(
  client: Client,
  draft: ManualPortfolioDraft | null = loadManualPortfolioDraft(client.id),
) {
  return {
    draftAllocation: draft?.allocation ?? null,
    draftFinalAllocation: draft?.finalAllocation ?? null,
    draftSelected: (draft?.selected ?? [])
      .map((s) => ({
        symbol: s.symbol,
        name: s.name,
        assetClass: s.assetClass,
        weightWithinClass: s.weightWithinClass,
        designatedPrice: s.designatedPrice ?? null,
        plannedQuantity: s.plannedQuantity ?? null,
        currency: s.currency ?? null,
        fxRate: s.fxRate ?? null,
        faceValue: s.faceValue ?? null,
      }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    portfolios: (client.portfolios ?? []).map(simplifyPortfolio),
  };
}

export function buildIpsApprovalPayload(client: Client) {
  return {
    ips: simplifyIps(client.ips),
    portfolio: client.portfolios?.[0] ? simplifyPortfolio(client.portfolios[0]) : null,
  };
}

function simplifyIps(ips: IPS) {
  return {
    return: ips.return?.value ?? "",
    risk: ips.risk?.value ?? "",
    timeHorizon: ips.timeHorizon?.value ?? "",
    tax: ips.tax?.value ?? "",
    liquidity: ips.liquidity?.value ?? "",
    legal: ips.legal?.value ?? "",
    unique: ips.unique?.value ?? "",
    notes: {
      return: ips.return?.notes ?? "",
      risk: ips.risk?.notes ?? "",
      timeHorizon: ips.timeHorizon?.notes ?? "",
      tax: ips.tax?.notes ?? "",
      liquidity: ips.liquidity?.notes ?? "",
      legal: ips.legal?.notes ?? "",
      unique: ips.unique?.notes ?? "",
    },
  };
}

function simplifyPortfolio(p: Portfolio) {
  return {
    id: p.id,
    label: p.label,
    allocations: (p.allocations ?? []).map((a) => ({
      assetClass: a.assetClass,
      weight: a.weight,
    })),
    expectedReturn: p.expectedReturn,
    expectedRisk: p.expectedRisk,
    confirmedAt: p.confirmedAt ?? null,
  };
}

export function computeBasicApprovalHash(client: Client): string {
  return hashApprovalPayload(buildBasicApprovalPayload(client));
}

export function computePortfolioApprovalHash(
  client: Client,
  draft?: ManualPortfolioDraft | null,
): string {
  return hashApprovalPayload(buildPortfolioApprovalPayload(client, draft));
}

export function computeIpsApprovalHash(client: Client): string {
  return hashApprovalPayload(buildIpsApprovalPayload(client));
}

export type ApprovalInvalidation =
  | { level: "basic"; message: typeof MSG_BASIC_STALE; stages: ReturnType<typeof basicUnapprovalStagePatch>; hashes: ApprovalHashes }
  | { level: "portfolio"; message: typeof MSG_PORTFOLIO_STALE; stages: ReturnType<typeof portfolioUnapprovalStagePatch>; hashes: ApprovalHashes }
  | { level: "ips"; message: typeof MSG_IPS_STALE; stages: ReturnType<typeof ipsUnapprovalStagePatch>; hashes: ApprovalHashes }
  | null;

/**
 * 저장된 승인 해시와 현재 입력을 비교.
 * 가장 상위(기본정보) 스테일부터 반환한다.
 */
export function detectApprovalInvalidation(client: Client): ApprovalInvalidation {
  const hashes = client.approvalHashes ?? {};

  if (isBasicWorkflowApproved(client)) {
    if (!hashes.basic || hashes.basic !== computeBasicApprovalHash(client)) {
      return {
        level: "basic",
        message: MSG_BASIC_STALE,
        stages: basicUnapprovalStagePatch(),
        hashes: {},
      };
    }
  }

  if (isPortfolioWorkflowApproved(client)) {
    if (!hashes.portfolio || hashes.portfolio !== computePortfolioApprovalHash(client)) {
      return {
        level: "portfolio",
        message: MSG_PORTFOLIO_STALE,
        stages: portfolioUnapprovalStagePatch(),
        hashes: { basic: hashes.basic },
      };
    }
  }

  if (isIpsWorkflowApproved(client)) {
    if (!hashes.ips || hashes.ips !== computeIpsApprovalHash(client)) {
      return {
        level: "ips",
        message: MSG_IPS_STALE,
        stages: ipsUnapprovalStagePatch(),
        hashes: { basic: hashes.basic, portfolio: hashes.portfolio },
      };
    }
  }

  return null;
}

/** stages JSON(b)에 심는 승인 해시 — DB 마이그레이션 없이 재사용 */
export const APPROVAL_HASHES_KEY = "__approvalHashes";

export function splitStagesPayload(raw: unknown): {
  stages: Client["stages"];
  approvalHashes: ApprovalHashes;
} {
  if (!raw || typeof raw !== "object") {
    return { stages: {}, approvalHashes: {} };
  }
  const record = raw as Record<string, unknown>;
  const hashesRaw = record[APPROVAL_HASHES_KEY];
  const approvalHashes: ApprovalHashes =
    hashesRaw && typeof hashesRaw === "object" && !Array.isArray(hashesRaw)
      ? {
          basic: typeof (hashesRaw as ApprovalHashes).basic === "string" ? (hashesRaw as ApprovalHashes).basic : undefined,
          portfolio:
            typeof (hashesRaw as ApprovalHashes).portfolio === "string"
              ? (hashesRaw as ApprovalHashes).portfolio
              : undefined,
          ips: typeof (hashesRaw as ApprovalHashes).ips === "string" ? (hashesRaw as ApprovalHashes).ips : undefined,
        }
      : {};

  const stages: Client["stages"] = {};
  for (const key of ["basic", "factors", "cashflow", "portfolio", "stress", "ips"] as const) {
    if (typeof record[key] === "boolean") stages[key] = record[key] as boolean;
  }
  return { stages, approvalHashes };
}

export function mergeStagesPayload(
  stages: Client["stages"] | undefined,
  approvalHashes: ApprovalHashes | undefined,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...(stages ?? {}) };
  if (approvalHashes !== undefined) {
    payload[APPROVAL_HASHES_KEY] = approvalHashes;
  }
  return payload;
}

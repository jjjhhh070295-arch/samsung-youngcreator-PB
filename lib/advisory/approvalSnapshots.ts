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

const ASSET_REV_KEY = (clientId: string) => `pb-basic-asset-rev-v1-${clientId}`;

export function getBasicAssetRevision(clientId: string): string {
  if (typeof window === "undefined") return "0";
  try {
    return window.localStorage.getItem(ASSET_REV_KEY(clientId)) || "0";
  } catch {
    return "0";
  }
}

/** 보유종목·부동산 등 기본정보 자산이 바뀌면 호출 */
export function bumpBasicAssetRevision(clientId: string): string {
  if (typeof window === "undefined") return "0";
  const next = String((Number(getBasicAssetRevision(clientId)) || 0) + 1);
  try {
    window.localStorage.setItem(ASSET_REV_KEY(clientId), next);
  } catch {
    /* ignore */
  }
  return next;
}

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

export function buildBasicApprovalPayload(
  client: Client,
  assetRevision = getBasicAssetRevision(client.id),
) {
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
    assetRevision,
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

export function computeBasicApprovalHash(client: Client, assetRevision?: string): string {
  return hashApprovalPayload(buildBasicApprovalPayload(client, assetRevision));
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

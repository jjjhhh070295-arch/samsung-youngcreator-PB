"use client";

/**
 * 고객 대면 화면 — PB 탭용 데이터 래퍼.
 *
 * 화면을 그리는 일은 ClientFacingViewBody 가 한다. 이 파일에 남는 것은 "데이터를
 * 어디서 가져오는가"뿐이다 — useLiveClient 로 조회하고 라이브 동기화를 받아 그 결과를
 * ClientViewPayload 로 옮겨 넘긴다. 공유 링크(/view/[token])는 같은 payload 를 서버가
 * service_role 로 만들어 Body 에 바로 넘긴다. 화면 코드는 그래서 한 벌이다.
 *
 * 나누기 전에는 이 컴포넌트가 조회와 렌더를 함께 했다. 그러면 공유 링크 페이지가
 * 화면을 그리려고 lib/store → lib/supabase 까지 끌고 들어가고, anon 키가 그 번들에
 * 실린다. 나눈 이유의 절반이 그것이다.
 *
 * 라이브 동기화(useLiveClient·clientLiveSync)는 그대로다 — 옮기지도 고치지도 않았다.
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Client } from "@/lib/types";
import { useLiveClient } from "@/hooks/useLiveClient";
import { buildCustomerViewSummary } from "@/lib/customerViewSummary";
import {
  isBasicWorkflowApproved,
  isIpsWorkflowApproved,
  isPortfolioWorkflowApproved,
} from "@/lib/advisory/workflowApprovals";
import type { ManualPortfolioDraft } from "@/lib/manualPortfolioDraft";
import {
  CLIENT_VIEW_PAYLOAD_VERSION,
  type ClientViewPayload,
} from "@/lib/clientView/types";
import ClientFacingViewBody from "@/components/ClientFacingViewBody";

interface Props {
  /** 임베드 시 부모가 가진 최신 Client (즉시 반영) */
  client?: Client | null;
  clientId?: string;
  pbId?: string | null;
  embedded?: boolean;
  investableWon?: number | null;
  /** 부모가 이미 로드한 초안(없으면 훅이 조회) */
  draft?: ManualPortfolioDraft | null;
  /** false 이면 외부 공유용 — 포트폴리오 미승인 시 잠금 유지 */
  allowPreviewWithoutPortfolioApproval?: boolean;
}

export default function ClientFacingView({
  client: seedClient = null,
  clientId: clientIdProp,
  pbId = null,
  embedded = false,
  investableWon: seedInvestable = null,
  draft: seedDraft = null,
  allowPreviewWithoutPortfolioApproval,
}: Props) {
  const router = useRouter();
  const clientId = clientIdProp ?? seedClient?.id ?? "";
  const resolvedPbId = pbId ?? seedClient?.assignedPbId ?? null;
  const allowPreview = allowPreviewWithoutPortfolioApproval ?? embedded;

  const live = useLiveClient(clientId, {
    pbId: resolvedPbId,
    initialClient: seedClient,
    initialInvestableWon: seedInvestable,
    enablePolling: true,
    pollMs: 15_000,
  });

  const client = live.client ?? seedClient;
  const investableWon = live.investableWon ?? seedInvestable;
  const draft = live.draft ?? seedDraft;

  // 서버 라우트가 만드는 것과 같은 모양으로 맞춘다. 차이는 출처뿐이다 —
  // 여기서는 초안(draft)까지 넘긴다. PB 는 미승인 제안을 봐야 하기 때문이다.
  const view = useMemo<ClientViewPayload | null>(() => {
    if (!client) return null;
    const summary = buildCustomerViewSummary({ client, investableWon, draft });
    const taxNote = client.portfolios?.[0]?.taxNote?.trim() || null;
    const comprehensive = client.financialIncomeComprehensiveTax ?? null;
    return {
      v: CLIENT_VIEW_PAYLOAD_VERSION,
      // PB 탭에는 만료 개념이 없다. Body 는 live 가 있으면 이 값을 쓰지 않는다.
      expiresAt: "",
      profile: {
        code: client.code,
        name: client.name,
        clientType: client.clientType,
        birthDate: client.birthDate,
      },
      gates: {
        basicReady: isBasicWorkflowApproved(client),
        portfolioReady: isPortfolioWorkflowApproved(client),
        ipsReady: isIpsWorkflowApproved(client),
        factorsApproved: !!client.stages?.factors,
      },
      investableWon: investableWon ?? client.assetSize,
      ips: client.ips,
      cashFlows: client.cashFlows ?? [],
      tax: taxNote || comprehensive != null ? { comprehensive, note: taxNote } : null,
      summary,
    };
  }, [client, investableWon, draft]);

  if (!clientId) {
    return (
      <div className="rounded-lg border border-border bg-white p-8 text-center text-sm text-fg-muted">
        고객을 선택해 주세요.
      </div>
    );
  }

  if ((live.status === "loading" || live.status === "switching") && !client) {
    return (
      <div className="rounded-lg border border-border bg-white p-8 text-center text-sm text-fg-muted">
        고객 정보를 불러오는 중…
      </div>
    );
  }

  if ((live.status === "error" || !client) && !seedClient) {
    return (
      <div className="rounded-lg border border-red-200 bg-white p-8 text-center">
        <p className="text-sm font-semibold text-red-700">
          {live.errorMessage || "고객 정보를 불러올 수 없습니다."}
        </p>
        <button type="button" className="btn-outline mt-3 text-sm" onClick={() => void live.reload()}>
          다시 시도
        </button>
      </div>
    );
  }

  if (!client || !view) return null;

  return (
    <ClientFacingViewBody
      view={view}
      live={{
        refreshing: live.refreshing,
        syncHint: live.syncHint,
        onReload: () => void live.reload(),
      }}
      onGoPb={
        embedded
          ? undefined
          : () =>
              router.push(
                client.assignedPbId ? `/pb/${client.assignedPbId}/${client.id}` : `/`,
              )
      }
      lockWithoutPortfolioApproval={!allowPreview}
    />
  );
}

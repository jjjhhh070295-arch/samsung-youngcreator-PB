"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ACCOUNT_SEPARATION_LABEL, CLIENT_TYPE_LABEL } from "@/lib/types";
import type { Client, Consultation, CashFlow, IPS, PB, Portfolio, StageKey, Stages, FinancialIncomeProfile } from "@/lib/types";
import type { CashflowPeriodType } from "@/lib/cashflowPeriod";
import {
  getClient,
  getPortfolioDraft,
  listClients,
  listConsultations,
  listPbs,
  updateClient,
  deleteClient,
  saveInvestmentSurvey,
} from "@/lib/store";
import {
  basicApprovalStagePatch,
  ipsApprovalStagePatch,
  ipsUnapprovalStagePatch,
  isBasicWorkflowApproved,
  isIpsWorkflowApproved,
  isPortfolioWorkflowApproved,
  MSG_BASIC_APPROVED,
  MSG_BASIC_UNAPPROVED,
  MSG_IPS_APPROVED,
  MSG_IPS_UNAPPROVED,
  MSG_PORTFOLIO_APPROVED,
  MSG_PORTFOLIO_UNAPPROVED,
  portfolioApprovalStagePatch,
  validateBasicWorkflowApproval,
  validateIpsWorkflowApproval,
  validatePortfolioWorkflowApproval,
} from "@/lib/advisory/workflowApprovals";
import {
  extractIpsFromClientProfile,
  ipsExtractionMissingReasons,
} from "@/lib/advisory/ipsExtraction";
import {
  syncEvidenceAfterBasicApproval,
  syncEvidenceAfterBasicUnapproval,
  syncEvidenceAfterIpsApproval,
  syncEvidenceAfterIpsUnapproval,
  syncEvidenceAfterPortfolioApproval,
  syncEvidenceAfterPortfolioUnapproval,
} from "@/lib/advisory/workflowEvidenceSync";
import {
  computeBasicApprovalHash,
  computeIpsApprovalHash,
  computePortfolioApprovalHash,
  detectApprovalInvalidation,
  MSG_BASIC_STALE,
  MSG_PORTFOLIO_STALE,
} from "@/lib/advisory/approvalSnapshots";
import {
  isLevelApproved,
  runApprovalUnapproval,
  type ApprovalLevel,
} from "@/lib/advisory/approvalTransition";
import { loadBundle } from "@/lib/advisory/control";
import { applyIpsHoldingsSync } from "@/lib/advisory/ipsHoldingsSync";
import { requiresMarketQuote, type PriceSnapshot } from "@/lib/advisory/ipsPurchasePlan";
import { findQuoteBySymbol } from "@/lib/pricing/instrumentIdentity";
import type { PriceQuote } from "@/lib/pricing/types";
import {
  buildApprovedPortfolio,
  draftMatchesApprovedInstruments,
  isLegacyIncompletePortfolio,
  recoverInstrumentsFromMatchingDraft,
  stampApprovedInstrumentsWithQuotes,
} from "@/lib/advisory/approvedPortfolioComposition";
import { decimalReturnToPctPoints } from "@/lib/returnAssumptions";
import { formatKRW, formatDate, formatDateTime } from "@/lib/format";
import ConsultationModal from "@/components/ConsultationModal";
import ClientForm, { type ClientFormValue } from "@/components/ClientForm";
import ConfirmModal from "@/components/ConfirmModal";
import IPSResultTabs, { type Tab } from "@/components/IPSResultTabs";
import ClientFacingView from "@/components/ClientFacingView";
import ClientViewLinkPanel from "@/components/ClientViewLinkPanel";
import TrendChart from "@/components/TrendChart";
import ConsultationHistory from "@/components/ConsultationHistory";
import { LoadingView, ErrorView } from "@/components/StateViews";
import HoldingsExtractor from "@/components/HoldingsExtractor";
import RealEstateModule from "@/components/RealEstateModule";
import DepositProductsSection from "@/components/DepositProductsSection";
import AssetAllocationBar from "@/components/AssetAllocationBar";
import FinancialIncomeTaxSection from "@/components/FinancialIncomeTaxSection";
import ClientAvatar from "@/components/ClientAvatar";
import FactorsSummary from "@/components/FactorsSummary";
import SimpleCashflowPanel from "@/components/SimpleCashflowPanel";
import type { InvestmentSurveyResult } from "@/lib/investmentSurvey";
import { resolveAssetBreakdown } from "@/lib/assets";
import { publishClientLiveSync } from "@/lib/clientLiveSync";

const MSG_NEED_BASIC = "기본정보 승인 후 포트폴리오를 진행할 수 있습니다.";
const MSG_NEED_PORTFOLIO = "포트폴리오 승인 후 IPS를 확정할 수 있습니다.";

export default function ClientDetailPage() {
  const { pbId, clientId } = useParams<{ pbId: string; clientId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeView = searchParams?.get("view") ?? "home";
  const activeTab: Tab =
    (
      [
        "basic",
        "cashflow",
        "portfolio",
        "portfolio2",
        "taxProjection",
        "stress",
        "ips",
        "customer",
      ] as const
    ).find((t) => t === searchParams?.get("tab")) ?? "portfolio2";

  const [client, setClient] = useState<Client | null>(null);
  const clientRef = useRef<Client | null>(null);
  clientRef.current = client;
  const opGenerationRef = useRef(0);
  const shownNoticeKeysRef = useRef<Set<string>>(new Set());
  const [approvalNotice, setApprovalNotice] = useState<{
    key: string;
    message: string;
    error?: boolean;
  } | null>(null);
  const [depositInterestSnapshot, setDepositInterestSnapshot] =
    useState<import("@/lib/financialIncomeBreakdown").DepositInterestSnapshot | null>(null);

  useEffect(() => {
    opGenerationRef.current += 1;
    shownNoticeKeysRef.current.clear();
    setApprovalNotice(null);
    setDepositInterestSnapshot(null);
  }, [clientId]);

  const showApprovalNotice = useCallback((key: string | undefined, message: string, error = false) => {
    if (!key) return;
    if (shownNoticeKeysRef.current.has(key)) return;
    shownNoticeKeysRef.current.add(key);
    setApprovalNotice({ key, message, error });
  }, []);

  const [allClients, setAllClients] = useState<Client[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [pbs, setPbs] = useState<PB[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [modalOpen, setModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [investableWon, setInvestableWon] = useState<number | null>(null);
  // 총자산 = AUM + 부동산. 헤더에서 AUM 옆에 괄호로 보여 준다 — 예전에는 이 자리에도
  // client.assetSize 를 써서 새 모델에서 AUM 과 같은 숫자가 두 번 찍혔다.
  const [totalAssetWon, setTotalAssetWon] = useState<number | null>(null);
  // 보유종목·부동산이 바뀌면 올려서 상단 자산 비중 바를 다시 읽게 한다.
  const [assetRefreshKey, setAssetRefreshKey] = useState(0);
  const bumpAssetRefresh = useCallback(() => setAssetRefreshKey((k) => k + 1), []);
  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const [c, cons, allPbs, clients] = await Promise.all([
        getClient(clientId),
        listConsultations(clientId),
        listPbs(),
        listClients(),
      ]);
      if (!c) { setStatus("error"); return; }
      setClient(c);
      setAllClients(clients);
      setConsultations(cons);
      setPbs(allPbs);
      setStatus("ready");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  // 승인 상태를 이 페이지가 직접 구독한다. 예전에는 각 핸들러의 setClient 로만 갱신돼서,
  // 다른 화면·컴포넌트가 고객을 바꾸면 여기 client 가 낡은 채로 남았다.
  // load() 를 그대로 쓰지 않는 이유: status 가 loading 으로 떨어져 화면 전체가 깜빡인다.
  // 이 이벤트로 바뀌는 건 고객 본체뿐이라 상담 이력·PB 목록은 다시 읽지 않는다.
  const refreshClientQuietly = useCallback(async () => {
    if (!clientId) return;
    try {
      const c = await getClient(clientId);
      if (c) setClient(c);
    } catch {
      // 조용한 갱신이라 실패는 삼킨다 — 다음 이벤트나 수동 새로고침에서 복구된다.
    }
  }, [clientId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onUpdated = () => { void refreshClientQuietly(); };
    window.addEventListener("pb-client-updated", onUpdated);
    return () => window.removeEventListener("pb-client-updated", onUpdated);
  }, [refreshClientQuietly]);

  // AUM(=investableKrw)과 총자산(=totalKrw = AUM + 부동산)을 한 번에 받는다.
  // 조회 실패 시 둘 다 null 로 두고 표시 쪽에서 assetSize 로 폴백한다.
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    resolveAssetBreakdown(clientId)
      .then((b) => {
        if (cancelled) return;
        setInvestableWon(b?.investableKrw ?? null);
        setTotalAssetWon(b?.totalKrw ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientId, assetRefreshKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash) return;
    const el = document.getElementById(hash.replace("#", ""));
    if (el) el.scrollIntoView({ behavior: "smooth" });
  }, [activeView]);

  // 예전 딥링크 → 통합 경로
  useEffect(() => {
    const tab = searchParams?.get("tab");
    if (activeView !== "analysis") return;
    if (tab === "factors" || tab === "cashflow") {
      router.replace(`/pb/${pbId}/${clientId}?view=home${tab === "cashflow" ? "#cashflow" : ""}`);
      return;
    }
    if (tab === "portfolio" || tab === "taxProjection" || tab === "stress") {
      router.replace(`/pb/${pbId}/${clientId}?view=analysis&tab=portfolio2${tab === "taxProjection" ? "#tax-projection" : ""}`);
    }
  }, [activeView, searchParams, router, pbId, clientId]);

  // URL/쿼리로 후속 탭을 직접 열면 승인 게이트로 되돌린다.
  const gateToastKey = useRef("");
  const skipGateToast = useRef(false);
  useEffect(() => {
    if (status !== "ready" || !client) return;
    if (activeView !== "analysis") return;

    const warn = (msg: string, key: string) => {
      if (skipGateToast.current) {
        skipGateToast.current = false;
        return;
      }
      if (gateToastKey.current === key) return;
      gateToastKey.current = key;
      showApprovalNotice(key, msg);
    };

    // customer 는 이 목록에서 뺀다. 승인 전에도 진입은 되게 한다 — 회의 시작과 동시에
    // 고객 화면을 띄우는 동선이 승인 대기에 막히지 않도록 한다. 승인된 내용이 없으면
    // 화면이 비어 보일 뿐이고, 아래 IPS 게이트와 외부 공유 라우트는 그대로 둔다.
    if ((activeTab === "portfolio2" || activeTab === "ips") && !isBasicWorkflowApproved(client)) {
      warn(MSG_NEED_BASIC, `${client.id}:need-basic`);
      router.replace(`/pb/${pbId}/${clientId}?view=home`);
      return;
    }
    // IPS 는 포트폴리오 승인 필수. 고객화면은 기본정보만 있으면 현재 상담본을 보여 주고,
    // 미승인·스테일 시 「변경사항 검토 필요」로 표시한다(라이브 미리보기).
    if (activeTab === "ips" && !isPortfolioWorkflowApproved(client)) {
      warn(MSG_NEED_PORTFOLIO, `${client.id}:need-portfolio`);
      router.replace(`/pb/${pbId}/${clientId}?view=analysis&tab=portfolio2`);
    }
  }, [status, client, activeView, activeTab, router, pbId, clientId, showApprovalNotice]);

  // 이미 IPS까지 승인됐는데 Evidence가 오래된 blocked면 복구(PDF 게이트)
  useEffect(() => {
    if (!client || typeof window === "undefined") return;
    if (!isIpsWorkflowApproved(client)) return;
    const bundle = loadBundle(client.id);
    if (bundle.status === "blocked" || bundle.status !== "locked") {
      syncEvidenceAfterIpsApproval(client);
    }
  }, [client]);

  const handleSetTab = (t: Tab) => {
    if ((t === "portfolio2" || t === "portfolio" || t === "taxProjection" || t === "stress") && client && !isBasicWorkflowApproved(client)) {
      alert(MSG_NEED_BASIC);
      return;
    }
    // customer 는 게이트하지 않는다 — AppNav 의 같은 결정과 짝이다.
    if (t === "ips" && client && !isPortfolioWorkflowApproved(client)) {
      alert(MSG_NEED_PORTFOLIO);
      return;
    }
    router.push(`/pb/${pbId}/${clientId}?view=analysis&tab=${t}`, { scroll: false });
  };

  const notifyClientUpdated = (reason: "save" | "holdings" | "draft" | "approval" | "assets" = "save") => {
    if (typeof window === "undefined") return;
    publishClientLiveSync(clientId, reason, "pb-detail");
  };

  const applyInvalidation = useCallback(async (
    level: "basic" | "portfolio" | "ips",
    message: string,
  ) => {
    const generation = opGenerationRef.current;
    const targetId = clientId;
    const result = await runApprovalUnapproval(targetId, level, message, {
      generation,
      getGeneration: () => opGenerationRef.current,
      getLatest: () => clientRef.current,
      persist: (id, patch) => updateClient(id, patch),
      isCancelled: () => clientRef.current?.id !== targetId,
    });

    if (result.status === "superseded" || result.status === "already_unapproved") {
      return result;
    }
    if (result.status === "failed") {
      showApprovalNotice(
        `${targetId}|${level}|fail|${generation}`,
        `승인 해제 저장에 실패했습니다. ${result.error || "다시 시도해 주세요."}`,
        true,
      );
      return result;
    }

    const nextClient = result.client;
    if (!nextClient || clientRef.current?.id !== targetId) return result;
    clientRef.current = nextClient;
    setClient(nextClient);
    if (level === "basic") syncEvidenceAfterBasicUnapproval(nextClient);
    else if (level === "portfolio") syncEvidenceAfterPortfolioUnapproval(nextClient);
    else syncEvidenceAfterIpsUnapproval(nextClient);
    notifyClientUpdated("approval");
    skipGateToast.current = true;
    gateToastKey.current = "";
    if (level === "basic" && activeView === "analysis") {
      router.replace(`/pb/${pbId}/${clientId}?view=home`);
    } else if (level === "portfolio" && activeView === "analysis" && activeTab === "ips") {
      router.replace(`/pb/${pbId}/${clientId}?view=analysis&tab=portfolio2`);
    }
    showApprovalNotice(result.noticeKey, message);
    return result;
  }, [activeTab, activeView, clientId, pbId, router, showApprovalNotice]);

  /** 승인 후 입력 변경 시 스테일 승인 해제 — 항상 clientRef 최신 상태 기준 */
  const invalidateAfterEdit = useCallback(async (
    nextPartial: Partial<Client>,
    prefer: "basic" | "portfolio" | "auto" = "auto",
  ) => {
    const latest = clientRef.current;
    if (!latest) return;
    const probe: Client = { ...latest, ...nextPartial };
    clientRef.current = probe;
    setClient(probe);

    let level: ApprovalLevel | null = null;
    let message = MSG_BASIC_STALE;
    if (prefer === "basic" && isLevelApproved(probe, "basic")) {
      level = "basic";
      message = MSG_BASIC_STALE;
    } else if (prefer === "portfolio" && isLevelApproved(probe, "portfolio")) {
      level = "portfolio";
      message = MSG_PORTFOLIO_STALE;
    } else if (prefer === "auto") {
      const hit = detectApprovalInvalidation(probe);
      if (!hit) return;
      level = hit.level;
      message = hit.message;
    } else {
      return;
    }
    await applyInvalidation(level, message);
  }, [applyInvalidation]);

  // 새로고침 후 스테일 승인 정리 (+ 해시 없는 기존 승인 마이그레이션)
  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    const generation = opGenerationRef.current;
    const targetId = clientId;
    void (async () => {
      const hydration = await getPortfolioDraft(pbId, targetId);
      if (cancelled || opGenerationRef.current !== generation) return;
      if (hydration.dbReadFailed) return;

      const latest = clientRef.current;
      if (!latest || latest.id !== targetId) return;

      const hashes = { ...(latest.approvalHashes ?? {}) };
      let stamped = false;
      if (isBasicWorkflowApproved(latest) && !hashes.basic) {
        hashes.basic = computeBasicApprovalHash(latest);
        stamped = true;
      }
      if (isPortfolioWorkflowApproved(latest) && !hashes.portfolio) {
        hashes.portfolio = computePortfolioApprovalHash(latest);
        stamped = true;
      }
      if (isIpsWorkflowApproved(latest) && !hashes.ips) {
        hashes.ips = computeIpsApprovalHash(latest);
        stamped = true;
      }
      if (stamped) {
        await updateClient(latest.id, { stages: latest.stages, approvalHashes: hashes });
        if (cancelled || opGenerationRef.current !== generation) return;
        const after = clientRef.current;
        if (!after || after.id !== targetId) return;
        const next = { ...after, approvalHashes: hashes };
        clientRef.current = next;
        setClient(next);
        return;
      }

      const hit = detectApprovalInvalidation(latest);
      if (!hit || cancelled || opGenerationRef.current !== generation) return;
      await applyInvalidation(hit.level, hit.message);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, clientId, pbId, applyInvalidation]);

  const saveCashFlows = async (flows: CashFlow[], periodType?: CashflowPeriodType) => {
    if (!client) return;
    const patch: Partial<Client> = { cashFlows: flows };
    if (periodType) patch.cashflowPeriodType = periodType;
    await updateClient(client.id, patch);
    const next = { ...client, cashFlows: flows, ...(periodType ? { cashflowPeriodType: periodType } : {}) };
    setClient(next);
    await invalidateAfterEdit(next, "basic");
  };

  const savePortfolios = async (portfolios: Portfolio[]) => {
    if (!client) return;
    await updateClient(client.id, { portfolios });
    const next = { ...client, portfolios };
    setClient(next);
    await invalidateAfterEdit(next, "portfolio");
  };

  const finalizePortfolio = async (portfolio: Portfolio) => {
    if (!client) return;
    const stages = { ...(client.stages ?? {}), portfolio: true };
    await updateClient(client.id, { portfolios: [portfolio], stages });
    setClient({ ...client, portfolios: [portfolio], stages });
  };

  const unfinalizePortfolio = async () => {
    if (!client) return;
    const stages = { ...(client.stages ?? {}), portfolio: false, stress: false };
    await updateClient(client.id, { stages });
    setClient({ ...client, stages });
  };

  const toggleStage = async (key: StageKey) => {
    if (!client) return;
    const stages = { ...(client.stages ?? {}), [key]: !client.stages?.[key] };
    await updateClient(client.id, { stages });
    setClient({ ...client, stages });
  };

  const patchStages = async (patch: Stages, portfolios?: Portfolio[]) => {
    if (!client) return;
    const stages = { ...(client.stages ?? {}), ...patch };
    const next = portfolios ? { stages, portfolios } : { stages };
    await updateClient(client.id, { ...next, approvalHashes: client.approvalHashes });
    setClient({ ...client, ...next });
    notifyClientUpdated();
  };

  const onBasicAssetsChanged = () => {
    bumpAssetRefresh();
    publishClientLiveSync(clientId, "assets", "holdings-or-estate");
    const latest = clientRef.current;
    if (!latest || !isBasicWorkflowApproved(latest)) return;
    void invalidateAfterEdit({}, "basic");
  };

  const onPortfolioDraftChanged = () => {
    publishClientLiveSync(clientId, "draft", "portfolio-draft");
    const latest = clientRef.current;
    if (!latest || !isPortfolioWorkflowApproved(latest)) return;
    void invalidateAfterEdit({}, "portfolio");
  };

  const approveBasicInfo = async () => {
    if (!client) return;

    if (isBasicWorkflowApproved(client)) {
      if (
        !confirm(
          "기본정보 승인을 취소할까요?\n포트폴리오·IPS 승인도 함께 초기화됩니다.",
        )
      ) {
        return;
      }
      await applyInvalidation("basic", MSG_BASIC_UNAPPROVED);
      return;
    }

    const reasons = [
      ...validateBasicWorkflowApproval(client),
      ...ipsExtractionMissingReasons(client),
    ].filter((r, i, arr) => arr.indexOf(r) === i);
    if (reasons.length) {
      alert(`검토 필요\n\n${reasons.join("\n")}`);
      return;
    }
    if (!confirm("기본정보·7요인·현금흐름 입력을 승인할까요?\n(상담 진행 1~3단계가 완료됩니다)")) return;

    const ips = extractIpsFromClientProfile(client);
    const stages = { ...(client.stages ?? {}), ...basicApprovalStagePatch() };
    const approvalHashes = {
      basic: computeBasicApprovalHash({ ...client, ips }),
    };
    await updateClient(client.id, { stages, ips, approvalHashes });
    const nextClient = { ...client, stages, ips, approvalHashes };
    setClient(nextClient);
    clientRef.current = nextClient;
    syncEvidenceAfterBasicApproval(nextClient);
    notifyClientUpdated();
    // 재승인 후 새 편집은 다시 한 번 안내할 수 있게 알림 키를 비운다.
    shownNoticeKeysRef.current.clear();
    setApprovalNotice(null);
    // 해제 쪽(applyInvalidation)과 대칭. 게이트가 한 번 걸리면 gateToastKey 에 그 키가
    // 남아 이후 같은 안내가 영구히 억제된다 — 승인으로 게이트가 풀렸으니 여기서 비운다.
    gateToastKey.current = "";
    alert(MSG_BASIC_APPROVED);
  };

  const approvePortfolioWorkflow = async () => {
    if (!client) return;

    if (isPortfolioWorkflowApproved(client)) {
      if (
        !confirm(
          "포트폴리오 승인을 취소할까요?\nIPS 승인도 함께 초기화됩니다.",
        )
      ) {
        return;
      }
      await applyInvalidation("portfolio", MSG_PORTFOLIO_UNAPPROVED);
      return;
    }

    // 초안을 DB 기준으로 먼저 맞춘다. validate 에 draft 를 넘기고, source 로
    // 로컬 전용 초안인 경우 승인 완료 알림에 동기화 한계를 명시한다.
    const { draft, source: draftSource } = await getPortfolioDraft(pbId, clientId);
    const reasons = validatePortfolioWorkflowApproval(client, clientId, draft);
    if (reasons.length) {
      alert(`검토 필요\n\n${reasons.join("\n")}`);
      return;
    }
    if (!draft) {
      alert("포트폴리오 초안을 불러오지 못했습니다. 저장 후 다시 시도하세요.");
      return;
    }
    if (!confirm("포트폴리오·리스크·세전·세후 결과를 승인할까요?\n(상담 진행 4~6단계가 완료됩니다)")) return;

    const prev = client.portfolios[0] ?? null;
    const snap = draft.analyticsSnapshot;
    const compositionStillValid = draftMatchesApprovedInstruments(draft, prev);
    const expectedReturnPct =
      (snap?.returnStatus === "ok"
        ? decimalReturnToPctPoints(snap.expectedReturnDecimal)
        : null) ??
      (compositionStillValid &&
      prev?.expectedReturn != null &&
      Number.isFinite(prev.expectedReturn) &&
      prev.metricsStatus !== "unavailable" &&
      prev.metricsStatus !== "legacy_incomplete"
        ? prev.expectedReturn
        : null);
    const expectedRiskPct =
      (snap?.riskStatus === "ok"
        ? decimalReturnToPctPoints(snap.expectedRiskDecimal)
        : null) ??
      (compositionStillValid &&
      prev?.expectedRisk != null &&
      Number.isFinite(prev.expectedRisk) &&
      prev.metricsStatus !== "unavailable" &&
      prev.metricsStatus !== "legacy_incomplete"
        ? prev.expectedRisk
        : null);
    const returnOk = expectedReturnPct != null;
    const riskOk = expectedRiskPct != null;
    // 기대수익만 있어도 metricsStatus ok — 변동성 부재가 수익을 지우지 않음
    const metricsStatus = returnOk ? "ok" : "unavailable";

    const portfolio = buildApprovedPortfolio({
      draft,
      previous: prev,
      expectedReturn: expectedReturnPct,
      expectedRisk: riskOk ? expectedRiskPct : null,
      metricsStatus,
    });

    if (!portfolio.instruments?.length) {
      alert("편입 종목이 없어 승인할 수 없습니다. 종목을 선택한 뒤 초안을 저장하세요.");
      return;
    }
    const stages = { ...(client.stages ?? {}), ...portfolioApprovalStagePatch() };
    const nextClientBase = { ...client, stages, portfolios: [portfolio] };
    const approvalHashes = {
      basic: client.approvalHashes?.basic ?? computeBasicApprovalHash(client),
      portfolio: computePortfolioApprovalHash(nextClientBase, draft),
    };
    try {
      await updateClient(client.id, { stages, portfolios: [portfolio], approvalHashes });
    } catch (e: any) {
      alert(`승인 저장에 실패했습니다.\n${e?.message || e}\n서버 저장 없이 승인 완료로 표시하지 않습니다.`);
      return;
    }
    const nextClient = { ...nextClientBase, approvalHashes };
    setClient(nextClient);
    syncEvidenceAfterPortfolioApproval(nextClient);
    notifyClientUpdated();
    const draftNote =
      draftSource === "local"
        ? "\n(초안은 로컬 저장본입니다. 다른 브라우저와 동기화되지 않을 수 있습니다.)"
        : "";
    const metricsNote = returnOk
      ? riskOk
        ? ""
        : "\n예상 변동성은 산출 전일 수 있습니다. 기대수익은 반영되었습니다."
      : "\n예상수익률·변동성은 산출 전 상태입니다. IPS에는 '산출 전'으로 표시됩니다.";
    alert(`${MSG_PORTFOLIO_APPROVED}${draftNote}${metricsNote}`);
  };

  const approveIpsWorkflow = async () => {
    if (!client) return;

    if (isIpsWorkflowApproved(client)) {
      if (!confirm("IPS 승인을 취소할까요?\n최종 PDF 발행이 비활성화됩니다.")) return;
      const stages = { ...(client.stages ?? {}), ...ipsUnapprovalStagePatch() };
      const approvalHashes = {
        basic: client.approvalHashes?.basic,
        portfolio: client.approvalHashes?.portfolio,
      };
      await updateClient(client.id, { stages, approvalHashes });
      const nextClient = { ...client, stages, approvalHashes };
      setClient(nextClient);
      syncEvidenceAfterIpsUnapproval(nextClient);
      notifyClientUpdated();
      alert(MSG_IPS_UNAPPROVED);
      return;
    }

    const bundle = loadBundle(clientId);
    const reasons = validateIpsWorkflowApproval(client, bundle);
    if (reasons.length) {
      alert(`검토 필요\n\n${reasons.join("\n")}`);
      return;
    }
    // 초안 스테일 가드 — 저장된 초안의 AUM 이 지금 AUM 과 다르면 확정을 막는다.
    //
    //   아래 availableFundsWon(= 초안의 allocatableWon)이 그대로 매수 예산이 되는데,
    //   초안은 자동 저장이 아니라 "배분 확정 저장" 버튼을 눌러야 갱신된다. 그래서 저장
    //   이후 assetSize 나 부동산이 바뀌면 화면에는 새 금액이 떠도 확정은 옛 금액으로
    //   돈다 — 예외도 경고도 없이 매수액만 조용히 틀어진다. 실제로 2026-09-08 자산 모델
    //   변경 때 이기량 초안이 옛 모델 값(투자가능자산 279.8억)으로 남아 있었다.
    //
    //   신선도를 타임스탬프로 판단하지 않는 이유: portfolio_drafts.updated_at 은 초안이
    //   저장된 시각일 뿐이고, 정작 비교 대상인 parties.asset_size 에는 변경 이력이 없다.
    //   "초안이 언제 저장됐는가"를 알아도 "그 뒤 AUM 이 바뀌었는가"는 알 수 없다.
    //   그래서 시각이 아니라 값 자체를 대조한다.
    //
    //   초안이 아예 없으면 막지 않는다 — availableFundsWon 이 0 이 되어 매수가 일어나지
    //   않으므로 잘못된 금액이 나갈 위험 자체가 없다. 반대로 초안은 있는데 investableWon
    //   이 없는 구버전 초안은 대조가 불가능하므로 막는 쪽(fail closed)을 택한다.
    //
    //   초안은 DB 에서 읽는다. 예전에는 localStorage 만 봐서, 이 기기에서 Portfolio
    //   Customizing 탭을 한 번도 열지 않았으면 DB 에 초안이 있어도 null 을 받았다 —
    //   그러면 예산이 0 이 되어 매수 0건으로 조용히 확정된다.
    const { draft, source: draftSource } = await getPortfolioDraft(pbId, clientId);
    const currentAumWon = Math.round(investableWon ?? client.assetSize ?? 0);
    const draftAumWon = draft?.investableWon != null ? Math.round(draft.investableWon) : null;
    if (draft && draftAumWon !== currentAumWon) {
      alert(
        [
          "포트폴리오 초안이 현재 AUM 과 맞지 않아 확정할 수 없습니다.",
          "",
          `초안에 저장된 AUM : ${draftAumWon == null ? "기록 없음 (구버전 초안)" : formatKRW(draftAumWon)}`,
          `현재 AUM          : ${formatKRW(currentAumWon)}`,
          "",
          'Portfolio Customizing 탭에서 "배분 확정 저장"을 다시 눌러 초안을 갱신한 뒤 확정해 주세요.',
          '초안에 저장된 "배분 가능 자산"이 그대로 매수 예산으로 쓰이기 때문에, 갱신하지 않고 확정하면 옛 금액으로 매수가 기입됩니다.',
        ].join("\n"),
      );
      return;
    }

    if (!confirm("IPS·PDF 단계를 승인할까요?\n(상담 진행 7단계가 완료됩니다)\n\n※ 보유종목 반영은 KIS 시세 스냅샷 기준 장부 기입이며, 실제 증권사 주문이 아닙니다.")) return;

    // 승인·보유 반영 전에 시세·매수계획을 먼저 검증한다. 실패 시 승인하지 않는다.
    const availableFundsWon = Math.max(0, draft?.allocatableWon ?? 0);
    let approvedPf = client.portfolios[0] ?? null;
    if (!approvedPf) {
      alert("승인된 포트폴리오가 없습니다. 포트폴리오를 먼저 승인하세요.");
      return;
    }
    if (isLegacyIncompletePortfolio(approvedPf)) {
      // 레거시(종목 미저장): 승인 해시가 현재 초안과 일치할 때만 복구. 추측 금지.
      const storedHash = client.approvalHashes?.portfolio;
      const currentHash = draft
        ? computePortfolioApprovalHash({ ...client, portfolios: [approvedPf] }, draft)
        : null;
      if (draft && storedHash && currentHash && storedHash === currentHash) {
        approvedPf = recoverInstrumentsFromMatchingDraft(approvedPf, draft);
      } else {
        alert(
          "이전에 승인된 포트폴리오에 편입 종목 상세가 없거나, 초안과 일치하지 않습니다.\n포트폴리오 승인을 취소한 뒤 종목을 포함해 다시 승인해 주세요.",
        );
        return;
      }
    }
    if (!(approvedPf.instruments?.length)) {
      alert("확정 편입 종목이 없습니다. 포트폴리오를 다시 승인해 주세요.");
      return;
    }

    const quoteTickers: { ticker: string; currency: "KRW" | "USD" }[] = [];
    const pushQuote = (symbol: string, currency?: string | null) => {
      const cur = (currency === "USD" ? "USD" : "KRW") as "KRW" | "USD";
      if (!quoteTickers.some((t) => t.ticker === symbol && t.currency === cur)) {
        quoteTickers.push({ ticker: symbol, currency: cur });
      }
    };
    for (const row of draft?.selected ?? []) {
      if ((Number(row.weightWithinClass) || 0) <= 0) continue;
      if (!requiresMarketQuote(row)) continue;
      pushQuote(row.symbol, row.currency);
    }
    for (const inst of approvedPf.instruments) {
      if ((Number(inst.weightWithinClass) || 0) <= 0) continue;
      if (
        !requiresMarketQuote({
          symbol: inst.symbol,
          name: inst.name,
          assetClass: inst.assetClassKey as any,
          weightWithinClass: inst.weightWithinClass,
          currency: inst.currency,
          kind: inst.kind ?? undefined,
          quotationKind: (inst.quotationKind as any) ?? undefined,
        })
      ) {
        continue;
      }
      pushQuote(inst.symbol, inst.currency);
    }

    let fxUsdKrw = 1350;
    const priceSnapshots: PriceSnapshot[] = [];
    try {
      const fxRes = await fetch("/api/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: quoteTickers, fresh: true }),
      });
      const fxJson = await fxRes.json();
      if (Number(fxJson.fxUsdKrw) > 0) fxUsdKrw = Number(fxJson.fxUsdKrw);
      if (!fxJson.connected && quoteTickers.length > 0) {
        alert(
          "KIS 시세에 연결되지 않아 IPS를 확정할 수 없습니다.\n서버 KIS 자격증명을 확인한 뒤 다시 시도하세요.",
        );
        return;
      }
      const quotes = (Array.isArray(fxJson.quotes) ? fxJson.quotes : []) as PriceQuote[];
      const missing: string[] = [];
      for (const t of quoteTickers) {
        const q = findQuoteBySymbol(quotes, t.ticker, t.currency);
        const price = q?.price != null ? Number(q.price) : NaN;
        if (!q || !Number.isFinite(price) || price <= 0) {
          missing.push(
            `${t.ticker}${q?.error_code ? ` (${q.error_code}: ${q.error_message || ""})` : ""}`,
          );
          continue;
        }
        priceSnapshots.push({
          symbol: t.ticker,
          providerSymbol: String(q.providerSymbol || t.ticker),
          price,
          currency: t.currency,
          source: "kis",
          fetchedAt: String(q.as_of || new Date().toISOString()),
          quoteTime: q.quote_time ?? null,
          isLive: Boolean(q.is_live),
        });
      }
      if (missing.length > 0) {
        alert(
          `필수 시세를 확보하지 못해 IPS를 확정하지 않았습니다.\n\n${missing.join("\n")}\n\n초안은 유지됩니다. 시세 확인 후 다시 시도하세요.`,
        );
        return;
      }
    } catch (e: any) {
      alert(`시세 조회 실패로 IPS를 확정하지 않았습니다.\n${e?.message || e}`);
      return;
    }

    const priceBySymbol = new Map(priceSnapshots.map((s) => [s.symbol, s.price]));
    const stampedPortfolio = stampApprovedInstrumentsWithQuotes(approvedPf, {
      priceBySymbol,
      fxUsdKrw,
    });

    const stages = { ...(client.stages ?? {}), ...ipsApprovalStagePatch() };
    const ips = client.ips?.return?.reviewed
      ? client.ips
      : extractIpsFromClientProfile(client);
    const nextBase = {
      ...client,
      stages,
      ips,
      portfolios: [stampedPortfolio],
    };
    const approvalHashes = {
      basic: client.approvalHashes?.basic ?? computeBasicApprovalHash(client),
      portfolio: client.approvalHashes?.portfolio ?? computePortfolioApprovalHash(client, draft),
      ips: computeIpsApprovalHash(nextBase),
    };

    try {
      const sync = await applyIpsHoldingsSync({
        clientId,
        pbId,
        ipsHash: approvalHashes.ips!,
        availableFundsWon,
        fxUsdKrw,
        draft,
        priceSnapshots,
      });
      if (sync.status === "failed") {
        alert(
          `보유종목 반영에 실패해 IPS를 확정하지 않았습니다.\n${sync.error || "재시도가 필요합니다."}\n\n초안은 유지됩니다.`,
        );
        return;
      }

      try {
        await updateClient(client.id, {
          stages,
          ips,
          approvalHashes,
          portfolios: [stampedPortfolio],
        });
      } catch (e: any) {
        alert(
          `IPS 승인 서버 저장에 실패했습니다.\n${e?.message || e}\n브라우저에만 저장된 것처럼 표시하지 않습니다.`,
        );
        return;
      }

      const nextClient = { ...nextBase, approvalHashes };
      setClient(nextClient);
      syncEvidenceAfterIpsApproval(nextClient);
      notifyClientUpdated();
      bumpAssetRefresh();
      const draftNote =
        draftSource === "local"
          ? "\n(초안은 로컬 저장본입니다. 다른 브라우저와 동기화되지 않을 수 있습니다.)"
          : "";
      alert(
        `${MSG_IPS_APPROVED}\n보유종목 반영: ${sync.linesApplied}건 (KIS 시세 스냅샷·장부 기준, 실주문 아님)${draftNote}`,
      );
    } catch (e: any) {
      console.error(e);
      alert(`IPS 확정/보유 반영 오류: ${e?.message || e}\n초안은 유지됩니다.`);
    }
  };
  const saveComprehensiveTaxFlag = async (value: boolean) => {
    if (!client) return;
    await updateClient(client.id, { financialIncomeComprehensiveTax: value });
    const next = {
      ...client,
      financialIncomeComprehensiveTax: value,
      financialIncomeProfile: value
        ? client.financialIncomeProfile ?? null
        : client.financialIncomeProfile,
    };
    setClient(next);
    await invalidateAfterEdit(next, "basic");
  };

  const saveFinancialIncomeProfile = useCallback(async (
    profile: FinancialIncomeProfile,
    opts?: { skipInvalidation?: boolean },
  ) => {
    const current = clientRef.current;
    if (!current) return;
    const prev = current.financialIncomeProfile;
    const onlyDerived =
      prev != null &&
      Object.keys(profile).every((k) => {
        const key = k as keyof FinancialIncomeProfile;
        if (
          key === "derivedDepositInterestWon" ||
          key === "derivedBondInterestWon" ||
          key === "derivedDividendWon" ||
          key === "derivedWithholdingWon"
        ) {
          return true;
        }
        return prev[key] === profile[key];
      }) &&
      (prev.derivedDepositInterestWon !== profile.derivedDepositInterestWon ||
        prev.derivedBondInterestWon !== profile.derivedBondInterestWon ||
        prev.derivedDividendWon !== profile.derivedDividendWon ||
        prev.derivedWithholdingWon !== profile.derivedWithholdingWon);

    const unchanged =
      prev != null &&
      JSON.stringify(prev) === JSON.stringify(profile);
    if (unchanged) return;

    await updateClient(current.id, { financialIncomeProfile: profile });
    // await 중 승인 해제가 반영됐을 수 있으므로 최신 stages 를 덮어쓰지 않는다.
    const latest = clientRef.current;
    if (!latest || latest.id !== current.id) return;
    const next = { ...latest, financialIncomeProfile: profile };
    clientRef.current = next;
    setClient(next);
    if (opts?.skipInvalidation || onlyDerived) return;
    await invalidateAfterEdit({}, "basic");
  }, [invalidateAfterEdit]);

  const onDerivedDepositInterest = useCallback(
    (snap: import("@/lib/financialIncomeBreakdown").DepositInterestSnapshot) => {
      setDepositInterestSnapshot(snap);
      const current = clientRef.current;
      if (!current) return;
      const grossWon = snap.allIncomplete ? null : snap.totalGrossWon;
      const prev = current.financialIncomeProfile?.derivedDepositInterestWon ?? null;
      if (prev === grossWon) return;
      const profile: FinancialIncomeProfile = {
        ...(current.financialIncomeProfile ?? {
          interestIncomeWon: null,
          dividendIncomeWon: null,
          parseStatus: "none",
        }),
        derivedDepositInterestWon: grossWon,
      };
      void saveFinancialIncomeProfile(profile, { skipInvalidation: true });
    },
    [saveFinancialIncomeProfile],
  );

  const applySurvey = async (ips: IPS, result: InvestmentSurveyResult) => {
    if (!client) return;
    await updateClient(client.id, { ips });
    const next = { ...client, ips };
    setClient(next);
    await saveInvestmentSurvey(client.id, pbId, result);
    await invalidateAfterEdit(next, "basic");
  };


  const submitEdit = async (v: ClientFormValue) => {
    if (!client) return;
    const patch = {
      code: v.code,
      clientType: v.clientType,
      name: v.name,
      birthDate: v.birthDate,
      assignedPbId: v.assignedPbId,
      assetSize: v.assetSize,
      linkedClientId: v.linkedClientId,
      ownershipPct: v.ownershipPct,
      isMajorityShareholder: v.isMajorityShareholder,
      accountSeparation: v.accountSeparation,
      email: v.email,
      emailOptIn: v.emailOptIn,
    };
    await updateClient(client.id, patch);
    const next = { ...client, ...patch };
    setClient(next);
    await invalidateAfterEdit(next, "basic");
    await load();
    if (v.assignedPbId && v.assignedPbId !== pbId) {
      router.replace(`/pb/${v.assignedPbId}/${client.id}`);
    }
  };

  const confirmDelete = async () => {
    if (!client) return;
    await deleteClient(client.id);
    router.push(`/pb/${pbId}`);
  };

  if (status === "loading") return <LoadingView />;
  if (status === "error" || !client)
    return <ErrorView message="고객 정보를 불러올 수 없습니다." onRetry={load} />;

  const lastConsultedAt =
    consultations.length > 0
      ? consultations.slice().sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))[0].createdAt
      : "";
  const linkedClient = allClients.find((item) => item.id === client?.linkedClientId) ?? null;
  const completedStages = Object.values(client.stages ?? {}).filter(Boolean).length;
  const totalStages = Object.keys(client.stages ?? {}).length;
  const riskProfile = client.ips?.risk?.value?.trim();

  return (
    <div className="pb-console mx-auto max-w-[1440px] space-y-5 px-3 py-4 sm:px-4 lg:px-8">
      {approvalNotice && (
        <div
          role="status"
          className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
            approvalNotice.error
              ? "border-rose-300 bg-rose-50 text-rose-900"
              : "border-amber-300 bg-amber-50 text-amber-950"
          }`}
        >
          <p className="font-semibold leading-relaxed">{approvalNotice.message}</p>
          <button
            type="button"
            className="shrink-0 rounded border border-current/20 px-2 py-1 text-xs font-bold"
            onClick={() => setApprovalNotice(null)}
          >
            닫기
          </button>
        </div>
      )}
      <section className="console-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex min-w-0 items-center gap-4">
            <ClientAvatar name={client.name} type={client.clientType} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap gap-1.5"><span className="badge-navy font-mono">{client.code}</span><span className="badge-muted">{CLIENT_TYPE_LABEL[client.clientType]}</span>{client.isMajorityShareholder && <span className="badge-warning">최대주주</span>}</div>
              <h1 className="mt-2 truncate text-2xl font-black tracking-tight text-fg">{client.name}</h1>
              <p className="mt-1 text-xs text-fg-muted">Customer 360 · AUM <b className="text-[#0D57BA]">{formatKRW(investableWon ?? client.assetSize)}</b> (총자산 {formatKRW(totalAssetWon ?? client.assetSize)}){riskProfile ? ` · ${riskProfile}` : ""}</p>
            </div>
          </div>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3 lg:w-auto lg:min-w-[480px]">
            <div className="console-metric">
              <div className="flex items-center justify-between"><p className="console-label">상담 진행률</p><p className="text-sm font-black text-[#0D57BA]">{completedStages}/{totalStages || "—"}</p></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#DCE3EC]"><div className="h-full rounded-full bg-[#1769D2]" style={{ width: `${totalStages ? Math.round((completedStages / totalStages) * 100) : 0}%` }} /></div>
            </div>
            <div className="console-metric"><p className="console-label">마지막 상담</p><p className="mt-1 text-sm font-bold text-fg">{lastConsultedAt ? formatDate(lastConsultedAt) : "기록 없음"}</p></div>
            <div className="console-metric"><p className="console-label">현재 상태</p><p className="mt-1 text-sm font-bold text-fg">{client.stages?.portfolio ? "포트폴리오 확정" : "분석 진행 중"}</p></div>
          </div>
        </div>
      </section>

      {/* 기본 정보 */}
      {activeView === "home" && <>
        <section>
          <h2 className="mb-3 text-base font-semibold text-fg">
            기본 정보
          </h2>
          <div className="console-panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="badge-gold font-mono">{client.code}</span>
                  <span className={client.clientType === "corporate" ? "badge-navy" : "badge-muted"}>
                    {CLIENT_TYPE_LABEL[client.clientType]}
                  </span>
                  {client.isMajorityShareholder && <span className="badge-gold">최대주주</span>}
                </div>
                <h1 className="text-lg font-bold text-fg">고객 기본 프로필</h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-fg-muted">
                  <span>
                    {client.clientType === "corporate" ? "설립일" : "생년월일"}{" "}
                    {formatDate(client.birthDate)}
                  </span>
                  <span className="text-fg-muted/40">·</span>
                  {/* 부동산 제외 기준 — 바로 아래 AUM 헤더(:639)와 같은 값이다.
                      기준이 다르면 같은 화면에 350억과 345억이 나란히 뜬다.
                      "부동산 제외"라고 덧붙이지 않는 이유: 바로 뒤 AssetAllocationBar 가
                      "· 부동산 5.0억"을 따로 찍어 주므로 기준이 저절로 드러난다. */}
                  <span>
                    투자가능자산{" "}
                    <b className="text-[#0D57BA]">{formatKRW(investableWon ?? client.assetSize)}</b>
                  </span>
                  <AssetAllocationBar clientId={clientId} aum={client.assetSize ?? 0} refreshKey={assetRefreshKey} />
                </div>
                {(linkedClient || client.accountSeparation) && (
                  <p className="mt-1 text-xs text-fg-muted">
                    {linkedClient && (
                      <>연동 고객 <b className="text-fg">{linkedClient.name}</b>
                        {client.ownershipPct != null && ` · 지분율 ${client.ownershipPct}%`}
                      </>
                    )}
                    {linkedClient && client.accountSeparation && " · "}
                    {client.accountSeparation && (
                      <>통장 분리 <b className="text-fg">{ACCOUNT_SEPARATION_LABEL[client.accountSeparation]}</b></>
                    )}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-outline text-sm" onClick={() => setEditOpen(true)}>수정</button>
                <button className="btn-ghost text-sm text-red-500" onClick={() => setDeleteOpen(true)}>삭제</button>
                <button
                  type="button"
                  className={isBasicWorkflowApproved(client) ? "btn-outline text-sm" : "btn-primary text-sm"}
                  onClick={() => void approveBasicInfo()}
                >
                  {isBasicWorkflowApproved(client) ? "기본정보 승인 취소" : "기본정보 승인"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 보유종목 / 부동산 자산 — 좌우 2단(45:55), 1280px 이하에서는 세로로 쌓임 */}
        <div className="grid grid-cols-[60%_40%] items-start gap-[18px] max-[1280px]:grid-cols-1">
          {/* MTS 보유종목 추출 */}
          <section className="min-w-0">
            <h2 className="mb-3 text-base font-semibold text-fg">
              보유종목 (MTS 캡쳐 추출)
            </h2>
            <div className="card p-4">
              <HoldingsExtractor clientId={clientId} onAssetsChanged={onBasicAssetsChanged} />
            </div>
          </section>

          {/* 부동산 자산 */}
          <section className="min-w-0">
            <h2 className="mb-3 text-base font-semibold text-fg">
              부동산 자산
            </h2>
            <div className="card p-4">
              <RealEstateModule clientId={clientId} onAssetsChanged={onBasicAssetsChanged} />
            </div>
          </section>
        </div>

        <DepositProductsSection
          clientId={clientId}
          onChanged={onBasicAssetsChanged}
          onDerivedInterestChange={onDerivedDepositInterest}
        />

        <FinancialIncomeTaxSection
          client={client}
          onChangeComprehensiveTax={saveComprehensiveTaxFlag}
          onChangeFinancialIncomeProfile={saveFinancialIncomeProfile}
          depositInterestSnapshot={depositInterestSnapshot}
        />

        {/* 7요인 */}
        <section>
          <h2 className="mb-3 text-base font-semibold text-fg">
            7요인
          </h2>
          <FactorsSummary
            client={client}
            allClients={allClients}
            pbId={pbId}
            onSurveyApplied={applySurvey}
            onToggleStage={toggleStage}
          />
        </section>

        <section id="cashflow">
          <h2 className="mb-3 text-base font-semibold text-fg">
            현금흐름
          </h2>
          <SimpleCashflowPanel
            cashFlows={client.cashFlows}
            onSave={saveCashFlows}
            pbId={pbId}
            clientId={clientId}
            initialPeriodType={client.cashflowPeriodType ?? null}
          />
        </section>

      </>}

      {/* 상담 진행 */}
      {activeView === "consultation" && (<>
        {/* 1. 상담 현황 바 */}
        <section>
          <h2 className="mb-3 text-base font-semibold text-fg">
            상담 진행
          </h2>
          <div className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-fg">상담 현황</p>
                <p className="text-xs text-fg-muted mt-0.5">
                  {lastConsultedAt
                    ? `최근 상담: ${formatDateTime(lastConsultedAt)} · 총 ${consultations.length}건`
                    : "아직 진행한 상담이 없습니다. 첫 상담을 시작해 보세요."}
                </p>
              </div>
              <button className="btn-primary text-sm px-4" onClick={() => setModalOpen(true)}>
                + 새 상담
              </button>
            </div>
          </div>
        </section>

        {/* 2. 성향 변화 추세 그래프 */}
        <section>
          <h2 className="mb-3 text-base font-semibold text-fg">
            성향 변화 추세
          </h2>
          <div className="card p-4">
            <TrendChart consultations={consultations} />
          </div>
        </section>

        {/* 3. 상담 이력 — 항상 펼쳐서 카드 나열 */}
        {consultations.length > 0 && (
          <section>
            <h2 className="mb-3 text-base font-semibold text-fg">
              상담 이력 ({consultations.length}건)
            </h2>
            <ConsultationHistory consultations={consultations} client={client} onSaved={load} />
          </section>
        )}
      </>)}

      {/* 분석 */}
      {activeView === "analysis" && activeTab === "customer" && client && (
        <div className="mb-3">
          <ClientViewLinkPanel clientId={clientId} pbId={pbId} clientName={client.name} />
        </div>
      )}
      {activeView === "analysis" && activeTab === "customer" && client && (
        <ClientFacingView
          client={client}
          clientId={clientId}
          pbId={pbId}
          embedded
          investableWon={investableWon}
        />
      )}
      {activeView === "analysis" && activeTab !== "customer" && (
        <IPSResultTabs
          client={client}
          allClients={allClients}
          pbId={pbId}
          clientId={clientId}
          tab={activeTab}
          onSetTab={handleSetTab}
          onEdit={() => setModalOpen(true)}
          onSavePortfolios={savePortfolios}
          onFinalizePortfolio={finalizePortfolio}
          onUnfinalizePortfolio={unfinalizePortfolio}
          onToggleStage={toggleStage}
          onApprovePortfolioWorkflow={approvePortfolioWorkflow}
          onApproveIpsWorkflow={approveIpsWorkflow}
          onPortfolioDraftChanged={onPortfolioDraftChanged}
          linkedClient={linkedClient}
          onChangeComprehensiveTax={saveComprehensiveTaxFlag}
          onChangeFinancialIncomeProfile={saveFinancialIncomeProfile}
        />
      )}

      {/* 모달들 */}
      <ConsultationModal
        open={modalOpen}
        client={client}
        pbId={pbId}
        onClose={() => setModalOpen(false)}
        onSaved={async () => { setModalOpen(false); await load(); }}
      />
      <ClientForm
        open={editOpen}
        initial={client}
        pbs={pbs}
        clients={allClients}
        suggestedCode={client.code}
        onSubmit={submitEdit}
        onClose={() => setEditOpen(false)}
      />
      <ConfirmModal
        open={deleteOpen}
        title="고객을 삭제할까요?"
        danger
        confirmLabel="삭제"
        description={
          <>
            <b>{client.name}</b> ({client.code})와 관련 상담 이력이 <b>모두 삭제</b>됩니다.
            되돌릴 수 없습니다.
          </>
        }
        onConfirm={confirmDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}

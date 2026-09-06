"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ACCOUNT_SEPARATION_LABEL, CLIENT_TYPE_LABEL } from "@/lib/types";
import type { Client, Consultation, CashFlow, IPS, PB, Portfolio, StageKey, Stages, FinancialIncomeProfile } from "@/lib/types";
import type { CashflowPeriodType } from "@/lib/cashflowPeriod";
import {
  getClient,
  listClients,
  listConsultations,
  listPbs,
  updateClient,
  deleteClient,
  saveInvestmentSurvey,
} from "@/lib/store";
import {
  basicApprovalStagePatch,
  basicUnapprovalStagePatch,
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
  portfolioUnapprovalStagePatch,
  validateBasicWorkflowApproval,
  validateIpsWorkflowApproval,
  validatePortfolioWorkflowApproval,
} from "@/lib/advisory/workflowApprovals";
import {
  extractIpsFromClientProfile,
  ipsExtractionMissingReasons,
  markIpsExtractionStale,
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
  bumpBasicAssetRevision,
  computeBasicApprovalHash,
  computeIpsApprovalHash,
  computePortfolioApprovalHash,
  detectApprovalInvalidation,
  MSG_BASIC_STALE,
  MSG_PORTFOLIO_STALE,
} from "@/lib/advisory/approvalSnapshots";
import { loadBundle } from "@/lib/advisory/control";
import { loadManualPortfolioDraft } from "@/lib/manualPortfolioDraft";
import { formatKRW, formatDate, formatDateTime } from "@/lib/format";
import ConsultationModal from "@/components/ConsultationModal";
import ClientForm, { type ClientFormValue } from "@/components/ClientForm";
import ConfirmModal from "@/components/ConfirmModal";
import IPSResultTabs, { type Tab } from "@/components/IPSResultTabs";
import TrendChart from "@/components/TrendChart";
import ConsultationHistory from "@/components/ConsultationHistory";
import { LoadingView, ErrorView } from "@/components/StateViews";
import HoldingsExtractor from "@/components/HoldingsExtractor";
import RealEstateModule from "@/components/RealEstateModule";
import AssetAllocationBar from "@/components/AssetAllocationBar";
import FinancialIncomeTaxSection from "@/components/FinancialIncomeTaxSection";
import PartyRelationshipModule from "@/components/PartyRelationshipModule";
import ClientAvatar from "@/components/ClientAvatar";
import FactorsSummary from "@/components/FactorsSummary";
import SimpleCashflowPanel from "@/components/SimpleCashflowPanel";
import type { InvestmentSurveyResult } from "@/lib/investmentSurvey";
import { resolveAssetBreakdown } from "@/lib/assets";

const MSG_NEED_BASIC = "기본정보 승인 후 포트폴리오를 진행할 수 있습니다.";
const MSG_NEED_PORTFOLIO = "포트폴리오 승인 후 IPS를 확정할 수 있습니다.";

export default function ClientDetailPage() {
  const { pbId, clientId } = useParams<{ pbId: string; clientId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeView = searchParams?.get("view") ?? "home";
  const activeTab: Tab = (["basic", "cashflow", "portfolio", "portfolio2", "taxProjection", "stress", "ips"] as const).find((t) => t === searchParams?.get("tab")) ?? "portfolio2"; // 기본 탭은 포트폴리오 — factors/cashflow는 기본 정보로 통합

  const [client, setClient] = useState<Client | null>(null);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [pbs, setPbs] = useState<PB[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [modalOpen, setModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [investableWon, setInvestableWon] = useState<number | null>(null);
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

  // AUM 표시는 부동산 제외(투자가능자산) 기준 — 조회 실패 시 assetSize로 폴백.
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    resolveAssetBreakdown(clientId)
      .then((b) => { if (!cancelled) setInvestableWon(b?.investableKrw ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientId]);

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
      alert(msg);
    };

    if ((activeTab === "portfolio2" || activeTab === "ips") && !isBasicWorkflowApproved(client)) {
      warn(MSG_NEED_BASIC, `${client.id}:need-basic`);
      router.replace(`/pb/${pbId}/${clientId}?view=home`);
      return;
    }
    if (activeTab === "ips" && !isPortfolioWorkflowApproved(client)) {
      warn(MSG_NEED_PORTFOLIO, `${client.id}:need-portfolio`);
      router.replace(`/pb/${pbId}/${clientId}?view=analysis&tab=portfolio2`);
    }
  }, [status, client, activeView, activeTab, router, pbId, clientId]);

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
    if (t === "ips" && client && !isPortfolioWorkflowApproved(client)) {
      alert(MSG_NEED_PORTFOLIO);
      return;
    }
    router.push(`/pb/${pbId}/${clientId}?view=analysis&tab=${t}`, { scroll: false });
  };

  const notifyClientUpdated = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("pb-client-updated"));
      window.dispatchEvent(new Event("pb-evidence-updated"));
    }
  };

  const applyInvalidation = async (
    current: Client,
    level: "basic" | "portfolio",
    message: string,
  ) => {
    if (level === "basic") {
      const stages = { ...(current.stages ?? {}), ...basicUnapprovalStagePatch() };
      const ips = markIpsExtractionStale(current.ips);
      const portfolios = (current.portfolios ?? []).map((p) => ({
        ...p,
        confirmedAt: undefined,
      }));
      const approvalHashes = {};
      await updateClient(current.id, { stages, ips, portfolios, approvalHashes });
      const nextClient = { ...current, stages, ips, portfolios, approvalHashes };
      setClient(nextClient);
      syncEvidenceAfterBasicUnapproval(nextClient);
      notifyClientUpdated();
      skipGateToast.current = true;
      gateToastKey.current = "";
      if (activeView === "analysis") {
        router.replace(`/pb/${pbId}/${clientId}?view=home`);
      }
      alert(message);
      return;
    }

    const stages = { ...(current.stages ?? {}), ...portfolioUnapprovalStagePatch() };
    const portfolios = (current.portfolios ?? []).map((p) => ({
      ...p,
      confirmedAt: undefined,
    }));
    const approvalHashes = {
      basic: current.approvalHashes?.basic,
    };
    await updateClient(current.id, { stages, portfolios, approvalHashes });
    const nextClient = { ...current, stages, portfolios, approvalHashes };
    setClient(nextClient);
    syncEvidenceAfterPortfolioUnapproval(nextClient);
    notifyClientUpdated();
    skipGateToast.current = true;
    gateToastKey.current = "";
    if (activeView === "analysis" && activeTab === "ips") {
      router.replace(`/pb/${pbId}/${clientId}?view=analysis&tab=portfolio2`);
    }
    alert(message);
  };

  /** 승인 후 입력 변경 시 스테일 승인 해제 */
  const invalidateAfterEdit = async (
    nextPartial: Partial<Client>,
    prefer: "basic" | "portfolio" | "auto" = "auto",
  ) => {
    if (!client) return;
    const probe: Client = { ...client, ...nextPartial };
    if (prefer === "basic" && isBasicWorkflowApproved(client)) {
      await applyInvalidation(probe, "basic", MSG_BASIC_STALE);
      return;
    }
    if (prefer === "portfolio" && isPortfolioWorkflowApproved(client)) {
      await applyInvalidation(probe, "portfolio", MSG_PORTFOLIO_STALE);
      return;
    }
    const hit = detectApprovalInvalidation(probe);
    if (!hit) return;
    if (hit.level === "ips") {
      const stages = { ...(probe.stages ?? {}), ...hit.stages };
      await updateClient(probe.id, { stages, approvalHashes: hit.hashes });
      const nextClient = { ...probe, stages, approvalHashes: hit.hashes };
      setClient(nextClient);
      syncEvidenceAfterIpsUnapproval(nextClient);
      notifyClientUpdated();
      alert(hit.message);
      return;
    }
    await applyInvalidation(probe, hit.level, hit.message);
  };

  // 새로고침 후 스테일 승인 정리 (+ 해시 없는 기존 승인 마이그레이션)
  useEffect(() => {
    if (status !== "ready" || !client) return;
    void (async () => {
      const hashes = { ...(client.approvalHashes ?? {}) };
      let stamped = false;
      if (isBasicWorkflowApproved(client) && !hashes.basic) {
        hashes.basic = computeBasicApprovalHash(client);
        stamped = true;
      }
      if (isPortfolioWorkflowApproved(client) && !hashes.portfolio) {
        hashes.portfolio = computePortfolioApprovalHash(client);
        stamped = true;
      }
      if (isIpsWorkflowApproved(client) && !hashes.ips) {
        hashes.ips = computeIpsApprovalHash(client);
        stamped = true;
      }
      if (stamped) {
        await updateClient(client.id, { stages: client.stages, approvalHashes: hashes });
        setClient({ ...client, approvalHashes: hashes });
        return;
      }

      const hit = detectApprovalInvalidation(client);
      if (!hit) return;
      if (hit.level === "ips") {
        const stages = { ...(client.stages ?? {}), ...hit.stages };
        await updateClient(client.id, { stages, approvalHashes: hit.hashes });
        const nextClient = { ...client, stages, approvalHashes: hit.hashes };
        setClient(nextClient);
        syncEvidenceAfterIpsUnapproval(nextClient);
        notifyClientUpdated();
        alert(hit.message);
        return;
      }
      await applyInvalidation(client, hit.level, hit.message);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 로드 직후 1회 보정
  }, [status, clientId]);

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
    bumpBasicAssetRevision(clientId);
    if (!client || !isBasicWorkflowApproved(client)) return;
    void invalidateAfterEdit(client, "basic");
  };

  const onPortfolioDraftChanged = () => {
    if (!client || !isPortfolioWorkflowApproved(client)) return;
    void invalidateAfterEdit(client, "portfolio");
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
      await applyInvalidation(client, "basic", MSG_BASIC_UNAPPROVED);
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
    syncEvidenceAfterBasicApproval(nextClient);
    notifyClientUpdated();
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
      await applyInvalidation(client, "portfolio", MSG_PORTFOLIO_UNAPPROVED);
      return;
    }

    const reasons = validatePortfolioWorkflowApproval(client, clientId);
    if (reasons.length) {
      alert(`검토 필요\n\n${reasons.join("\n")}`);
      return;
    }
    if (!confirm("포트폴리오·리스크·세전·세후 결과를 승인할까요?\n(상담 진행 4~6단계가 완료됩니다)")) return;

    const draft = loadManualPortfolioDraft(clientId);
    const labelMap: Record<string, string> = {
      domesticEquity: "국내주식",
      globalEquity: "해외주식",
      domesticBond: "국내채권",
      globalBond: "해외채권",
      alternatives: "상품·대체",
      cash: "현금성",
    };
    const allocations = draft
      ? (Object.entries(draft.finalAllocation ?? draft.allocation) as [string, number][])
          .filter(([, weight]) => weight > 0)
          .map(([assetClass, weight]) => ({
            assetClass: labelMap[assetClass] ?? assetClass,
            weight,
          }))
      : client.portfolios[0]?.allocations ?? [];
    const portfolio: Portfolio = {
      id: client.portfolios[0]?.id ?? `manual-${Date.now()}`,
      label: "맞춤 포트폴리오",
      allocations,
      expectedReturn: client.portfolios[0]?.expectedReturn ?? 0,
      expectedRisk: client.portfolios[0]?.expectedRisk ?? 0,
      taxNote: "포트폴리오 승인 구성",
      rationale: "PB 맞춤 배분·종목 선택 승인",
      editedByPb: true,
      confirmedAt: new Date().toISOString(),
    };
    const stages = { ...(client.stages ?? {}), ...portfolioApprovalStagePatch() };
    const nextClientBase = { ...client, stages, portfolios: [portfolio] };
    const approvalHashes = {
      basic: client.approvalHashes?.basic ?? computeBasicApprovalHash(client),
      portfolio: computePortfolioApprovalHash(nextClientBase, draft),
    };
    await updateClient(client.id, { stages, portfolios: [portfolio], approvalHashes });
    const nextClient = { ...nextClientBase, approvalHashes };
    setClient(nextClient);
    syncEvidenceAfterPortfolioApproval(nextClient);
    notifyClientUpdated();
    alert(MSG_PORTFOLIO_APPROVED);
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
    if (!confirm("IPS·PDF 단계를 승인할까요?\n(상담 진행 7단계가 완료됩니다)")) return;
    const stages = { ...(client.stages ?? {}), ...ipsApprovalStagePatch() };
    const ips = client.ips?.return?.reviewed
      ? client.ips
      : extractIpsFromClientProfile(client);
    const nextBase = { ...client, stages, ips };
    const approvalHashes = {
      basic: client.approvalHashes?.basic ?? computeBasicApprovalHash(client),
      portfolio: client.approvalHashes?.portfolio ?? computePortfolioApprovalHash(client),
      ips: computeIpsApprovalHash(nextBase),
    };
    await updateClient(client.id, { stages, ips, approvalHashes });
    const nextClient = { ...nextBase, approvalHashes };
    setClient(nextClient);
    syncEvidenceAfterIpsApproval(nextClient);
    notifyClientUpdated();
    alert(MSG_IPS_APPROVED);
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

  const saveFinancialIncomeProfile = async (profile: FinancialIncomeProfile) => {
    if (!client) return;
    await updateClient(client.id, { financialIncomeProfile: profile });
    const next = { ...client, financialIncomeProfile: profile };
    setClient(next);
    await invalidateAfterEdit(next, "basic");
  };

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
    <div className="mx-auto max-w-[1680px] space-y-5 px-4 py-4 lg:px-6">
      <section className="console-panel overflow-hidden bg-gradient-to-r from-white via-white to-[#F2F5FF]">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex min-w-0 items-center gap-4">
            <ClientAvatar name={client.name} type={client.clientType} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap gap-1.5"><span className="badge-navy font-mono">{client.code}</span><span className="badge-muted">{CLIENT_TYPE_LABEL[client.clientType]}</span>{client.isMajorityShareholder && <span className="badge-warning">최대주주</span>}</div>
              <h1 className="mt-2 truncate text-2xl font-black tracking-tight text-fg">{client.name}</h1>
              <p className="mt-1 text-xs text-fg-muted">Customer 360 · AUM <b className="text-[#1428A0]">{formatKRW(investableWon ?? client.assetSize)}</b> (총자산 {formatKRW(client.assetSize)}){riskProfile ? ` · ${riskProfile}` : ""}</p>
            </div>
          </div>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3 lg:w-auto lg:min-w-[480px]">
            <div className="console-metric">
              <div className="flex items-center justify-between"><p className="console-label">상담 진행률</p><p className="text-sm font-black text-[#1428A0]">{completedStages}/{totalStages || "—"}</p></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#DCE4F5]"><div className="h-full rounded-full bg-[#1428A0]" style={{ width: `${totalStages ? Math.round((completedStages / totalStages) * 100) : 0}%` }} /></div>
            </div>
            <div className="console-metric"><p className="console-label">마지막 상담</p><p className="mt-1 text-sm font-bold text-fg">{lastConsultedAt ? formatDate(lastConsultedAt) : "기록 없음"}</p></div>
            <div className="console-metric"><p className="console-label">현재 상태</p><p className="mt-1 text-sm font-bold text-fg">{client.stages?.portfolio ? "포트폴리오 확정" : "분석 진행 중"}</p></div>
          </div>
        </div>
      </section>

      {/* 기본 정보 */}
      {activeView === "home" && <>
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
            <span>👤</span> 기본 정보
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
                  <span>
                    자산규모{" "}
                    <b className="text-[#1428A0]">{formatKRW(client.assetSize)}</b>
                  </span>
                  <AssetAllocationBar clientId={clientId} totalAsset={client.assetSize ?? 0} refreshKey={assetRefreshKey} />
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
            <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
              <span>📊</span> 보유종목 (MTS 캡쳐 추출)
            </h2>
            <div className="card p-5">
              <HoldingsExtractor clientId={clientId} onAssetsChanged={onBasicAssetsChanged} />
            </div>
          </section>

          {/* 부동산 자산 */}
          <section className="min-w-0">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
              <span>🏠</span> 부동산 자산
            </h2>
            <div className="card p-5">
              <RealEstateModule clientId={clientId} onAssetsChanged={onBasicAssetsChanged} />
            </div>
          </section>
        </div>

        <FinancialIncomeTaxSection
          client={client}
          onChangeComprehensiveTax={saveComprehensiveTaxFlag}
          onChangeFinancialIncomeProfile={saveFinancialIncomeProfile}
        />

        {/* 7요인 */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
            <span>🎯</span> 7요인
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
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
            <span>💰</span> 현금흐름
          </h2>
          <SimpleCashflowPanel
            cashFlows={client.cashFlows}
            onSave={saveCashFlows}
            pbId={pbId}
            clientId={clientId}
            initialPeriodType={client.cashflowPeriodType ?? null}
          />
        </section>

        {/* 관계 네트워크 */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
            <span>🔗</span> 관계 네트워크
          </h2>
          <div className="card p-5">
            <PartyRelationshipModule
              partyId={clientId}
              partyType={client.clientType === "corporate" ? "corporate" : "individual"}
            />
          </div>
        </section>

      </>}

      {/* 상담 진행 */}
      {activeView === "consultation" && (<>
        {/* 1. 상담 현황 바 */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
            <span>📝</span> 상담 진행
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
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
            <span>📈</span> 성향 변화 추세
          </h2>
          <div className="card p-4">
            <TrendChart consultations={consultations} />
          </div>
        </section>

        {/* 3. 상담 이력 — 항상 펼쳐서 카드 나열 */}
        {consultations.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3 flex items-center gap-2">
              <span>📋</span> 상담 이력 ({consultations.length}건)
            </h2>
            <ConsultationHistory consultations={consultations} client={client} onSaved={load} />
          </section>
        )}
      </>)}

      {/* 분석 */}
      {activeView === "analysis" && (
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

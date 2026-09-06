"use client";

// 투자정책서(IPS) 문서 — 인쇄/PDF 저장용. 고객 데이터로 자동 생성.

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Client, PB } from "@/lib/types";
import { ACCOUNT_SEPARATION_LABEL, CLIENT_TYPE_LABEL, FACTOR_META } from "@/lib/types";
import { getClient, listPbs } from "@/lib/store";
import { resolveAssetBreakdown } from "@/lib/assets";
import { formatKRW, formatDate } from "@/lib/format";
import {
  buildPortfolioViewModel,
  resolvePortfolioDisplayAllocations,
} from "@/lib/portfolio";
import { buildReturnContributionsFromPortfolio } from "@/lib/portfolioReturnContribution";
import { scoreReadinessEvents } from "@/lib/taxReadinessScoring";
import { buildMonthlyCashflowSummarySeries } from "@/lib/periodCashflow";
import type { TaxPaymentEvent } from "@/lib/cashflowUpload";
import TaxReadinessRubricButton from "@/components/TaxReadinessRubricButton";
import PeriodCashflowLineChart from "@/components/cashflow/PeriodCashflowLineChart";
import { LoadingView, ErrorView } from "@/components/StateViews";
import { canIssueClientPdf, loadBundle, pdfBlockReason } from "@/lib/advisory/control";
import type { EvidenceBundle } from "@/lib/advisory/types";
import { advisoryInputHash } from "@/lib/advisory/integrity";
import { isSamePrintAttempt } from "@/lib/advisory/printPermitBinding";
import { stableJsonStringify } from "@/lib/advisory/stableJson";
import { HONESTY_LIMITS } from "@/lib/advisory/constants";
import { mergeTaxProfile, projectTax } from "@/lib/taxProjection";
import { DEFAULT_HORIZON_YEARS } from "@/lib/taxProjectionRules";
import {
  isIpsWorkflowApproved,
  isPortfolioWorkflowApproved,
} from "@/lib/advisory/workflowApprovals";
import { syncEvidenceAfterIpsApproval } from "@/lib/advisory/workflowEvidenceSync";
import { isFinancialIncomeReadyForTax } from "@/lib/financialIncome";

const CHART_COLORS = ["#0F172A", "#1428A0", "#2C3EE8", "#10b981", "#ef4444", "#8b5cf6", "#64748B"];

const taxText = (flow: Client["cashFlows"][number]) =>
  `${flow.label} ${flow.category ?? ""} ${flow.taxAccountingNote ?? ""} ${flow.accountType ?? ""}`;

const formatManwon = (won: number) => `${Math.round(won / 10_000).toLocaleString()}만원`;

function classifyCashflow(flow: Client["cashFlows"][number]) {
  const text = taxText(flow);
  if (/현금성자산|현재현금|자산|asset/i.test(text)) return "현금성자산";
  if (/세|tax|증여|상속|양도|종부|재산|법인세|부가세/i.test(text)) return "세금/이벤트";
  if (/저축|투자|CMA|MMF|RP|ETF|ISA|IRP|연금|적금/i.test(text)) return "저축/투자";
  if (flow.amount > 0) return "소득";
  return "지출";
}

function dueDateFromMonth(month: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(month)) return month;
  if (/^\d{4}-\d{2}$/.test(month)) return `${month}-28`;
  return "";
}

function previousMonthEnd(dateInput: string) {
  const date = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getFullYear(), date.getMonth(), 0).toISOString().slice(0, 10);
}

function buildTaxSchedule(cashFlows: Client["cashFlows"], currentCashWon: number, monthlyNetWon: number): TaxPaymentEvent[] {
  const events: Array<Omit<TaxPaymentEvent, "status" | "readiness">> = cashFlows
    .filter((flow) => flow.amount < 0 && /세|tax|증여|상속|양도|종부|재산|법인세|부가세/i.test(taxText(flow)))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 8)
    .map((flow) => {
      const dueDate = dueDateFromMonth(flow.date) || new Date().toISOString().slice(0, 10);
      const amountWon = Math.abs(flow.amount);
      return {
        id: `ips-tax-${flow.id}`,
        label: flow.label || "세금 이벤트",
        amountWon,
        dueDate,
        cashReadyDate: previousMonthEnd(dueDate) || dueDate,
        rule: flow.taxAccountingNote || "상담용 추정, 세무 전문가 확인 필요",
      };
    });
  return scoreReadinessEvents({ currentCashWon, monthlyNetWon, events });
}

function buildCashflowSummary(cashFlows: Client["cashFlows"]) {
  const recurringIn = cashFlows.filter((flow) => flow.recurring && flow.amount > 0).reduce((sum, flow) => sum + flow.amount, 0);
  const recurringOut = cashFlows.filter((flow) => flow.recurring && flow.amount < 0).reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  const oneOffIn = cashFlows.filter((flow) => !flow.recurring && flow.amount > 0).reduce((sum, flow) => sum + flow.amount, 0);
  const oneOffOut = cashFlows.filter((flow) => !flow.recurring && flow.amount < 0).reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  const currentCashWon = cashFlows
    .filter((flow) => /현금성자산|현재현금|CMA|MMF|RP|cash/i.test(taxText(flow)) && flow.amount > 0)
    .reduce((sum, flow) => sum + flow.amount, 0);
  const taxOut = cashFlows
    .filter((flow) => flow.amount < 0 && /세|tax|증여|상속|양도|부가세|종부|법인세/i.test(`${flow.label} ${flow.category ?? ""}`))
    .reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  const grouped = cashFlows.reduce<Record<string, number>>((acc, flow) => {
    const group = classifyCashflow(flow);
    acc[group] = (acc[group] ?? 0) + flow.amount;
    return acc;
  }, {});
  const summaryRows = Object.entries(grouped).map(([group, amount]) => ({
    group,
    item: group === "소득" ? "월 반복/일회 유입" : group === "지출" ? "생활비/운영비" : group,
    amount,
    annualizedAmount: cashFlows
      .filter((flow) => classifyCashflow(flow) === group)
      .reduce((sum, flow) => sum + (flow.recurring ? flow.amount * 12 : flow.amount), 0),
  }));
  const monthlyNet = recurringIn - recurringOut;
  const taxSchedule = buildTaxSchedule(cashFlows, currentCashWon, monthlyNet);
  const goals = cashFlows
    .filter((flow) => !flow.recurring && flow.amount < 0 && !/세|tax/i.test(taxText(flow)))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 5)
    .map((flow) => ({
      goal: flow.label || "재무목표",
      targetDate: flow.date || "미정",
      amount: Math.abs(flow.amount),
      priority: /증여|상속|주택|부동산|CAPEX/i.test(taxText(flow)) ? "상" : "중",
      note: flow.taxAccountingNote || flow.category || "현금화 계획 필요",
    }));
  const upcoming = cashFlows
    .filter((flow) => flow.date)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);

  return {
    recurringIn,
    recurringOut,
    oneOffIn,
    oneOffOut,
    currentCashWon,
    taxOut,
    net: recurringIn + oneOffIn - recurringOut - oneOffOut,
    monthlyNet,
    summaryRows,
    taxSchedule,
    goals,
    upcoming,
  };
}

// 7요인 값을 엮어 PB 종합 분석 문장 생성
function buildSummary(client: Client): string {
  const ips = client.ips;
  const t = CLIENT_TYPE_LABEL[client.clientType];
  const seg: string[] = [];
  seg.push(
    `${client.name} 고객은 ${t} 고객으로, 자산규모 ${formatKRW(client.assetSize)} 수준입니다.`,
  );

  const profile: string[] = [];
  if (ips.timeHorizon.value) profile.push(`투자 기간 ${ips.timeHorizon.value}`);
  if (ips.risk.value) profile.push(`위험 허용도 ${ips.risk.value}`);
  if (ips.return.value) profile.push(`목표 수익률 ${ips.return.value}`);
  if (profile.length) seg.push(`${profile.join(", ")} 수준으로 파악됩니다.`);

  const extra: string[] = [];
  if (ips.liquidity.value) extra.push(`유동성은 ${ips.liquidity.value}`);
  if (ips.tax.value) extra.push(`세금 측면은 ${ips.tax.value}`);
  if (ips.legal.value) extra.push(`법적 제약은 ${ips.legal.value}`);
  if (ips.unique.value) extra.push(`특이사항으로 ${ips.unique.value}`);
  if (extra.length) seg.push(`${extra.join(", ")} 등이 고려됩니다.`);

  seg.push(
    "이를 종합해 위험 분산과 목표 수익·세금·유동성을 균형 있게 반영한 자산배분을 권고합니다.",
  );
  return seg.join(" ");
}

function portfolioTypeOnlyLabel(portfolio: Client["portfolios"][number]): string {
  const id = portfolio.id.toLowerCase();
  if (id === "defensive" || id === "stable") return "방어형";
  if (id === "balanced") return "균형형";
  if (id === "growth" || id === "aggressive") return "성장형";

  const label = portfolio.label.trim();
  if (/방어|안정|defensive|stable/i.test(label)) return "방어형";
  if (/균형|balanced/i.test(label)) return "균형형";
  if (/성장|적극|공격|growth|aggressive/i.test(label)) return "성장형";

  return label
    .replace(/포트폴리오|추천안|추천|자산배분|도넛차트/gi, "")
    .trim() || label;
}

type VerifiedPrintPermit = {
  token: string;
  clientId: string;
  pbId: string;
  evidenceId: string;
  verifiedInputHash: string;
  evidenceDigest: string;
  expiresAt: string;
  mode: "authoritative" | "local-self-consistency";
  clientSnapshot: Client;
  pbSnapshot: Pick<PB, "id" | "name">;
  evidenceSnapshot: EvidenceBundle;
};

function printPermitKey(permit: VerifiedPrintPermit): string {
  return [
    permit.clientId,
    permit.pbId,
    permit.evidenceId,
    permit.token,
    permit.verifiedInputHash,
    permit.evidenceDigest,
    permit.expiresAt,
  ].join("\u0000");
}

function humanizePdfReason(reason: string) {
  return reason
    .replaceAll("Evidence Bundle", "계산·검토 기록")
    .replaceAll("Evidence", "상담 현재본")
    .replaceAll("Judge", "검토")
    .replaceAll("judge", "검토")
    .replaceAll("locked", "확정")
    .replaceAll("blocked", "차단")
    .replaceAll("draft", "초안")
    .replaceAll("inputHash", "입력 확인값")
    .replaceAll("settingsHash", "설정 확인값")
    .replaceAll("resultHash", "계산 확인값")
    .replaceAll("runId", "검토 기록 ID");
}

export default function IPSDocumentPage() {
  const { pbId, clientId } = useParams<{ pbId: string; clientId: string }>();
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [pbs, setPbs] = useState<PB[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [pdfBlocked, setPdfBlocked] = useState(true);
  const [pdfReason, setPdfReason] = useState("최신 상담 내용과 문서 발행 조건을 확인하고 있습니다.");
  const [printPermit, setPrintPermit] = useState<VerifiedPrintPermit | null>(null);
  const [printBusy, setPrintBusy] = useState(false);
  const [evidenceRevision, setEvidenceRevision] = useState(0);
  // 세금 추정 원금용 투자가능자산(부동산 제외). 조회 전/실패 시 null → 총자산 폴백.
  const [investableWon, setInvestableWon] = useState<number | null>(null);
  const routeKey = `${pbId}\u0000${clientId}`;
  const routeKeyRef = useRef(routeKey);
  routeKeyRef.current = routeKey;
  const clientRef = useRef<Client | null>(client);
  clientRef.current = client;
  const pbDisplayRef = useRef("");
  const printPermitRef = useRef<VerifiedPrintPermit | null>(printPermit);
  printPermitRef.current = printPermit;
  const flowEpochRef = useRef(0);
  const loadEpochRef = useRef(0);
  const verifyAbortRef = useRef<AbortController | null>(null);
  const printAbortRef = useRef<AbortController | null>(null);
  const printArmedRef = useRef<{ routeKey: string; permitKey: string } | null>(null);

  const load = useCallback(async () => {
    const requestedRouteKey = routeKey;
    const requestedLoadEpoch = ++loadEpochRef.current;
    setStatus("loading");
    try {
      const [c, allPbs] = await Promise.all([getClient(clientId), listPbs()]);
      if (
        loadEpochRef.current !== requestedLoadEpoch ||
        routeKeyRef.current !== requestedRouteKey
      ) return;
      if (!c) {
        setStatus("error");
        return;
      }
      setClient(c);
      setPbs(allPbs);
      setStatus("ready");
    } catch (e) {
      if (
        loadEpochRef.current !== requestedLoadEpoch ||
        routeKeyRef.current !== requestedRouteKey
      ) return;
      console.error(e);
      setStatus("error");
    }
  }, [clientId, routeKey]);

  useEffect(() => {
    load();
  }, [load]);

  // 투자가능자산(총자산 − 부동산) 조회 — projectTax 원금에 쓴다. 실패해도 문서는 그대로
  // 뜨고 총자산 폴백으로 계산된다.
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    resolveAssetBreakdown(clientId)
      .then((b) => { if (!cancelled) setInvestableWon(b?.investableKrw ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientId]);

  const assignedPb = client ? pbs.find((pb) => pb.id === client.assignedPbId) : undefined;
  const pbDisplay = client ? assignedPb?.name ?? "미지정" : "";
  pbDisplayRef.current = pbDisplay;

  const replacePrintPermit = useCallback((next: VerifiedPrintPermit | null) => {
    printPermitRef.current = next;
    setPrintPermit(next);
  }, []);

  const verifiedEvidenceIsCurrent = useCallback((candidate?: VerifiedPrintPermit | null) => {
    const permit = candidate ?? printPermitRef.current;
    const currentClient = clientRef.current;
    const currentPbDisplay = pbDisplayRef.current;
    const expiresAtMs = permit ? Date.parse(permit.expiresAt) : Number.NaN;
    if (
      !permit ||
      !currentClient ||
      permit.evidenceId === "" ||
      routeKeyRef.current !== `${permit.pbId}\u0000${permit.clientId}` ||
      currentClient.id !== permit.clientId ||
      currentClient.assignedPbId !== permit.pbId ||
      permit.clientSnapshot.id !== permit.clientId ||
      permit.clientSnapshot.assignedPbId !== permit.pbId ||
      permit.pbSnapshot.id !== permit.pbId ||
      !currentPbDisplay ||
      currentPbDisplay !== permit.pbSnapshot.name ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= Date.now()
    ) return false;
    const latest = loadBundle(permit.clientId);
    try {
      return (
        latest.id === permit.evidenceId &&
        canIssueClientPdf(latest) &&
        latest.inputHash === permit.verifiedInputHash &&
        stableJsonStringify(latest) === stableJsonStringify(permit.evidenceSnapshot) &&
        advisoryInputHash(currentClient, { assignedPbDisplay: currentPbDisplay }) === permit.verifiedInputHash &&
        advisoryInputHash(permit.clientSnapshot, {
          assignedPbDisplay: permit.pbSnapshot.name,
        }) === permit.verifiedInputHash
      );
    } catch {
      return false;
    }
  }, []);

  const blockPdfNow = useCallback((reason: string) => {
    document.body.classList.add("pb-pdf-print-blocked");
    flowEpochRef.current += 1;
    verifyAbortRef.current?.abort();
    verifyAbortRef.current = null;
    printAbortRef.current?.abort();
    printAbortRef.current = null;
    printArmedRef.current = null;
    replacePrintPermit(null);
    setPrintBusy(false);
    setPdfBlocked(true);
    setPdfReason(humanizePdfReason(reason));
  }, [replacePrintPermit]);

  useEffect(() => {
    blockPdfNow("고객·담당 PB·최신 상담본을 다시 확인하고 있습니다.");
    return () => {
      loadEpochRef.current += 1;
      flowEpochRef.current += 1;
      verifyAbortRef.current?.abort();
      verifyAbortRef.current = null;
      printAbortRef.current?.abort();
      printAbortRef.current = null;
      printArmedRef.current = null;
      printPermitRef.current = null;
    };
  }, [blockPdfNow, routeKey]);

  useEffect(() => {
    if (!printPermit) return;
    const expiresAtMs = Date.parse(printPermit.expiresAt);
    const delay = expiresAtMs - Date.now();
    if (!Number.isFinite(expiresAtMs) || delay <= 0) {
      blockPdfNow("출력 허가 토큰이 만료되어 고객 문서 본문을 다시 차단했습니다.");
      return;
    }
    const timer = window.setTimeout(() => {
      blockPdfNow("출력 허가 토큰이 만료되어 고객 문서 본문을 다시 차단했습니다.");
    }, delay);
    return () => window.clearTimeout(timer);
  }, [blockPdfNow, printPermit]);

  useEffect(() => {
    if (!client) return;
    const requestedRouteKey = routeKey;
    const requestedEpoch = ++flowEpochRef.current;
    verifyAbortRef.current?.abort();
    const controller = new AbortController();
    verifyAbortRef.current = controller;
    const isCurrentRequest = () =>
      !controller.signal.aborted &&
      flowEpochRef.current === requestedEpoch &&
      routeKeyRef.current === requestedRouteKey &&
      clientRef.current?.id === clientId;
    const failVerification = (reason: string) => {
      if (!isCurrentRequest()) return;
      document.body.classList.add("pb-pdf-print-blocked");
      printArmedRef.current = null;
      replacePrintPermit(null);
      setPrintBusy(false);
      setPdfBlocked(true);
      setPdfReason(reason);
    };

    if (client.id !== clientId || client.assignedPbId !== pbId || assignedPb?.id !== pbId) {
      failVerification("최종 PDF 비활성: 현재 고객과 담당 PB 경로가 일치하지 않습니다.");
      return () => controller.abort();
    }
    const bundle = isIpsWorkflowApproved(client)
      ? (() => {
          const current = loadBundle(clientId);
          if (canIssueClientPdf(current)) return current;
          return syncEvidenceAfterIpsApproval(client);
        })()
      : loadBundle(clientId);
    if (!canIssueClientPdf(bundle)) {
      failVerification(pdfBlockReason(bundle));
      return () => controller.abort();
    }

    document.body.classList.add("pb-pdf-print-blocked");
    printArmedRef.current = null;
    replacePrintPermit(null);
    setPrintBusy(false);
    setPdfBlocked(true);
    setPdfReason("최신 상담 내용과 문서 발행 조건을 확인하고 있습니다.");
    const verify = async () => {
      try {
        const ids = { clientId, pbId, evidenceId: bundle.id };
        const registerRes = await fetch("/api/advisory/local-self-consistency", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...ids,
            bundle,
          }),
          signal: controller.signal,
        });
        const registration = await registerRes.json();
        if (!isCurrentRequest()) return;
        if (!registerRes.ok || !registration.ok || !registration.registered) {
          failVerification(
            `최종 PDF 비활성: ${registration.reasons?.[0] || registration.error || "서버 원본 보존 실패"}`,
          );
          return;
        }

        const res = await fetch("/api/advisory/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(ids),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!isCurrentRequest()) return;
        const snapshotClient = data.clientSnapshot as Client | undefined;
        const snapshotPb = data.pbSnapshot as Pick<PB, "id" | "name"> | undefined;
        const evidenceSnapshot = data.evidenceSnapshot as EvidenceBundle | undefined;
        const verifiedInputHash = typeof data.verifiedInputHash === "string" ? data.verifiedInputHash : "";
        const evidenceDigest = typeof data.evidenceDigest === "string" ? data.evidenceDigest : "";
        if (
          !res.ok ||
          !data.ok ||
          !data.verified ||
          !data.printToken ||
          !data.expiresAt ||
          !verifiedInputHash ||
          !/^[a-f0-9]{64}$/i.test(evidenceDigest) ||
          data.clientId !== clientId ||
          data.pbId !== pbId ||
          data.evidenceId !== bundle.id ||
          !snapshotClient ||
          snapshotClient.id !== clientId ||
          snapshotClient.assignedPbId !== pbId ||
          !snapshotPb ||
          snapshotPb.id !== pbId ||
          !snapshotPb.name ||
          !evidenceSnapshot ||
          evidenceSnapshot.id !== bundle.id ||
          evidenceSnapshot.clientId !== clientId
        ) {
          failVerification(`최종 PDF 비활성: ${data.reasons?.[0] || data.error || "문서 발행 조건 확인 실패"}`);
          return;
        }

        const localInputHash = advisoryInputHash(client, { assignedPbDisplay: pbDisplay });
        const snapshotInputHash = advisoryInputHash(snapshotClient, {
          assignedPbDisplay: snapshotPb.name,
        });
        if (
          bundle.inputHash !== verifiedInputHash ||
          evidenceSnapshot.inputHash !== verifiedInputHash ||
          stableJsonStringify(bundle) !== stableJsonStringify(evidenceSnapshot) ||
          localInputHash !== verifiedInputHash ||
          snapshotInputHash !== verifiedInputHash ||
          pbDisplay !== snapshotPb.name
        ) {
          failVerification("최종 PDF 비활성: 화면 고객·담당 PB와 서버 검증 스냅샷이 일치하지 않습니다.");
          return;
        }

        const nextPermit: VerifiedPrintPermit = {
          token: data.printToken,
          clientId,
          pbId,
          evidenceId: bundle.id,
          verifiedInputHash,
          evidenceDigest,
          expiresAt: data.expiresAt,
          mode: data.mode === "authoritative" ? "authoritative" : "local-self-consistency",
          clientSnapshot: snapshotClient,
          pbSnapshot: snapshotPb,
          evidenceSnapshot,
        };
        replacePrintPermit(nextPermit);
        if (!isCurrentRequest() || !verifiedEvidenceIsCurrent(nextPermit)) {
          failVerification("최종 PDF 비활성: 검증 직후 고객·상담 현재본이 변경되었습니다.");
          return;
        }
        setPdfBlocked(false);
        setPdfReason("");
      } catch (error) {
        if (controller.signal.aborted || !isCurrentRequest()) return;
        failVerification(
          error instanceof Error && error.name === "AbortError"
            ? "최종 PDF 비활성: 검증 요청이 취소되었습니다."
            : "최종 PDF 비활성: 문서 발행 조건 확인 서비스에 연결할 수 없습니다.",
        );
      }
    };
    void verify();
    return () => {
      controller.abort();
      if (verifyAbortRef.current === controller) verifyAbortRef.current = null;
    };
  }, [
    assignedPb?.id,
    client,
    clientId,
    evidenceRevision,
    pbDisplay,
    pbId,
    replacePrintPermit,
    routeKey,
    verifiedEvidenceIsCurrent,
  ]);

  useEffect(() => {
    const currentEvidenceStorageKey = `pb-advisory-evidence-current-v2:${encodeURIComponent(clientId)}`;
    const invalidateEvidence = () => {
      blockPdfNow("상담 현재본이 변경되어 고객 문서를 즉시 차단하고 다시 확인합니다.");
      setEvidenceRevision((revision) => revision + 1);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null) {
        blockPdfNow("로컬 원본 저장소가 변경되어 고객 문서를 즉시 차단하고 다시 검증합니다.");
        void load().finally(() => setEvidenceRevision((revision) => revision + 1));
        return;
      }
      if (
        event.key === "pb-advisory-evidence-v1" ||
        event.key === currentEvidenceStorageKey
      ) {
        invalidateEvidence();
        return;
      }
      if (event.key === "pb-app-local-db") {
        blockPdfNow("고객 또는 담당 PB 원본이 변경되어 고객 문서를 즉시 차단하고 다시 검증합니다.");
        void load().finally(() => setEvidenceRevision((revision) => revision + 1));
      }
    };

    window.addEventListener("pb-evidence-updated", invalidateEvidence);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("pb-evidence-updated", invalidateEvidence);
      window.removeEventListener("storage", handleStorage);
    };
  }, [blockPdfNow, clientId, load]);

  useEffect(() => {
    const className = "pb-pdf-print-blocked";
    if (pdfBlocked) document.body.classList.add(className);
    else document.body.classList.remove(className);
    return () => {
      document.body.classList.remove(className);
    };
  }, [pdfBlocked]);

  useEffect(() => {
    const blockStalePrint = () => {
      blockPdfNow("상담 현재본 확인이 유효하지 않아 고객 문서 인쇄를 차단했습니다.");
    };
    const preventPrintShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "p") return;
      const armed = printArmedRef.current;
      const permit = printPermitRef.current;
      if (
        armed &&
        permit &&
        armed.routeKey === routeKeyRef.current &&
        armed.permitKey === printPermitKey(permit) &&
        verifiedEvidenceIsCurrent(permit)
      ) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      blockPdfNow("출력 허가 토큰은 ‘인쇄 / PDF로 저장’ 버튼에서만 1회 사용할 수 있습니다.");
    };
    const guardBrowserPrint = () => {
      const armed = printArmedRef.current;
      const permit = printPermitRef.current;
      if (
        !armed ||
        !permit ||
        armed.routeKey !== routeKeyRef.current ||
        armed.permitKey !== printPermitKey(permit) ||
        !verifiedEvidenceIsCurrent(permit)
      ) blockStalePrint();
    };
    const finishPrint = () => {
      const armed = printArmedRef.current;
      if (!armed) return;
      if (armed.routeKey !== routeKeyRef.current) {
        printArmedRef.current = null;
        return;
      }
      blockPdfNow("1회용 출력 허가 토큰을 사용했습니다. 다시 검증한 뒤 출력할 수 있습니다.");
      setEvidenceRevision((revision) => revision + 1);
    };

    window.addEventListener("keydown", preventPrintShortcut, true);
    window.addEventListener("beforeprint", guardBrowserPrint);
    window.addEventListener("afterprint", finishPrint);
    return () => {
      window.removeEventListener("keydown", preventPrintShortcut, true);
      window.removeEventListener("beforeprint", guardBrowserPrint);
      window.removeEventListener("afterprint", finishPrint);
    };
  }, [blockPdfNow, verifiedEvidenceIsCurrent]);

  const printWithOneUsePermit = useCallback(async () => {
    if (printAbortRef.current) return;
    const permit = printPermitRef.current;
    const requestedRouteKey = routeKeyRef.current;
    const requestedEpoch = flowEpochRef.current;
    const requestedPermitKey = permit ? printPermitKey(permit) : "";
    const latest = permit ? loadBundle(permit.clientId) : null;
    if (
      !permit ||
      !latest ||
      latest.id !== permit.evidenceId ||
      !verifiedEvidenceIsCurrent(permit)
    ) {
      blockPdfNow("출력 허가 토큰이 만료되었거나 상담 현재본과 일치하지 않습니다.");
      setEvidenceRevision((revision) => revision + 1);
      return;
    }

    const controller = new AbortController();
    printAbortRef.current = controller;
    setPrintBusy(true);
    const isCurrentAttempt = () => {
      const currentPermit = printPermitRef.current;
      return (
        !controller.signal.aborted &&
        isSamePrintAttempt(
          {
            epoch: requestedEpoch,
            routeKey: requestedRouteKey,
            permitKey: requestedPermitKey,
          },
          {
            epoch: flowEpochRef.current,
            routeKey: routeKeyRef.current,
            permitKey: currentPermit ? printPermitKey(currentPermit) : "",
          },
        )
      );
    };
    try {
      const res = await fetch("/api/advisory/verify", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId: permit.clientId,
          pbId: permit.pbId,
          evidenceId: permit.evidenceId,
          printToken: permit.token,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!isCurrentAttempt()) return;
      if (
        !res.ok ||
        !data.ok ||
        !data.permitted ||
        data.clientId !== permit.clientId ||
        data.pbId !== permit.pbId ||
        data.evidenceId !== permit.evidenceId ||
        data.verifiedInputHash !== permit.verifiedInputHash ||
        data.evidenceDigest !== permit.evidenceDigest
      ) {
        blockPdfNow(
          `출력 차단: ${data.reasons?.[0] || data.error || "1회용 출력 허가 토큰 검증에 실패했습니다."}`,
        );
        setEvidenceRevision((revision) => revision + 1);
        return;
      }
      if (!isCurrentAttempt() || !verifiedEvidenceIsCurrent(permit)) {
        blockPdfNow("출력 차단: 토큰 소비 중 고객·담당 PB·상담 현재본이 변경되었습니다.");
        setEvidenceRevision((revision) => revision + 1);
        return;
      }

      printArmedRef.current = {
        routeKey: requestedRouteKey,
        permitKey: requestedPermitKey,
      };
      try {
        if (!isCurrentAttempt() || !verifiedEvidenceIsCurrent(permit)) {
          printArmedRef.current = null;
          blockPdfNow("출력 차단: 인쇄 직전 고객·담당 PB·상담 현재본이 변경되었습니다.");
          setEvidenceRevision((revision) => revision + 1);
          return;
        }
        window.print();
      } finally {
        const armed = printArmedRef.current;
        if (
          armed &&
          armed.routeKey === requestedRouteKey &&
          armed.permitKey === requestedPermitKey &&
          routeKeyRef.current === requestedRouteKey
        ) {
          blockPdfNow("1회용 출력 허가 토큰을 사용했습니다. 다시 검증한 뒤 출력할 수 있습니다.");
          setEvidenceRevision((revision) => revision + 1);
        } else if (armed?.permitKey === requestedPermitKey) {
          printArmedRef.current = null;
        }
      }
    } catch (error) {
      if (controller.signal.aborted || !isCurrentAttempt()) return;
      blockPdfNow("출력 차단: 1회용 출력 허가 토큰 서비스에 연결할 수 없습니다.");
      setEvidenceRevision((revision) => revision + 1);
    } finally {
      const ownsController = printAbortRef.current === controller;
      if (ownsController) printAbortRef.current = null;
      if (ownsController && routeKeyRef.current === requestedRouteKey) setPrintBusy(false);
    }
  }, [blockPdfNow, verifiedEvidenceIsCurrent]);

  if (status === "loading") return <LoadingView />;
  if (status === "error" || !client)
    return <ErrorView message="고객 정보를 불러올 수 없습니다." onRetry={load} />;

  if (pdfBlocked || !printPermit || client.id !== clientId || !verifiedEvidenceIsCurrent(printPermit)) {
    return (
      <div className="pdf-output-gate mx-auto max-w-3xl">
        <div className="mb-4 print:hidden">
          <button
            type="button"
            className="btn-outline text-sm"
            onClick={() => router.push(`/pb/${pbId}/${clientId}`)}
          >
            ← 고객 상세
          </button>
        </div>
        <section
          className="rounded-xl border-2 border-red-300 bg-white p-5 shadow-card sm:p-8"
          role="alert"
          aria-labelledby="pdf-output-gate-title"
        >
          <span className="inline-flex rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">
            고객 문서 출력 차단
          </span>
          <h1 id="pdf-output-gate-title" className="mt-4 text-xl font-bold text-fg">
            검증 전에는 PDF 본문을 표시하지 않습니다
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">{pdfReason}</p>
          <p className="mt-3 rounded-lg bg-[#F0F3FA] p-3 text-xs leading-relaxed text-fg">
            Ctrl/Cmd+P는 차단됩니다. 브라우저 인쇄 메뉴를 열어도 고객 정보나 투자정책서 본문은 출력되지 않고 이 차단 안내만 표시됩니다.
          </p>
          <button
            type="button"
            className="mt-4 min-h-11 rounded-lg bg-[#2C3EE8] px-5 py-3 text-sm font-bold text-white opacity-60"
            disabled
          >
            인쇄·PDF 저장 차단
          </button>
        </section>
      </div>
    );
  }

  const documentClient = printPermit.clientSnapshot;
  const documentPbDisplay = printPermit.pbSnapshot.name;
  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
  const pf = documentClient.portfolios[0];
  const cashflowSummary = buildCashflowSummary(documentClient.cashFlows);
  const confirmedWeights = pf
    ? buildPortfolioViewModel(documentClient).portfolioOptions.find((option) => option.id === pf.id)?.weights
    : undefined;
  const displayAllocations = pf ? resolvePortfolioDisplayAllocations(pf, confirmedWeights) : [];
  const allocationChartData = displayAllocations.map((allocation) => ({
    name: allocation.assetClass,
    value: allocation.weight,
  }));
  const returnContributions = pf ? buildReturnContributionsFromPortfolio(displayAllocations, pf.expectedReturn) : [];
  const periodSeries = buildMonthlyCashflowSummarySeries(documentClient.cashFlows);
  const vmWeights = confirmedWeights ?? {
    etf: 30, bond: 25, els: 0, mmf: 30, gold: 10, dollar: 5, raw: 0,
  };
  const taxReady =
    isPortfolioWorkflowApproved(documentClient) && isFinancialIncomeReadyForTax(documentClient);
  const mergedTax = taxReady ? mergeTaxProfile(documentClient) : null;
  const taxWaterfall = taxReady && mergedTax
    ? projectTax({
        // 부동산 제외 투자가능자산 기준. 조회 전/실패 시 총자산으로 폴백.
        principalWon: investableWon ?? documentClient.assetSize,
        horizonYears: DEFAULT_HORIZON_YEARS,
        weights: vmWeights,
        expectedReturnPct: pf?.expectedReturn ?? 6,
        taxProfile: mergedTax.profile,
        cashFlows: documentClient.cashFlows,
        cashflowTaxSummary: mergedTax.cashflowSummary,
        label: pf?.label ?? "기준안",
      })
    : null;

  return (
    <div className="mx-auto max-w-3xl">
      {/* 상단 버튼 (인쇄 시 숨김) */}
      <div className="mb-4 flex items-center justify-between print:hidden">
        <button
          className="btn-outline text-sm"
          onClick={() => router.push(`/pb/${pbId}/${clientId}`)}
        >
          ← 고객 상세
        </button>
        <button
          className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pdfBlocked || printBusy}
          onClick={() => void printWithOneUsePermit()}
          aria-busy={printBusy}
        >
          {pdfBlocked ? "최종 PDF 비활성" : printBusy ? "출력 허가 확인 중…" : "🖨️ 인쇄 / PDF로 저장"}
        </button>
      </div>
      {printPermit?.mode === "local-self-consistency" && (
        <p className="mb-3 rounded-lg border border-[#DCE4F5] bg-[#F0F3FA] px-3 py-2 text-xs font-semibold text-[#1428A0]">
          로컬 자기일치 데모 · 운영 서버 검증이 아닙니다. 출력할 때 30초짜리 1회용 허가를 다시 확인합니다.
        </p>
      )}
      {pdfBlocked && (
        <p className="mb-3 text-xs font-semibold text-red-600 print:hidden">{pdfReason}</p>
      )}

      {/* ── 문서 본문 (항상 흰 배경·검은 글씨로 인쇄 친화) ── */}
      <div className="rounded-lg bg-white p-8 text-gray-900 shadow-card print:rounded-none print:p-0 print:shadow-none">
        {/* 헤더 */}
        <div className="border-b-2 border-gray-800 pb-4 text-center">
          <p className="text-xs font-semibold tracking-widest text-gray-500">
            SAMSUNG SECURITIES · PRIVATE BANKING
          </p>
          <h1 className="mt-1 text-2xl font-bold">투자정책서 (IPS)</h1>
          <p className="mt-1 text-xs text-gray-500">Investment Policy Statement</p>
        </div>

        <table className="mt-4 w-full text-sm">
          <tbody>
            <tr>
              <td className="w-24 py-1 text-gray-500">작성일</td>
              <td className="py-1 font-medium">{dateStr}</td>
              <td className="w-24 py-1 text-gray-500">문서번호</td>
              <td className="py-1 font-medium">IPS-{documentClient.code}</td>
            </tr>
          </tbody>
        </table>

        {/* 1. 고객 기본정보 */}
        <Section title="1. 고객 기본정보">
          <InfoGrid
            rows={[
              ["고객명", documentClient.name],
              ["구분", CLIENT_TYPE_LABEL[documentClient.clientType]],
              ["식별코드", documentClient.code],
              [
                documentClient.clientType === "corporate" ? "설립일" : "생년월일",
                formatDate(documentClient.birthDate),
              ],
              ["자산규모", formatKRW(documentClient.assetSize)],
              ["담당 PB", documentPbDisplay],
              ["연동 고객 ID", documentClient.linkedClientId ?? "없음"],
              [
                "지분/통장 상태",
                documentClient.accountSeparation
                  ? ACCOUNT_SEPARATION_LABEL[documentClient.accountSeparation]
                  : documentClient.ownershipPct != null
                    ? `${documentClient.ownershipPct}%${documentClient.isMajorityShareholder ? " · 최대주주" : ""}`
                    : "미입력",
              ],
            ]}
          />
        </Section>

        {/* 2. 투자성향 분석 (RRTTLLU 7요인) */}
        <Section title="2. 투자성향 분석 (RRTTLLU 7요인)">
          {/* PB 종합 분석 의견 */}
          <div className="mb-3 rounded border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
            <p className="mb-1 font-semibold text-gray-800">PB 종합 분석</p>
            {buildSummary(documentClient)}
          </div>

          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-300 text-left text-gray-500">
                <th className="w-28 py-1.5 pr-2">요인</th>
                <th className="py-1.5 pr-2">값 / 설명</th>
              </tr>
            </thead>
            <tbody>
              {FACTOR_META.map((m) => {
                const f = documentClient.ips[m.key];
                return (
                  <tr key={m.key} className="border-b border-gray-100 align-top">
                    <td className="py-1.5 pr-2 font-semibold">{m.label}</td>
                    <td className="py-1.5 pr-2">
                      {f.value || (
                        <span className="text-gray-400">
                          {f.status === "inferred" ? `참고: ${f.inferenceHint}` : "미언급"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>

        {/* 3. 현금흐름 요약 및 세금 납부 일정 */}
        <Section title="3. 현금흐름 요약 및 세금 납부 일정">
          {documentClient.cashFlows.length === 0 ? (
            <p className="text-xs text-gray-400">등록된 현금흐름이 없습니다.</p>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <MetricCard label="월 총소득" value={formatManwon(cashflowSummary.recurringIn)} />
                <MetricCard label="월 총지출" value={formatManwon(cashflowSummary.recurringOut)} tone="danger" />
                <MetricCard
                  label="월 순현금흐름"
                  value={formatManwon(cashflowSummary.monthlyNet)}
                  tone={cashflowSummary.monthlyNet < 0 ? "danger" : "normal"}
                />
                <MetricCard label="현재 현금성자산" value={formatManwon(cashflowSummary.currentCashWon)} />
              </div>

              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-300 text-left text-gray-500">
                    <th className="py-1.5">구분</th>
                    <th className="py-1.5">항목</th>
                    <th className="py-1.5 text-right">월/연 금액(만원)</th>
                  </tr>
                </thead>
                <tbody>
                  {cashflowSummary.summaryRows.map((row) => (
                    <tr key={row.group} className="border-b border-gray-100">
                      <td className="py-1.5 font-semibold">{row.group}</td>
                      <td className="py-1.5 text-gray-600">{row.item}</td>
                      <td className={`py-1.5 text-right font-medium ${row.annualizedAmount < 0 ? "text-red-600" : "text-gray-900"}`}>
                        {row.annualizedAmount < 0 ? "−" : "+"}
                        {formatManwon(Math.abs(row.annualizedAmount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="rounded border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-gray-800">고액자산가 세금 납부 및 현금화 일정</p>
                  <TaxReadinessRubricButton
                    label="준비상태 기준표"
                    className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-bold text-gray-500 hover:border-gray-600 hover:text-gray-900 print:hidden"
                  />
                </div>
                {cashflowSummary.taxSchedule.length === 0 ? (
                  <p className="text-gray-400">세금성 이벤트가 입력되지 않았습니다.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-gray-500">
                        <th className="py-1">세금/이벤트</th>
                        <th className="py-1 text-right">예상세액(만원)</th>
                        <th className="py-1">납부기한</th>
                        <th className="py-1">현금화 목표일</th>
                        <th className="py-1 text-center">준비상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashflowSummary.taxSchedule.map((event) => (
                        <tr key={event.id} className="border-b border-gray-200 last:border-0">
                          <td className="py-1">
                            <p className="font-medium">{event.label}</p>
                            <p className="mt-0.5 max-w-[300px] text-[10px] leading-snug text-gray-500">
                              {event.readiness.reason}
                            </p>
                          </td>
                          <td className="py-1 text-right font-medium">{formatManwon(event.amountWon)}</td>
                          <td className="py-1 text-gray-500">{event.dueDate}</td>
                          <td className="py-1 text-gray-500">{event.cashReadyDate}</td>
                          <td className="py-1 text-center">
                            <StatusBadge status={event.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded border border-gray-200 p-3">
                  <p className="mb-2 font-semibold text-gray-800">재무목표</p>
                  <table className="w-full">
                    <tbody>
                      {(cashflowSummary.goals.length ? cashflowSummary.goals : [{ goal: "현금화 목표 미입력", targetDate: "미정", amount: 0, priority: "점검", note: "상담 시 목표금액/시점 확인" }]).map((goal) => (
                        <tr key={`${goal.goal}-${goal.targetDate}`} className="border-b border-gray-100 last:border-0">
                          <td className="py-1">
                            <b>{goal.goal}</b>
                            <span className="ml-2 text-gray-400">{goal.targetDate}</span>
                          </td>
                          <td className="py-1 text-right">
                            {formatManwon(goal.amount)}
                            <span className="ml-2 text-gray-400">{goal.priority}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rounded border border-gray-200 p-3">
                  <p className="mb-2 font-semibold text-gray-800">주요 현금흐름 일정</p>
                  <table className="w-full">
                    <tbody>
                      {cashflowSummary.upcoming.map((flow) => (
                        <tr key={flow.id} className="border-b border-gray-100 last:border-0">
                          <td className="py-1 text-gray-500">{flow.date || "시점 미정"}</td>
                          <td className="py-1">{flow.label || "(항목)"}</td>
                          <td className={`py-1 text-right font-medium ${flow.amount < 0 ? "text-red-600" : "text-gray-900"}`}>
                            {flow.amount < 0 ? "−" : "+"}
                            {formatManwon(Math.abs(flow.amount))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-[10px] text-gray-400">
                ※ 현금흐름은 상담 입력 기준의 추정치입니다. 세금·비용처리·법인/개인 자금 이동은 세무 전문가 확인이 필요합니다.
              </p>
            </div>
          )}
        </Section>

        {/* 4. 확정 포트폴리오 */}
        <Section title="4. 확정 포트폴리오">
          {!pf ? (
            <p className="text-xs text-gray-400">
              확정된 포트폴리오가 없습니다. (포트폴리오 단계에서 최종 확정 필요)
            </p>
          ) : (
            <div>
              <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>
                  <b>유형</b> {pf.label}
                </span>
                <span>
                  <b>예상수익률</b> {pf.expectedReturn}%
                </span>
                <span>
                  <b>예상변동성</b> {pf.expectedRisk}%
                </span>
              </div>
              <p className="mb-3 text-[10px] leading-relaxed text-gray-500">
                수익률은 시장 proxy 연결 전 fallback 기반 참고 추정치이며, 미래 성과 또는 벤치마크 초과수익을 의미하지 않습니다.
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded border border-gray-200 p-3">
                  <p className="mb-2 text-xs font-semibold text-gray-700">{portfolioTypeOnlyLabel(pf)}</p>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={allocationChartData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={46}
                          outerRadius={76}
                          paddingAngle={2}
                        >
                          {allocationChartData.map((entry, index) => (
                            <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: unknown) => `${Number(value).toFixed(1)}%`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
                    {allocationChartData.map((entry, index) => (
                      <div key={entry.name} className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                        <span className="text-gray-600">
                          {entry.name} {entry.value}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded border border-gray-200 p-3">
                  <p className="mb-2 text-xs font-semibold text-gray-700">자산군별 수익률 기여도</p>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={returnContributions} layout="vertical" margin={{ top: 4, right: 28, bottom: 0, left: 8 }}>
                        <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" unit="%p" tick={{ fontSize: 9, fill: "#6b7280" }} />
                        <YAxis type="category" dataKey="name" width={64} tick={{ fontSize: 9, fill: "#6b7280" }} />
                        <Tooltip formatter={(value: unknown) => `${Number(value).toFixed(2)}%p`} />
                        <Bar dataKey="contributionPct" name="기여도" radius={[0, 3, 3, 0]}>
                          {returnContributions.map((entry, index) => (
                            <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-0.5 text-[10px]">
                    {returnContributions.map((c) => (
                      <div key={c.name} className="flex items-center justify-between text-gray-600">
                        <span>{c.name}</span>
                        <span>
                          {c.weightPct}% × {c.appliedReturnPct}% ={" "}
                          <b className="text-gray-800">{c.contributionPct}%p</b>
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-gray-400">
                    각 자산군 비중 × 적용 연수익률의 기여도이며, 합계는 예상수익률 {pf.expectedReturn}%와 일치합니다. 시장 proxy 기반 참고치로 미래 성과를 보장하지 않습니다.
                  </p>
                </div>
              </div>
              <table className="mt-3 w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-300 text-left text-gray-500">
                    <th className="py-1.5">자산군</th>
                    <th className="py-1.5 text-right">비중</th>
                  </tr>
                </thead>
                <tbody>
                  {displayAllocations.map((a, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-1.5">{a.assetClass}</td>
                      <td className="py-1.5 text-right font-medium">{a.weight}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pf.taxNote && <p className="mt-2 text-xs text-gray-600">세금: {pf.taxNote}</p>}
              {pf.rationale && (
                <p className="mt-1 text-xs leading-relaxed text-gray-600">근거: {pf.rationale}</p>
              )}
            </div>
          )}
        </Section>

        {periodSeries.length >= 2 && (
          <Section title="부록. 월별 간소화 현금흐름">
            <div className="space-y-3 text-xs">
              <div className="rounded border border-gray-200 p-3">
                <p className="mb-1 font-semibold text-gray-800">월별 현금흐름 추이</p>
                <p className="mb-2 text-[10px] text-gray-500">총유입·총유출(세금 제외)·총세금·순자금 (만원)</p>
                <PeriodCashflowLineChart series={periodSeries} className="h-80" />
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-300 text-left text-gray-500">
                    <th className="py-1.5">기간</th>
                    <th className="py-1.5 text-right">총유입</th>
                    <th className="py-1.5 text-right">총유출(세금 제외)</th>
                    <th className="py-1.5 text-right">총세금</th>
                    <th className="py-1.5 text-right">순자금</th>
                    <th className="py-1.5 text-right">누적</th>
                  </tr>
                </thead>
                <tbody>
                  {periodSeries.map((point) => (
                    <tr key={point.period} className="border-b border-gray-100">
                      <td className="py-1.5 font-semibold">{point.period}</td>
                      <td className="py-1.5 text-right">{formatManwon(point.incomeWon)}</td>
                      <td className="py-1.5 text-right text-red-600">{formatManwon(point.outflowWon + point.savingWon)}</td>
                      <td className="py-1.5 text-right">{formatManwon(point.taxWon)}</td>
                      <td className={`py-1.5 text-right font-medium ${point.netWon < 0 ? "text-red-600" : "text-gray-900"}`}>
                        {formatManwon(point.netWon)}
                      </td>
                      <td className={`py-1.5 text-right font-medium ${point.cumulativeNetWon < 0 ? "text-red-600" : "text-gray-900"}`}>
                        {formatManwon(point.cumulativeNetWon)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-gray-400">
                ※ 총유출은 세금을 제외한 생활비·운영비·투자성 유출을 합산한 값입니다. 총세금은 별도 컬럼으로 분리했습니다. 순자금 = 총유입 − 총유출 − 총세금.
              </p>
            </div>
          </Section>
        )}

        <Section title="세전·세금·비용·세후 결과">
          {taxWaterfall ? (
            <>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-gray-100">
                    <td className="py-1.5">세전 기말자산</td>
                    <td className="py-1.5 text-right font-semibold">{formatKRW(taxWaterfall.principalWon + taxWaterfall.grossReturnWon)}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="py-1.5">예상 세금</td>
                    <td className="py-1.5 text-right">−{formatKRW(taxWaterfall.taxes.totalTaxWon)}</td>
                  </tr>
                  {taxWaterfall.taxes.overseasCapitalGainTaxWon > 0 && (
                    <tr className="border-b border-gray-100">
                      <td className="py-1.5 pl-4 text-gray-600">└ 해외주식 양도소득세</td>
                      <td className="py-1.5 text-right text-gray-600">−{formatKRW(taxWaterfall.taxes.overseasCapitalGainTaxWon)}</td>
                    </tr>
                  )}
                  {taxWaterfall.taxes.comprehensiveTaxWon > 0 && (
                    <tr className="border-b border-gray-100">
                      <td className="py-1.5 pl-4 text-gray-600">└ 금융소득 종합과세</td>
                      <td className="py-1.5 text-right text-gray-600">−{formatKRW(taxWaterfall.taxes.comprehensiveTaxWon)}</td>
                    </tr>
                  )}
                  <tr className="border-b border-gray-100">
                    <td className="py-1.5">상품/거래 비용</td>
                    <td className="py-1.5 text-right">−{formatKRW(taxWaterfall.feesWon)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 font-bold">세후 기말자산</td>
                    <td className="py-1.5 text-right font-bold">{formatKRW(taxWaterfall.netEndingWon)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-1 text-[10px] text-gray-500">
                기준일 {dateStr} · 통화 KRW · {taxWaterfall.assumptions[0]}
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-600">포트폴리오 확정 후 세전·세후 계산이 가능합니다.</p>
          )}
        </Section>

        {/* 디스클레이머 */}
        <div className="mt-6 rounded border border-gray-300 bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-600">
          ※ 본 투자정책서는 PB 상담 내용을 구조화한 <b>참고용 문서</b>이며 투자 권유가 아닙니다.
          포트폴리오·스트레스 결과는 통계적 추정치로 미래 수익을 보장하지 않으며, 실제 투자 결정 및
          {HONESTY_LIMITS.map((line) => (
            <span key={line}> {line}</span>
          ))}
        </div>

        {/* 서명란 */}
        <div className="mt-8 grid grid-cols-2 gap-8 text-sm">
          <div>
            <p className="mb-8 text-gray-500">담당 PB</p>
            <div className="border-t border-gray-400 pt-1 text-center text-xs text-gray-500">
              (서명)
            </div>
          </div>
          <div>
            <p className="mb-8 text-gray-500">고객</p>
            <div className="border-t border-gray-400 pt-1 text-center text-xs text-gray-500">
              {documentClient.name} (서명)
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-[10px] text-gray-400">
          삼성증권 PB센터 · {dateStr} 생성
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h2 className="mb-2 border-l-4 border-gray-800 pl-2 text-base font-bold">{title}</h2>
      {children}
    </div>
  );
}

function InfoGrid({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([k, v], i) =>
          i % 2 === 0 ? (
            <tr key={i} className="border-b border-gray-100">
              <td className="w-28 py-1.5 text-gray-500">{rows[i][0]}</td>
              <td className="py-1.5 font-medium">{rows[i][1]}</td>
              <td className="w-28 py-1.5 text-gray-500">{rows[i + 1]?.[0] ?? ""}</td>
              <td className="py-1.5 font-medium">{rows[i + 1]?.[1] ?? ""}</td>
            </tr>
          ) : null,
        )}
      </tbody>
    </table>
  );
}

function MetricCard({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "danger";
}) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
      <p className="text-[10px] font-semibold text-gray-500">{label}</p>
      <p className={`mt-1 text-sm font-bold ${tone === "danger" ? "text-red-600" : "text-gray-900"}`}>
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: TaxPaymentEvent["status"] }) {
  const label = status === "covered" ? "커버" : status === "watch" ? "점검" : "부족";
  const cls =
    status === "covered"
      ? "border-green-200 bg-green-50 text-green-700"
      : status === "watch"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-red-200 bg-red-50 text-red-700";
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>;
}

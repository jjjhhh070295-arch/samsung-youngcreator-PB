"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Client } from "@/lib/types";
import { computeStages } from "@/lib/types";
import { getClient } from "@/lib/store";
import { formatKRW, formatDate } from "@/lib/format";
import IPSRadar from "@/components/IPSRadar";
import IPSSummary from "@/components/IPSSummary";
import { LoadingView, ErrorView } from "@/components/StateViews";

type Lang = "ko" | "en";

// 정적 UI 문구 번역 (실제 입력 값/근거는 원문 그대로 표시)
const T = {
  ko: {
    clientView: "고객 화면",
    pbView: "PB 화면 →",
    backToPb: "← PB 화면으로",
    disclaimer: "본 화면은 상담 내용 요약입니다. 투자 권유가 아니며, 참고용입니다.",
    assets: "자산규모",
    dob: "생년월일",
    established: "설립일",
    progress: "상담 진행 현황",
    steps: ["기본 정보", "7요인 분석", "현금흐름", "포트폴리오", "스트레스 테스트", "IPS 문서"],
    profileTitle: "나의 투자성향 한눈에 보기",
    summaryTitle: "투자성향 요약",
    notReady: "아직 투자성향(7요인) 정리가 완료되지 않았습니다. PB와 상담 후 표시됩니다.",
    cashflow: "예상 현금흐름",
    item: "(항목)",
    dateTbd: "시점 미정",
    recurring: "정기",
    portfolios: "추천 포트폴리오",
    expReturn: "예상 수익",
    expRisk: "예상 변동성",
    portfolioNote: "※ 참고용이며 투자 권유가 아닙니다. PB 검토를 전제로 한 예시입니다.",
    stress: "스트레스 테스트 (예시)",
    maxDrawdown: "예상 최대낙폭",
    stressNote: "※ 더미(예시) 결과입니다. 실제 검정은 PB·운용팀이 수행합니다.",
    ipsTitle: "투자정책서(IPS)가 준비되었습니다",
    ipsDesc: "7요인 분석과 포트폴리오 구성을 반영한 투자정책서 예시입니다. (PDF 출력은 추후 제공)",
    ipsBtn: "IPS 문서 보기 (예시)",
    ipsAlert: "IPS 문서 PDF 출력은 준비 중입니다 (더미).",
  },
  en: {
    clientView: "Client View",
    pbView: "PB View →",
    backToPb: "← Back to PB View",
    disclaimer: "This screen summarizes the consultation. Not investment advice; for reference only.",
    assets: "Assets",
    dob: "Date of Birth",
    established: "Established",
    progress: "Consultation Progress",
    steps: ["Basic Info", "7 Factors", "Cash Flow", "Portfolio", "Stress Test", "IPS Document"],
    profileTitle: "My Investment Profile at a Glance",
    summaryTitle: "Profile Summary",
    notReady: "Your investment profile (7 factors) is not finalized yet. It will appear after consultation.",
    cashflow: "Expected Cash Flow",
    item: "(item)",
    dateTbd: "Date TBD",
    recurring: "Recurring",
    portfolios: "Recommended Portfolios",
    expReturn: "Exp. Return",
    expRisk: "Exp. Risk",
    portfolioNote: "※ For reference only, not investment advice. Examples subject to PB review.",
    stress: "Stress Test (Example)",
    maxDrawdown: "Est. max drawdown",
    stressNote: "※ Dummy (example) results. Actual testing is performed by the PB / investment team.",
    ipsTitle: "Your Investment Policy Statement (IPS) is ready",
    ipsDesc: "An example IPS reflecting the 7-factor analysis and portfolio. (PDF export coming soon)",
    ipsBtn: "View IPS Document (example)",
    ipsAlert: "IPS PDF export is under preparation (dummy).",
  },
} as const;

const SCENARIOS = {
  ko: [
    { name: "금리 +2%p", drawdown: "-6%" },
    { name: "주식 -30%", drawdown: "-12%" },
    { name: "인플레 급등", drawdown: "-5%" },
  ],
  en: [
    { name: "Rate +2%p", drawdown: "-6%" },
    { name: "Equity -30%", drawdown: "-12%" },
    { name: "Inflation Spike", drawdown: "-5%" },
  ],
};

const ASSET_EN: Record<string, string> = {
  국내주식: "Domestic Equity",
  해외주식: "Global Equity",
  채권: "Bonds",
  대체투자: "Alternatives",
  현금: "Cash",
};

export default function ClientView() {
  const { clientId } = useParams<{ clientId: string }>();
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [lang, setLang] = useState<Lang>("ko");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const c = await getClient(clientId);
      if (!c) return setStatus("error");
      setClient(c);
      setStatus("ready");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  if (status === "loading") return <LoadingView />;
  if (status === "error" || !client)
    return <ErrorView message="고객 정보를 불러올 수 없습니다." onRetry={load} />;

  const t = T[lang];
  const en = lang === "en";
  const assetLabel = (a: string) => (en ? ASSET_EN[a] ?? a : a);

  const done = computeStages(client);
  const has7Factor = done.factors;
  const hasCashFlow = done.cashflow;
  const hasPortfolio = done.portfolio;
  const hasStress = done.stress;
  const hasIps = done.ips;

  const steps = t.steps.map((label, i) => ({
    label,
    done: [done.basic, has7Factor, hasCashFlow, hasPortfolio, hasStress, hasIps][i],
  }));

  const goPb = () =>
    router.push(
      client.assignedPbId ? `/pb/${client.assignedPbId}/${client.id}` : `/`,
    );

  return (
    <div className="space-y-6">
      {/* 상단 바: 라벨 + 언어 토글 + PB 화면 전환 */}
      <div className="flex items-center justify-between gap-3">
        <span className="badge-gold">{t.clientView}</span>
        <div className="flex items-center gap-2">
          {/* 한국어/영어 토글 */}
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {(["ko", "en"] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  lang === l
                    ? "bg-navy-800 text-white dark:bg-navy-600"
                    : "bg-surface text-fg-muted hover:text-fg"
                }`}
              >
                {l === "ko" ? "한국어" : "ENG"}
              </button>
            ))}
          </div>
          <button className="btn-primary text-sm" onClick={goPb}>
            {t.pbView}
          </button>
        </div>
      </div>

      {/* 디스클레이머 */}
      <div className="rounded-lg border border-border bg-surface-2 px-4 py-2 text-center text-xs text-fg-muted">
        {t.disclaimer}
      </div>

      {/* 기본 정보 */}
      <div className="text-center">
        <p className="text-sm text-fg-muted">{client.code}</p>
        <h1 className="mt-1 text-3xl font-bold text-fg">
          {client.name}
          {en ? "" : " 님"}
        </h1>
        <p className="mt-2 text-fg-muted">
          {t.assets}{" "}
          <b className="text-2xl text-gold-500 dark:text-gold-300">
            {formatKRW(client.assetSize)}
          </b>
        </p>
        <p className="mt-1 text-xs text-fg-muted">
          {client.clientType === "corporate" ? t.established : t.dob}{" "}
          {formatDate(client.birthDate)}
        </p>
      </div>

      {/* 진행 현황 스텝퍼 */}
      <div className="card p-5">
        <h2 className="mb-4 text-center text-sm font-semibold text-fg-muted">{t.progress}</h2>
        <ol className="flex flex-wrap items-center justify-center gap-x-2 gap-y-3">
          {steps.map((s, i) => (
            <li key={s.label} className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-1">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
                    s.done
                      ? "bg-gold-500 text-navy-900"
                      : "border border-border bg-surface-2 text-fg-muted"
                  }`}
                >
                  {s.done ? "✓" : i + 1}
                </span>
                <span
                  className={`text-[11px] ${s.done ? "font-medium text-fg" : "text-fg-muted"}`}
                >
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <span className={`mb-4 h-px w-5 ${s.done ? "bg-gold-400" : "bg-border"}`} />
              )}
            </li>
          ))}
        </ol>
      </div>

      {/* 7요인 */}
      {has7Factor ? (
        <>
          <div className="card p-5">
            <h2 className="mb-2 text-center text-sm font-semibold text-fg-muted">
              {t.profileTitle}
            </h2>
            <IPSRadar ips={client.ips} height={300} lang={lang} />
          </div>
          <div>
            <h2 className="mb-3 text-sm font-semibold text-fg-muted">{t.summaryTitle}</h2>
            <IPSSummary ips={client.ips} lang={lang} />
          </div>
        </>
      ) : (
        <div className="card p-6 text-center text-sm text-fg-muted">{t.notReady}</div>
      )}

      {/* 현금흐름 */}
      {hasCashFlow && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-fg-muted">{t.cashflow}</h2>
          <div className="card divide-y divide-border">
            {client.cashFlows.map((cf) => (
              <div key={cf.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-fg">
                  {cf.label || t.item}
                  <span className="ml-2 text-xs text-fg-muted">
                    {cf.date || t.dateTbd}
                    {cf.recurring && ` · ${t.recurring}`}
                  </span>
                </span>
                <span
                  className={`font-semibold ${
                    cf.amount < 0 ? "text-red-500" : "text-gold-600 dark:text-gold-300"
                  }`}
                >
                  {cf.amount < 0 ? "−" : "+"}
                  {formatKRW(Math.abs(cf.amount))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 포트폴리오 */}
      {hasPortfolio && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-fg-muted">{t.portfolios}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {client.portfolios.map((p) => (
              <div key={p.id} className="card p-4">
                <p className="text-base font-bold text-fg">{p.label}</p>
                <div className="mt-2 flex justify-between text-xs">
                  <span className="text-fg-muted">{t.expReturn}</span>
                  <span className="font-semibold text-gold-600 dark:text-gold-300">
                    {p.expectedReturn}%
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-fg-muted">{t.expRisk}</span>
                  <span className="font-semibold text-fg">{p.expectedRisk}%</span>
                </div>
                <div className="mt-3 space-y-1">
                  {p.allocations.map((a, i) => (
                    <div key={i} className="text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-fg-muted">{assetLabel(a.assetClass)}</span>
                        <span className="text-fg">{a.weight}%</span>
                      </div>
                      <div className="mt-0.5 h-1.5 rounded-full bg-surface-2">
                        <div
                          className="h-1.5 rounded-full bg-gold-400"
                          style={{ width: `${Math.min(100, a.weight)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-center text-[11px] text-fg-muted">{t.portfolioNote}</p>
        </div>
      )}

      {/* 스트레스 테스트 (더미) */}
      {hasStress && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-fg-muted">{t.stress}</h2>
          <div className="card divide-y divide-border">
            {SCENARIOS[lang].map((s) => (
              <div key={s.name} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-fg">{s.name}</span>
                <span className="font-semibold text-red-500">
                  {t.maxDrawdown} {s.drawdown}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-center text-[11px] text-fg-muted">{t.stressNote}</p>
        </div>
      )}

      {/* IPS 문서 (더미) */}
      {hasIps && (
        <div className="card flex flex-col items-center gap-3 p-6 text-center">
          <span className="text-3xl">📄</span>
          <p className="text-base font-bold text-fg">{t.ipsTitle}</p>
          <p className="max-w-md text-sm text-fg-muted">{t.ipsDesc}</p>
          <button className="btn-outline text-sm" onClick={() => alert(t.ipsAlert)}>
            {t.ipsBtn}
          </button>
        </div>
      )}

      <div className="text-center">
        <button className="btn-outline text-sm" onClick={goPb}>
          {t.backToPb}
        </button>
      </div>
    </div>
  );
}

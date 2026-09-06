"use client";

/**
 * 고객 대면 화면 — /client/[clientId] 와 PB 상세 「고객화면」 탭에서 공용.
 * PB 전용(Judge/Evidence/해시/파이프라인 제어) 문구는 넣지 않는다.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Client } from "@/lib/types";
import { CLIENT_TYPE_LABEL, computeStages } from "@/lib/types";
import { formatKRW, formatDate } from "@/lib/format";
import IPSRadar from "@/components/IPSRadar";
import IPSSummary from "@/components/IPSSummary";
import {
  isIpsWorkflowApproved,
  isPortfolioWorkflowApproved,
} from "@/lib/advisory/workflowApprovals";

type Lang = "ko" | "en";

const T = {
  ko: {
    clientView: "고객화면",
    pbView: "PB 화면 →",
    backToPb: "← PB 화면으로",
    disclaimer: "본 화면은 상담 내용 요약입니다. 투자 권유가 아니며, 참고용입니다.",
    assets: "투자가능자산",
    dob: "생년월일",
    established: "설립일",
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
    stress: "시장 변동 시나리오 (예시)",
    maxDrawdown: "예상 최대낙폭",
    stressNote: "※ 예시 결과입니다. 실제 검정은 상담 과정에서 함께 확인합니다.",
    ipsTitle: "투자정책서(IPS)가 준비되었습니다",
    ipsDesc: "투자성향과 포트폴리오 구성을 반영한 투자정책 요약입니다.",
    draftTitle: "고객화면 미리보기",
    draftDesc: "최종 확정 전 검토용 화면입니다.",
    blocked:
      "고객화면을 표시하려면 포트폴리오 승인과 IPS 검토가 필요합니다.",
  },
  en: {
    clientView: "Client View",
    pbView: "PB View →",
    backToPb: "← Back to PB View",
    disclaimer: "This screen summarizes the consultation. Not investment advice; for reference only.",
    assets: "Investable Assets",
    dob: "Date of Birth",
    established: "Established",
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
    stress: "Market Scenarios (Example)",
    maxDrawdown: "Est. max drawdown",
    stressNote: "※ Example results for discussion during consultation.",
    ipsTitle: "Your Investment Policy Statement (IPS) is ready",
    ipsDesc: "A summary reflecting your investment profile and portfolio.",
    draftTitle: "Client view preview",
    draftDesc: "For review before final confirmation.",
    blocked: "Portfolio approval and IPS review are required to show the client view.",
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
  국내채권: "Domestic Bond",
  해외채권: "Global Bond",
  "상품·대체": "Alternatives",
  현금성: "Cash",
};

interface Props {
  client: Client;
  /** PB 상세 탭에 임베드할 때 true — PB 전환 버튼 숨김 */
  embedded?: boolean;
  /**
   * 부동산 제외 투자가능자산(원). 부모가 이미 resolveAssetBreakdown 을 부르고 있으면
   * 그 값을 넘겨 중복 조회를 피한다. 없으면 총자산(assetSize)으로 폴백한다 —
   * 고객이 직접 보는 화면이라 PB 화면과 다른 숫자가 뜨면 바로 질문이 된다.
   */
  investableWon?: number | null;
}

export default function ClientFacingView({ client, embedded = false, investableWon = null }: Props) {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>("ko");

  const t = T[lang];
  const en = lang === "en";
  const assetLabel = (a: string) => (en ? ASSET_EN[a] ?? a : a);
  const dateLabel = client.clientType === "corporate" ? t.established : t.dob;

  const portfolioReady = isPortfolioWorkflowApproved(client);
  const ipsReady = isIpsWorkflowApproved(client);
  const isDraft = portfolioReady && !ipsReady;

  if (!portfolioReady) {
    return (
      <div className="card flex flex-col items-center gap-3 p-10 text-center">
        <span className="text-3xl" aria-hidden="true">🔒</span>
        <p className="text-base font-bold text-fg">{t.blocked}</p>
      </div>
    );
  }

  const done = computeStages(client);
  const has7Factor =
    done.factors || Object.values(client.ips ?? {}).some((f) => (f?.value || "").trim());
  const hasCashFlow = (client.cashFlows?.length ?? 0) > 0;
  const hasPortfolio = (client.portfolios?.length ?? 0) > 0;
  const hasStress = done.stress || isPortfolioWorkflowApproved(client);

  const goPb = () =>
    router.push(client.assignedPbId ? `/pb/${client.assignedPbId}/${client.id}` : `/`);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <span className="badge-gold">{t.clientView}</span>
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {(["ko", "en"] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
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
          {!embedded && (
            <button type="button" className="btn-primary text-sm" onClick={goPb}>
              {t.pbView}
            </button>
          )}
        </div>
      </div>

      {isDraft && (
        <div className="rounded-lg border border-[#DCE4F5] bg-[#F0F3FA] px-4 py-3">
          <p className="text-sm font-bold text-[#1428A0]">{t.draftTitle}</p>
          <p className="mt-0.5 text-xs text-fg-muted">{t.draftDesc}</p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface-2 px-4 py-2 text-center text-xs text-fg-muted">
        {t.disclaimer}
      </div>

      <div className="text-center">
        <p className="text-sm text-fg-muted">{client.code}</p>
        <h1 className="mt-1 text-3xl font-bold text-fg">
          {client.name}
          {en ? "" : " 님"}
        </h1>
        <p className="mt-2 text-fg-muted">
          {t.assets}{" "}
          <b className="text-2xl text-gold-500 dark:text-gold-300">{formatKRW(investableWon ?? client.assetSize)}</b>
        </p>
        <p className="mt-1 text-xs text-fg-muted">
          {en ? "Type" : "구분"} {CLIENT_TYPE_LABEL[client.clientType]} · {dateLabel}{" "}
          {formatDate(client.birthDate)}
        </p>
      </div>

      {has7Factor ? (
        <>
          <div className="card p-5">
            <h2 className="mb-2 text-center text-sm font-semibold text-fg-muted">{t.profileTitle}</h2>
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

      {hasPortfolio && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-fg-muted">{t.portfolios}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                {p.taxNote?.trim() && (
                  <p className="mt-3 text-[11px] text-fg-muted">{p.taxNote}</p>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-center text-[11px] text-fg-muted">{t.portfolioNote}</p>
        </div>
      )}

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

      {ipsReady && (
        <div className="card flex flex-col items-center gap-3 p-6 text-center">
          <span className="text-3xl" aria-hidden="true">📄</span>
          <p className="text-base font-bold text-fg">{t.ipsTitle}</p>
          <p className="max-w-md text-sm text-fg-muted">{t.ipsDesc}</p>
        </div>
      )}

      {!embedded && (
        <div className="text-center">
          <button type="button" className="btn-outline text-sm" onClick={goPb}>
            {t.backToPb}
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { calculateRiskReward } from "@/lib/advisory/krTrendFilter";
import type { PbSelectedKoreanStock } from "@/lib/advisory/krTrendPortfolio";

type Tech = {
  passed: boolean;
  ma20Above10d: { passed: boolean; ratioLabel: string; daysAbove: number; lookback: number };
  bullish20d: { passed: boolean; ratioLabel: string; bullishDays: number; lookback: number };
  consecutiveBullish: { passed: boolean; consecutive: number; required: number };
};

type Theme = {
  passed: boolean;
  themeName: string;
  evidence: string;
  source: string;
  asOf: string;
  status: "pass" | "review" | "blocked";
};

export type KrTrendCandidateView = {
  ticker: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
  marketCapWon: number | null;
  marketCapLabel: string;
  marketCapAsOf: string;
  marketCapSource: string;
  marketCapStatus: "ok" | "below_floor" | "unverifiable";
  market: "KOSPI" | "KOSDAQ";
  rank: number;
  asOf: string;
  source: string;
  currency: "KRW";
  technical: Tech | null;
  technicalError: string | null;
  theme: Theme | null;
  isFinalCandidate: boolean;
};

type RrDraft = {
  seedWon: string;
  stopLoss: string;
  takeProfit: string;
};

function fmtWon(n: number) {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

// standalone(자체 관리) 모드 전용 — onCheckedConfirmedChange 없이 clientId만 받는 기존
// 호출부(PortfolioPanel.tsx, "포트폴리오" 탭)를 위한 레거시 키. ManualPortfolioBuilder는
// 더 이상 이 키를 쓰지 않고 부모 초안(draft) 하나에 합류한다.
function checkedKey(clientId: string) {
  return `pb-kr-trend-checked-${clientId}`;
}
function confirmedKey(clientId: string) {
  return `pb-kr-trend-confirmed-${clientId}`;
}

export default function KoreanStockTrendFilter({
  clientId,
  equityWeightPct,
  onSelectionChange,
  embedded = false,
  initialChecked,
  initialConfirmed,
  onCheckedConfirmedChange,
}: {
  /** standalone 모드(onCheckedConfirmedChange 미전달)에서만 자체 localStorage 키로 쓰인다. */
  clientId?: string;
  equityWeightPct: number;
  /** 확정된 종목만 전달. 미확정이면 selected=[] equityPending=true */
  onSelectionChange: (selected: PbSelectedKoreanStock[], equityPending: boolean) => void;
  /** 자산군별 종목 검색·선택 안에 넣을 때 true */
  embedded?: boolean;
  /**
   * 체크·확정 상태의 초기값. onCheckedConfirmedChange를 함께 전달하는 "제어" 모드
   * (ManualPortfolioBuilder)에서 부모가 DB/로컬 초안에서 복원해 넣어준다.
   */
  initialChecked?: string[];
  initialConfirmed?: PbSelectedKoreanStock[];
  /**
   * 전달하면 "제어" 모드로 동작 — 체크·확정 상태를 자체 저장하지 않고 매 변경마다 이
   * 콜백으로만 알린다(부모의 초안에 합류). 전달하지 않으면 기존처럼 clientId 기준
   * 자체 localStorage에 복원·저장한다("standalone" 모드, PortfolioPanel.tsx).
   */
  onCheckedConfirmedChange?: (checked: string[], confirmed: PbSelectedKoreanStock[]) => void;
}) {
  const standalone = !onCheckedConfirmedChange;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [meta, setMeta] = useState<{
    asOf: string;
    source: string;
    finalCount: number;
    universeSize?: number;
    marketCapFloorWon?: number;
  } | null>(null);
  const [candidates, setCandidates] = useState<KrTrendCandidateView[]>([]);
  const [unverifiable, setUnverifiable] = useState<KrTrendCandidateView[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const next: Record<string, boolean> = {};
    for (const t of initialChecked ?? []) next[t] = true;
    return next;
  });
  const [confirmed, setConfirmed] = useState<PbSelectedKoreanStock[]>(() => initialConfirmed ?? []);
  const [rr, setRr] = useState<Record<string, RrDraft>>({});
  const [onlyFinal, setOnlyFinal] = useState(true);
  const [hydrated, setHydrated] = useState(!standalone);

  // standalone 모드에서만 자체 localStorage에서 복원한다 — 제어 모드는 initialChecked/
  // initialConfirmed의 lazy 초기값으로 이미 준비돼 있다.
  useEffect(() => {
    if (!standalone) return;
    if (clientId) {
      try {
        const rawChecked = localStorage.getItem(checkedKey(clientId));
        if (rawChecked) {
          const parsed = JSON.parse(rawChecked) as { tickers?: string[] };
          if (parsed.tickers?.length) {
            const next: Record<string, boolean> = {};
            for (const t of parsed.tickers) next[t] = true;
            setChecked(next);
          }
        }
        const rawConfirmed = localStorage.getItem(confirmedKey(clientId));
        if (rawConfirmed) {
          const parsed = JSON.parse(rawConfirmed) as { stocks?: PbSelectedKoreanStock[] };
          if (parsed.stocks?.length) setConfirmed(parsed.stocks);
        }
      } catch {
        /* ignore */
      }
    }
    setHydrated(true);
  }, [clientId, standalone]);

  const checkedList = useMemo((): PbSelectedKoreanStock[] => {
    return candidates
      .filter((c) => checked[c.ticker] && c.isFinalCandidate)
      .map((c) => ({
        ticker: c.ticker,
        name: c.name,
        price: c.price,
        asOf: c.asOf,
        source: c.source || "pb-kr-trend-filter",
        currency: c.currency,
        exchange: c.market === "KOSDAQ" ? "KOSDAQ" : "KOSPI",
      }));
  }, [candidates, checked]);

  // 확정분만 상위로 전달 (체크만으로는 포트폴리오 미반영)
  useEffect(() => {
    if (!hydrated) return;
    const pending = equityWeightPct > 0 && confirmed.length === 0;
    onSelectionChange(confirmed, pending);
  }, [confirmed, equityWeightPct, hydrated, onSelectionChange]);

  // 제어 모드: 체크·확정 상태를 부모(ManualPortfolioBuilder)의 초안 하나에 합류시킨다 —
  // 여기서 직접 localStorage에 쓰지 않는다(실제 저장은 부모의 "배분 확정 저장" 흐름).
  // standalone 모드: 기존처럼 자체 localStorage 키에 즉시 저장한다.
  useEffect(() => {
    if (!hydrated) return;
    if (!standalone) {
      onCheckedConfirmedChange?.(Object.keys(checked).filter((t) => checked[t]), confirmed);
      return;
    }
    if (!clientId) return;
    try {
      localStorage.setItem(
        checkedKey(clientId),
        JSON.stringify({ tickers: Object.keys(checked).filter((t) => checked[t]) }),
      );
      localStorage.setItem(confirmedKey(clientId), JSON.stringify({ stocks: confirmed }));
    } catch {
      /* ignore */
    }
  }, [checked, confirmed, clientId, standalone, hydrated, onCheckedConfirmedChange]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/advisory/kr-trend?limit=70&screen=1", { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "조회 실패");
      setCandidates(data.candidates ?? []);
      setUnverifiable(data.unverifiable ?? []);
      setMeta({
        asOf: data.asOf,
        source: data.source,
        finalCount: data.finalCount ?? 0,
        universeSize: data.universeSize,
        marketCapFloorWon: data.marketCapFloorWon,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "조회 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  const visible = useMemo(() => {
    const list = onlyFinal ? candidates.filter((c) => c.isFinalCandidate) : candidates;
    return list;
  }, [candidates, onlyFinal]);

  const toggle = (ticker: string, allowed: boolean) => {
    if (!allowed) return;
    setChecked((prev) => ({ ...prev, [ticker]: !prev[ticker] }));
    setConfirmError("");
  };

  const handleConfirm = () => {
    if (checkedList.length === 0) {
      setConfirmError("주식형 자산을 확정할 수 없습니다. 최종 후보를 체크한 뒤 「후보 확정」을 눌러 주세요.");
      setConfirmed([]);
      return;
    }
    setConfirmError("");
    setConfirmed(checkedList);
  };

  const handleClearConfirm = () => {
    setConfirmed([]);
    setConfirmError("");
  };

  const confirmedTickers = useMemo(() => new Set(confirmed.map((s) => s.ticker)), [confirmed]);

  const shellClass = embedded
    ? "rounded-xl border border-border bg-white p-3 shadow-sm"
    : "rounded-2xl border-2 border-[#C5A572]/60 bg-surface p-4 shadow-sm";
  const kickerClass = embedded
    ? "text-xs font-semibold uppercase tracking-wide text-[#1428A0]"
    : "text-xs font-semibold uppercase tracking-wide text-[#8B6914]";
  const runBtnClass = embedded
    ? "rounded-lg bg-[#1428A0] px-4 py-2 text-sm font-bold text-white hover:bg-[#0f1f7a] disabled:opacity-50"
    : "rounded-lg bg-[#C5A572] px-4 py-2 text-sm font-bold text-[#1a1408] hover:bg-[#b8955f] disabled:opacity-50";

  return (
    <section className={shellClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={kickerClass}>국내 주식 추세 필터</p>
          <h3 className="text-base font-bold text-fg">
            국장 추세 후보 (체크 → 후보 확정 → 선택 종목 반영)
          </h3>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-fg-muted">
            시가총액 1조 원 이상 국내 주식만 universe에 포함 → 당일 상승률 상위 70개 → 20일선·양봉·적삼봉 → 테마 출처 검증.
            체크만으로는 반영되지 않으며, 「후보 확정」한 종목만 국내주식{" "}
            {equityWeightPct.toFixed(1)}% 자산군의 선택 종목에 추가됩니다.
          </p>
        </div>
        <button type="button" className={runBtnClass} onClick={() => void load()} disabled={loading}>
          {loading ? "필터링 중…" : "상위 70 추출 · 필터 실행"}
        </button>
      </div>

      {meta && (
        <p className="mt-2 text-[10px] text-fg-muted">
          as-of {meta.asOf.slice(0, 19)} · source {meta.source} · KRW · 시총하한{" "}
          {meta.marketCapFloorWon
            ? `${(meta.marketCapFloorWon / 1e12).toFixed(0)}조원`
            : "1조원"}{" "}
          · 시총충족 universe {meta.universeSize ?? "—"}종 · 최종 후보 {meta.finalCount}종
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {unverifiable.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          <p className="font-semibold">시총 검증 불가 (자동 추천 후보 제외) · {unverifiable.length}건</p>
          <p className="mt-1 text-amber-800">
            {unverifiable
              .slice(0, 8)
              .map((u) => `${u.name}(${u.ticker})`)
              .join(" · ")}
            {unverifiable.length > 8 ? " …" : ""}
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={onlyFinal} onChange={(e) => setOnlyFinal(e.target.checked)} />
          최종 후보만 보기
        </label>
        <span className="text-fg-muted">체크 {checkedList.length}종</span>
        <span className={`font-semibold ${confirmed.length ? "text-[#1428A0]" : "text-amber-700"}`}>
          {confirmed.length
            ? `확정 ${confirmed.length}종 · ${confirmed.map((s) => s.name).join(", ")}`
            : equityWeightPct > 0
              ? "PB 확정 대기 — 「후보 확정」 전 주식형 미반영"
              : "주식 비중 0%"}
        </span>
        <button
          type="button"
          className="rounded-lg bg-[#1428A0] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#0f1f7a] disabled:opacity-50"
          onClick={handleConfirm}
        >
          후보 확정
        </button>
        {confirmed.length > 0 && (
          <button type="button" className="text-[11px] text-fg-muted underline" onClick={handleClearConfirm}>
            확정 해제
          </button>
        )}
      </div>
      {confirmError && <p className="mt-2 text-xs font-semibold text-red-600">{confirmError}</p>}

      <div className="mt-3 max-h-[520px] space-y-3 overflow-y-auto pr-1">
        {visible.length === 0 && !loading && (
          <p className="text-xs text-fg-muted">아직 결과가 없습니다. 위 버튼을 눌러 국장 상승률 상위 종목을 가져오세요.</p>
        )}
        {visible.map((c) => {
          const draft = rr[c.ticker] ?? { seedWon: "1000000", stopLoss: "", takeProfit: "" };
          const bullishDays = c.technical?.bullish20d.bullishDays ?? 0;
          const stop = Number(draft.stopLoss) || 0;
          const take = Number(draft.takeProfit) || 0;
          const seed = Number(draft.seedWon) || 0;
          const calc =
            stop > 0 && take > 0
              ? calculateRiskReward({
                  seedWon: seed,
                  currentPrice: c.price,
                  stopLossPrice: stop,
                  takeProfitPrice: take,
                  bullishDays20: bullishDays,
                })
              : null;
          const canCheck = c.isFinalCandidate;
          const isConfirmed = confirmedTickers.has(c.ticker);

          return (
            <article
              key={c.ticker}
              className={`rounded-xl border p-3 ${
                isConfirmed
                  ? "border-[#1428A0] bg-[#1428A0]/[0.06]"
                  : canCheck
                    ? "border-[#1428A0]/30 bg-[#1428A0]/[0.03]"
                    : "border-border bg-surface-2"
              }`}
            >
              <div className="flex flex-wrap items-start gap-3">
                <label className="mt-0.5 flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="checkbox"
                    disabled={!canCheck}
                    checked={Boolean(checked[c.ticker])}
                    onChange={() => toggle(c.ticker, canCheck)}
                  />
                  <span>
                    #{c.rank} {c.name}{" "}
                    <span className="font-mono text-xs text-fg-muted">{c.ticker}</span>
                  </span>
                </label>
                <span className="text-xs text-fg-muted">{c.market}</span>
                {!canCheck && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                    후보 미통과 / 체크 불가
                  </span>
                )}
                {canCheck && !isConfirmed && (
                  <span className="rounded-full bg-[#1428A0] px-2 py-0.5 text-[10px] font-semibold text-white">
                    최종 후보
                  </span>
                )}
                {isConfirmed && (
                  <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                    확정됨
                  </span>
                )}
              </div>

              <dl className="mt-2 grid grid-cols-2 gap-1 text-[11px] md:grid-cols-4">
                <div>
                  현재가: <strong>{fmtWon(c.price)}</strong> ({c.currency})
                </div>
                <div>
                  등락률:{" "}
                  <strong className={c.changePct >= 0 ? "text-red-600" : "text-blue-600"}>
                    {c.changePct.toFixed(2)}%
                  </strong>
                </div>
                <div>거래량: {c.volume.toLocaleString("ko-KR")}</div>
                <div>
                  시가총액:{" "}
                  <strong>
                    {c.marketCapStatus === "unverifiable"
                      ? "시총 검증 불가"
                      : c.marketCapLabel || (c.marketCapWon != null ? fmtWon(c.marketCapWon) : "—")}
                  </strong>
                </div>
                <div className="md:col-span-2 truncate" title={c.marketCapSource}>
                  시총 as-of {c.marketCapAsOf?.slice(0, 19) || "—"} · {c.marketCapSource || "—"}
                </div>
                <div className="md:col-span-2 truncate" title={c.source}>
                  시세 as-of {c.asOf.slice(0, 10)} · {c.source}
                </div>
              </dl>

              {c.technicalError && <p className="mt-1 text-[11px] text-red-600">{c.technicalError}</p>}
              {c.technical && (
                <ul className="mt-2 grid grid-cols-1 gap-1 text-[11px] md:grid-cols-3">
                  <li className={c.technical.ma20Above10d.passed ? "text-[#1428A0]" : "text-fg-muted"}>
                    10일 중 20일선 위: {c.technical.ma20Above10d.ratioLabel}{" "}
                    {c.technical.ma20Above10d.passed ? "✓" : "✗"}
                  </li>
                  <li className={c.technical.bullish20d.passed ? "text-[#1428A0]" : "text-fg-muted"}>
                    20일 중 양봉: {c.technical.bullish20d.ratioLabel} {c.technical.bullish20d.passed ? "✓" : "✗"}
                  </li>
                  <li className={c.technical.consecutiveBullish.passed ? "text-[#1428A0]" : "text-fg-muted"}>
                    최근 연속 양봉: {c.technical.consecutiveBullish.consecutive}일 (필요{" "}
                    {c.technical.consecutiveBullish.required}) {c.technical.consecutiveBullish.passed ? "✓" : "✗"}
                  </li>
                </ul>
              )}

              {c.theme && (
                <div className="mt-2 rounded-lg bg-surface-2 px-2 py-1.5 text-[11px]">
                  <p className="font-semibold">
                    테마: {c.theme.themeName}{" "}
                    <span className={c.theme.passed ? "text-[#1428A0]" : "text-amber-700"}>
                      ({c.theme.status})
                    </span>
                  </p>
                  <p className="mt-0.5 text-fg-muted">{c.theme.evidence}</p>
                  <p className="mt-0.5 text-[10px] text-fg-muted">
                    출처 {c.theme.source} · as-of {c.theme.asOf.slice(0, 19)}
                  </p>
                </div>
              )}

              {canCheck && (
                <div className="mt-3 rounded-lg border border-[#C5A572]/40 bg-[#FFF8EB]/60 p-2">
                  <p className="text-[11px] font-semibold text-[#8B6914]">손절·익절·매수예정 · 손익비 (결정론)</p>
                  <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <label className="text-[10px]">
                      매수 예정 금액(원)
                      <input
                        className="input mt-0.5 text-xs"
                        value={draft.seedWon}
                        onChange={(e) =>
                          setRr((p) => ({ ...p, [c.ticker]: { ...draft, seedWon: e.target.value } }))
                        }
                      />
                    </label>
                    <label className="text-[10px]">
                      손절가
                      <input
                        className="input mt-0.5 text-xs"
                        placeholder={String(Math.round(c.price * 0.95))}
                        value={draft.stopLoss}
                        onChange={(e) =>
                          setRr((p) => ({ ...p, [c.ticker]: { ...draft, stopLoss: e.target.value } }))
                        }
                      />
                    </label>
                    <label className="text-[10px]">
                      익절가
                      <input
                        className="input mt-0.5 text-xs"
                        placeholder={String(Math.round(c.price * 1.1))}
                        value={draft.takeProfit}
                        onChange={(e) =>
                          setRr((p) => ({ ...p, [c.ticker]: { ...draft, takeProfit: e.target.value } }))
                        }
                      />
                    </label>
                  </div>
                  {calc && (
                    <ul className="mt-2 grid grid-cols-2 gap-1 text-[10px] md:grid-cols-4">
                      <li>상승확률(20일 양봉비): {(calc.winRate * 100).toFixed(0)}%</li>
                      <li>하락확률: {(calc.lossRate * 100).toFixed(0)}%</li>
                      <li>매수수량: {calc.shares}주</li>
                      <li>주당손실: {fmtWon(calc.lossPerShare)}</li>
                      <li>주당이익: {fmtWon(calc.profitPerShare)}</li>
                      <li>예상손실: {fmtWon(calc.expectedLossWon)}</li>
                      <li>예상이익: {fmtWon(calc.expectedProfitWon)}</li>
                      <li>
                        손익비: {calc.riskRewardRatio == null ? "—" : calc.riskRewardRatio.toFixed(2)}
                      </li>
                    </ul>
                  )}
                  {calc?.notes?.length ? (
                    <p className="mt-1 text-[10px] text-amber-800">{calc.notes.join(" · ")}</p>
                  ) : null}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

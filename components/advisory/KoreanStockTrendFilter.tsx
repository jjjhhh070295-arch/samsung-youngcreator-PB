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

function storageKey(clientId: string) {
  return `pb-kr-trend-selected-${clientId}`;
}

export default function KoreanStockTrendFilter({
  clientId,
  equityWeightPct,
  onSelectionChange,
}: {
  clientId: string;
  equityWeightPct: number;
  onSelectionChange: (selected: PbSelectedKoreanStock[], equityPending: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<{
    asOf: string;
    source: string;
    finalCount: number;
    universeSize?: number;
    marketCapFloorWon?: number;
  } | null>(null);
  const [candidates, setCandidates] = useState<KrTrendCandidateView[]>([]);
  const [unverifiable, setUnverifiable] = useState<KrTrendCandidateView[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [rr, setRr] = useState<Record<string, RrDraft>>({});
  const [onlyFinal, setOnlyFinal] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(clientId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as { tickers?: string[] };
      if (parsed.tickers?.length) {
        const next: Record<string, boolean> = {};
        for (const t of parsed.tickers) next[t] = true;
        setChecked(next);
      }
    } catch {
      /* ignore */
    }
  }, [clientId]);

  const selectedList = useMemo(() => {
    return candidates
      .filter((c) => checked[c.ticker] && c.isFinalCandidate)
      .map((c) => ({ ticker: c.ticker, name: c.name }));
  }, [candidates, checked]);

  useEffect(() => {
    const pending = equityWeightPct > 0 && selectedList.length === 0;
    onSelectionChange(selectedList, pending);
    try {
      localStorage.setItem(storageKey(clientId), JSON.stringify({ tickers: selectedList.map((s) => s.ticker) }));
    } catch {
      /* ignore */
    }
  }, [selectedList, equityWeightPct, clientId, onSelectionChange]);

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
  };

  return (
    <section className="rounded-2xl border-2 border-[#C5A572]/60 bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8B6914]">국내 주식 추세 필터</p>
          <h3 className="text-base font-bold text-fg">국장 추세 후보 (PB 체크 → 주식형 확정)</h3>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-fg-muted">
            시가총액 5,000억 원 이상 국내 주식만 universe에 포함 → 당일 상승률 상위 70개 → 20일선·양봉·적삼봉 → 테마 출처 검증.
            시총 확인 불가 종목은 자동 후보에서 제외합니다. 채권·대체·현금은 기존 SET 로직을 유지하고, 주식{" "}
            {equityWeightPct.toFixed(0)}% 구간만 PB 선택 종목으로 채웁니다.
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg bg-[#C5A572] px-4 py-2 text-sm font-bold text-[#1a1408] hover:bg-[#b8955f] disabled:opacity-50"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "필터링 중…" : "상위 70 추출 · 필터 실행"}
        </button>
      </div>

      {meta && (
        <p className="mt-2 text-[10px] text-fg-muted">
          as-of {meta.asOf.slice(0, 19)} · source {meta.source} · KRW · 시총하한{" "}
          {meta.marketCapFloorWon ? `${(meta.marketCapFloorWon / 1e8).toLocaleString("ko-KR")}억원` : "5,000억원"} ·
          시총충족 universe {meta.universeSize ?? "—"}종 · 최종 후보 {meta.finalCount}종
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
        <span className={`font-semibold ${selectedList.length ? "text-[#1428A0]" : "text-amber-700"}`}>
          {selectedList.length
            ? `PB 선택 ${selectedList.length}종 · 주식형 반영`
            : equityWeightPct > 0
              ? "주식 확정 대기 — 체크된 종목이 없습니다"
              : "주식 비중 0%"}
        </span>
      </div>

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

          return (
            <article
              key={c.ticker}
              className={`rounded-xl border p-3 ${canCheck ? "border-[#1428A0]/30 bg-[#1428A0]/[0.03]" : "border-border bg-surface-2"}`}
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
                {canCheck && (
                  <span className="rounded-full bg-[#1428A0] px-2 py-0.5 text-[10px] font-semibold text-white">
                    최종 후보
                  </span>
                )}
              </div>

              <dl className="mt-2 grid grid-cols-2 gap-1 text-[11px] md:grid-cols-4">
                <div>
                  현재가: <strong>{fmtWon(c.price)}</strong> ({c.currency})
                </div>
                <div>
                  등락률: <strong className={c.changePct >= 0 ? "text-red-600" : "text-blue-600"}>{c.changePct.toFixed(2)}%</strong>
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
                  <p className="text-[11px] font-semibold text-[#8B6914]">손익비 계산 (결정론)</p>
                  <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <label className="text-[10px]">
                      매수 예정 금액(원)
                      <input
                        className="input mt-0.5 text-xs"
                        value={draft.seedWon}
                        onChange={(e) => setRr((p) => ({ ...p, [c.ticker]: { ...draft, seedWon: e.target.value } }))}
                      />
                    </label>
                    <label className="text-[10px]">
                      손절가
                      <input
                        className="input mt-0.5 text-xs"
                        placeholder={String(Math.round(c.price * 0.95))}
                        value={draft.stopLoss}
                        onChange={(e) => setRr((p) => ({ ...p, [c.ticker]: { ...draft, stopLoss: e.target.value } }))}
                      />
                    </label>
                    <label className="text-[10px]">
                      익절가
                      <input
                        className="input mt-0.5 text-xs"
                        placeholder={String(Math.round(c.price * 1.1))}
                        value={draft.takeProfit}
                        onChange={(e) => setRr((p) => ({ ...p, [c.ticker]: { ...draft, takeProfit: e.target.value } }))}
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
                        손익비:{" "}
                        {calc.riskRewardRatio == null ? "—" : calc.riskRewardRatio.toFixed(2)}
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

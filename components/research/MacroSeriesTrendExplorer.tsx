"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  MACRO_TREND_RANGES,
  type MacroTrendRange,
  type MacroTrendReady,
} from "@/lib/researchCopilot/macroEvidence/historyTypes";
import { isMacroTrendResponse } from "@/lib/researchCopilot/macroEvidence/historyValidation";

export const MACRO_TREND_ENDPOINT = "/api/research/macro-evidence/history";

export interface MacroTrendSeriesDescriptor {
  seriesId: string;
  title: string;
  provider: string;
  frequency: "D" | "M" | "Q";
  unit: string;
}

type ExplorerLoadState =
  | { status: "loading"; requestIdentity: string }
  | { status: "ready"; requestIdentity: string; result: MacroTrendReady }
  | { status: "blocked"; requestIdentity: string; code: string; message: string };

interface ChartPoint {
  observationDate: string;
  value: number | null;
  valueRaw: string;
  releaseDate: string | null;
  vintageDate: string | null;
  preliminaryFinal: string | null;
  revisionStatus: string | null;
}

export function parseMacroWorkspaceIdentity(identity: string) {
  const separator = identity.indexOf(":");
  if (separator <= 0 || separator === identity.length - 1) return null;
  const pbId = identity.slice(0, separator).trim();
  const clientId = identity.slice(separator + 1).trim();
  if (!pbId || !clientId) return null;
  return { pbId, clientId };
}

export function parseMacroTrendValue(valueRaw: string) {
  const trimmed = valueRaw.trim();
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function findOnlyValidMacroTrendObservation<T extends { valueRaw: string }>(observations: readonly T[]) {
  return observations.find((observation) => parseMacroTrendValue(observation.valueRaw) !== null) ?? null;
}

export function nextMacroTrendRangeIndex(key: string, currentIndex: number, length = MACRO_TREND_RANGES.length) {
  if (length <= 0) return currentIndex;
  if (key === "ArrowRight" || key === "ArrowDown") return (currentIndex + 1) % length;
  if (key === "ArrowLeft" || key === "ArrowUp") return (currentIndex - 1 + length) % length;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return currentIndex;
}

function blockedMessageForStatus(status: number) {
  if (status === 401) return "PB 서버 세션을 확인할 수 없어 추이 표시를 차단했습니다.";
  if (status === 403 || status === 404) return "현재 PB·고객 문맥에 대한 조회 권한을 확인할 수 없어 추이 표시를 차단했습니다.";
  if (status === 400) return "요청한 계열 또는 기간이 허용 목록과 일치하지 않아 추이 표시를 차단했습니다.";
  return "공식 원천·권리·최신성 검증을 완료하지 못해 추이 표시를 차단했습니다.";
}

function TrendValuesTable({ result, compact = false }: { result: MacroTrendReady; compact?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-[#DCE4F5] bg-white p-3">
      <table className="w-full table-fixed border-collapse text-left text-xs">
        <caption className={compact ? "sr-only" : "mb-2 text-left font-black text-[#0F172A]"}>
          {result.title} 관측값
        </caption>
        <thead>
          <tr className="border-b border-[#DCE4F5] text-[#64748B]">
            <th scope="col" className="w-1/2 px-2 py-2 font-bold">관측일</th>
            <th scope="col" className="w-1/2 px-2 py-2 text-right font-bold">원문 값 · {result.unit}</th>
          </tr>
        </thead>
        <tbody>
          {result.observations.map((observation, index) => {
            const numericValue = parseMacroTrendValue(observation.valueRaw);
            return (
              <tr key={`${observation.observationDate}:${index}`} className="border-b border-[#EEF2F8] last:border-b-0">
                <td className="break-words px-2 py-2 font-semibold text-[#0F172A]">{observation.observationDate}</td>
                <td className="break-words px-2 py-2 text-right font-black text-[#1428A0]">
                  {numericValue === null ? `결측 · ${observation.valueRaw || "원천 미제공"}` : observation.valueRaw}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TrendLineChart({ result }: { result: MacroTrendReady }) {
  const data: ChartPoint[] = result.observations.map((observation) => ({
    observationDate: observation.observationDate,
    value: parseMacroTrendValue(observation.valueRaw),
    valueRaw: observation.valueRaw,
    releaseDate: observation.releaseDate,
    vintageDate: observation.vintageDate,
    preliminaryFinal: observation.preliminaryFinal,
    revisionStatus: observation.revisionStatus,
  }));
  const numericCount = data.reduce((count, point) => count + (point.value === null ? 0 : 1), 0);

  if (numericCount === 0) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
        숫자로 검증된 관측치가 없어 선 그래프를 표시하지 않습니다. 결측을 0이나 보간값으로 바꾸지 않았습니다.
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      <div
        role="img"
        aria-label={`${result.title} ${result.range} 추이. ${result.returnedObservationCount}개 표시 관측치 중 숫자로 확인된 관측치는 ${numericCount}개이며 결측 구간은 연결하지 않습니다.`}
        className="h-72 min-w-0 overflow-hidden rounded-xl border border-[#DCE4F5] bg-white p-2 sm:h-80 sm:p-3"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 12, bottom: 12, left: 0 }} accessibilityLayer>
            <CartesianGrid stroke="#DCE4F5" strokeDasharray="3 3" />
            <XAxis
              dataKey="observationDate"
              tick={{ fill: "#64748B", fontSize: 10 }}
              tickLine={{ stroke: "#94A3B8" }}
              axisLine={{ stroke: "#94A3B8" }}
              minTickGap={24}
            />
            <YAxis
              width={52}
              domain={["auto", "auto"]}
              tick={{ fill: "#64748B", fontSize: 10 }}
              tickLine={{ stroke: "#94A3B8" }}
              axisLine={{ stroke: "#94A3B8" }}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0]?.payload as ChartPoint | undefined;
                return (
                  <div className="max-w-[14rem] rounded-lg border border-[#C9D1FF] bg-white p-2 text-xs shadow-lg">
                    <p className="font-bold text-[#64748B]">관측일 {String(label)}</p>
                    <p className="mt-1 break-words font-black text-[#1428A0]">
                      원문 값 {point?.valueRaw ?? "결측"} {result.unit}
                    </p>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px] text-[#475569]">
                      <dt>발표일</dt><dd className="break-words font-bold text-[#0F172A]">{point?.releaseDate ?? "원천 미제공"}</dd>
                      <dt>빈티지</dt><dd className="break-words font-bold text-[#0F172A]">{point?.vintageDate ?? "원천 미제공"}</dd>
                      <dt>잠정·확정</dt><dd className="break-words font-bold text-[#0F172A]">{point?.preliminaryFinal ?? "원천 미제공"}</dd>
                      <dt>수정 상태</dt><dd className="break-words font-bold text-[#0F172A]">{point?.revisionStatus ?? "원천 미제공"}</dd>
                    </dl>
                  </div>
                );
              }}
            />
            <Line
              type="linear"
              dataKey="value"
              name={result.title}
              stroke="#2C3EE8"
              strokeWidth={2.5}
              dot={data.length <= 48 ? { r: 2.5, fill: "#FFFFFF", stroke: "#1428A0", strokeWidth: 1.5 } : false}
              activeDot={{ r: 4, fill: "#FFFFFF", stroke: "#1428A0", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] leading-relaxed text-[#64748B]">
        파란 실선은 검증된 관측값의 시간 순서만 나타냅니다. 결측 구간은 연결하지 않고, 수익 방향이나 투자 행동을 뜻하지 않습니다.
      </p>
      <details className="rounded-xl border border-[#DCE4F5] bg-[#F5F7FC] p-3">
        <summary className="cursor-pointer text-xs font-black text-[#1428A0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]">
          차트 원자료 표 {result.returnedObservationCount}개 확인
        </summary>
        <div className="mt-3">
          <TrendValuesTable result={result} compact />
        </div>
      </details>
    </div>
  );
}

function TrendResult({ result }: { result: MacroTrendReady }) {
  if (result.validObservationCount === 0 || result.observations.length === 0) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
        검증된 관측치가 0개이므로 값·표·차트를 모두 차단합니다.
      </div>
    );
  }
  if (result.displayMode === "latest") {
    const only = findOnlyValidMacroTrendObservation(result.observations);
    if (!only) {
      return (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
          검증된 최신 관측값을 찾지 못해 값 표시를 차단합니다.
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-[#DCE4F5] bg-white p-4">
        <p className="text-xs font-bold text-[#64748B]">선택 기간에 숫자로 검증된 관측치가 1개뿐이므로 해당 값만 표시합니다.</p>
        <p className="mt-3 break-words text-2xl font-black text-[#1428A0]">
          {only.valueRaw} <span className="text-xs text-[#64748B]">{result.unit}</span>
        </p>
        <p className="mt-1 text-xs text-[#64748B]">관측일 {only.observationDate}</p>
      </div>
    );
  }
  if (result.displayMode === "table") return <TrendValuesTable result={result} />;
  return <TrendLineChart result={result} />;
}

export default function MacroSeriesTrendExplorer({
  identity,
  series,
  onClose,
}: {
  identity: string;
  series: MacroTrendSeriesDescriptor;
  onClose: () => void;
}) {
  const [range, setRange] = useState<MacroTrendRange>("1Y");
  const [state, setState] = useState<ExplorerLoadState>(() => ({
    status: "loading",
    requestIdentity: `${identity}:${series.seriesId}:1Y`,
  }));
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const rangeButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestGenerationRef = useRef(0);
  const activeRequestIdentityRef = useRef("");
  const workspaceIdentity = useMemo(() => parseMacroWorkspaceIdentity(identity), [identity]);
  const requestIdentity = `${identity}:${series.seriesId}:${range}`;
  activeRequestIdentityRef.current = requestIdentity;

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const expectedGeneration = ++requestGenerationRef.current;
    const expectedRequestIdentity = requestIdentity;

    if (!workspaceIdentity) {
      setState({
        status: "blocked",
        requestIdentity: expectedRequestIdentity,
        code: "CONTEXT_INVALID",
        message: "PB·고객 조회 문맥을 확인할 수 없어 추이 요청을 보내지 않았습니다.",
      });
      return () => controller.abort();
    }

    setState({ status: "loading", requestIdentity: expectedRequestIdentity });
    const query = new URLSearchParams({
      pbId: workspaceIdentity.pbId,
      clientId: workspaceIdentity.clientId,
      seriesId: series.seriesId,
      range,
    });

    void fetch(`${MACRO_TREND_ENDPOINT}?${query.toString()}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      const payload: unknown = await response.json().catch(() => null);
      if (
        controller.signal.aborted
        || expectedGeneration !== requestGenerationRef.current
        || expectedRequestIdentity !== activeRequestIdentityRef.current
      ) return;
      if (!response.ok) {
        setState({
          status: "blocked",
          requestIdentity: expectedRequestIdentity,
          code: `HTTP_${response.status}`,
          message: blockedMessageForStatus(response.status),
        });
        return;
      }
      if (!isMacroTrendResponse(payload, {
        pbId: workspaceIdentity.pbId,
        clientId: workspaceIdentity.clientId,
        seriesId: series.seriesId,
        range,
      })) {
        setState({
          status: "blocked",
          requestIdentity: expectedRequestIdentity,
          code: "RESPONSE_INVALID",
          message: "서버 응답의 계열·기간·고객 문맥 또는 근거 필드가 일치하지 않아 추이 표시를 차단했습니다.",
        });
        return;
      }
      if (payload.result.status === "blocked") {
        setState({
          status: "blocked",
          requestIdentity: expectedRequestIdentity,
          code: payload.result.code,
          message: payload.result.message,
        });
        return;
      }
      setState({ status: "ready", requestIdentity: expectedRequestIdentity, result: payload.result });
    }).catch(() => {
      if (
        controller.signal.aborted
        || expectedGeneration !== requestGenerationRef.current
        || expectedRequestIdentity !== activeRequestIdentityRef.current
      ) return;
      setState({
        status: "blocked",
        requestIdentity: expectedRequestIdentity,
        code: "REQUEST_FAILED",
        message: "공식 추이 데이터 요청에 실패해 이전 계열이나 이전 고객의 값을 대신 표시하지 않습니다.",
      });
    });

    return () => controller.abort();
  }, [range, requestIdentity, series.seriesId, workspaceIdentity]);

  const visibleState: ExplorerLoadState = state.requestIdentity === requestIdentity
    ? state
    : { status: "loading", requestIdentity };

  const handleRangeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Enter" || event.key === " ") {
      setRange(MACRO_TREND_RANGES[index]);
      return;
    }
    const nextIndex = nextMacroTrendRangeIndex(event.key, index);
    setRange(MACRO_TREND_RANGES[nextIndex]);
    rangeButtonRefs.current[nextIndex]?.focus();
  };

  return (
    <section
      id="macro-series-trend-explorer"
      aria-labelledby="macro-trend-heading"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
      className="min-w-0 rounded-xl border-2 border-[#C9D1FF] bg-[#F5F7FC] p-3 sm:p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-black tracking-wide text-[#2C3EE8]">OFFICIAL SERIES TREND</p>
          <h3 id="macro-trend-heading" className="mt-1 break-words text-base font-black text-[#0F172A]">
            {series.title} 추이
          </h3>
          <p className="mt-1 break-words text-xs text-[#64748B]">
            {series.provider} · {series.frequency} · 단위 {series.unit}
          </p>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="min-h-11 shrink-0 rounded-lg border border-[#DCE4F5] bg-white px-4 text-xs font-black text-[#1428A0] hover:border-[#2C3EE8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8] focus-visible:ring-offset-2"
        >
          추이 닫기
        </button>
      </div>

      <div className="mt-4">
        <p id="macro-trend-range-label" className="text-xs font-black text-[#0F172A]">조회 기간</p>
        <div
          role="radiogroup"
          aria-labelledby="macro-trend-range-label"
          className="mt-2 flex min-w-0 flex-wrap gap-2"
        >
          {MACRO_TREND_RANGES.map((option, index) => {
            const selected = option === range;
            return (
              <button
                key={option}
                ref={(node) => { rangeButtonRefs.current[index] = node; }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => setRange(option)}
                onKeyDown={(event) => handleRangeKeyDown(event, index)}
                className={`min-h-10 min-w-12 rounded-lg border px-3 text-xs font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8] focus-visible:ring-offset-2 ${
                  selected
                    ? "border-[#1428A0] bg-[#1428A0] text-white"
                    : "border-[#DCE4F5] bg-white text-[#334155] hover:border-[#2C3EE8]"
                }`}
              >
                {selected && <span aria-hidden="true">✓ </span>}
                {option}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4" aria-live="polite">
        {visibleState.status === "loading" && (
          <p role="status" className="rounded-xl border border-[#DCE4F5] bg-white p-4 text-xs font-semibold text-[#475569]">
            공식 원천의 {range} 관측치와 페이지 해시를 검증하고 있습니다.
          </p>
        )}
        {visibleState.status === "blocked" && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-xs font-black text-red-700">추이 표시 차단</p>
            <p className="mt-1 break-words text-xs leading-relaxed text-red-700">{visibleState.message}</p>
            <p className="mt-2 break-all font-mono text-[10px] text-red-700">상태 {visibleState.code}</p>
          </div>
        )}
        {visibleState.status === "ready" && (
          <div className="space-y-4">
            <dl className="grid min-w-0 grid-cols-2 gap-2 text-[10px] sm:grid-cols-3 lg:grid-cols-4">
              <div className="min-w-0 rounded-lg bg-white p-2">
                <dt className="text-[#64748B]">실제 범위</dt>
                <dd className="mt-0.5 break-words font-bold text-[#0F172A]">
                  {visibleState.result.actualCoverage
                    ? `${visibleState.result.actualCoverage.startDate} ~ ${visibleState.result.actualCoverage.endDate} · ${visibleState.result.actualCoverage.calendarDaySpan}일`
                    : "관측치 없음"}
                </dd>
              </div>
              <div className="min-w-0 rounded-lg bg-white p-2">
                <dt className="text-[#64748B]">기준 관측일</dt>
                <dd className="mt-0.5 break-words font-bold text-[#0F172A]">{visibleState.result.anchorObservationDate}</dd>
              </div>
              <div className="min-w-0 rounded-lg bg-white p-2">
                <dt className="text-[#64748B]">원천·정규화·기간 내</dt>
                <dd className="mt-0.5 break-words font-bold text-[#0F172A]">
                  {visibleState.result.originalObservationCount}개 · {visibleState.result.normalizedObservationCount}개 · {visibleState.result.inRangeObservationCount}개
                </dd>
              </div>
              <div className="min-w-0 rounded-lg bg-white p-2">
                <dt className="text-[#64748B]">화면 표시</dt>
                <dd className="mt-0.5 break-words font-bold text-[#0F172A]">
                  {visibleState.result.returnedObservationCount}개 · {visibleState.result.inRangeObservationCount > visibleState.result.returnedObservationCount ? "결정론 축약 적용" : "축약 없음"}
                </dd>
              </div>
              <div className="min-w-0 rounded-lg bg-white p-2">
                <dt className="text-[#64748B]">결측·간격</dt>
                <dd className="mt-0.5 break-words font-bold text-[#0F172A]">
                  원천 결측 {visibleState.result.missingObservationCount}개 · 달력 간격 {visibleState.result.gaps.length}개
                </dd>
              </div>
              <div className="min-w-0 rounded-lg bg-white p-2">
                <dt className="text-[#64748B]">권리 상태</dt>
                <dd className="mt-0.5 break-words font-bold text-[#0F172A]">PB 내부 사용 승인 확인 · {visibleState.result.rightsStatus}</dd>
              </div>
              <div className="min-w-0 rounded-lg bg-white p-2">
                <dt className="text-[#64748B]">최신성</dt>
                <dd className="mt-0.5 break-words font-bold text-[#0F172A]">stale 검증 통과 · 표시 가능</dd>
              </div>
              <div className="min-w-0 rounded-lg bg-white p-2">
                <dt className="text-[#64748B]">수집·페이지</dt>
                <dd className="mt-0.5 break-words font-bold text-[#0F172A]">
                  {visibleState.result.retrievedAt} · {visibleState.result.captures.length}개
                </dd>
              </div>
            </dl>
            {visibleState.result.inRangeObservationCount > visibleState.result.returnedObservationCount && (
              <p className="rounded-lg border border-[#C9D1FF] bg-white p-3 text-[11px] leading-relaxed text-[#334155]">
                장기 일간 자료는 첫값·끝값·최소·최대를 보존하는 결정론 규칙으로 최대 480점까지 축약했습니다. 숫자를 평균내거나 보간하지 않았습니다.
              </p>
            )}
            {visibleState.result.gaps.length > 0 && (
              <p className="rounded-lg border border-[#DCE4F5] bg-white p-3 text-[11px] leading-relaxed text-[#64748B]">
                달력 간격은 인접 관측일 사이의 날짜 차이이며 데이터 누락을 단정하지 않습니다. 결측값은 별도로 표시하고 연결하지 않습니다.
              </p>
            )}
            <TrendResult result={visibleState.result} />
            <div className="rounded-lg bg-white p-3 text-[10px] leading-relaxed text-[#64748B]">
              <p className="break-all">데이터셋 해시 {visibleState.result.datasetContentHash}</p>
              <p className="mt-1 break-words">정의 {visibleState.result.definitionVersion} · 요청 범위 {visibleState.result.requestedStartDate} ~ {visibleState.result.requestedEndDate}</p>
              <details className="mt-2 rounded-lg border border-[#DCE4F5] bg-[#F5F7FC] p-2">
                <summary className="cursor-pointer font-black text-[#1428A0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]">
                  원본 페이지 해시 {visibleState.result.captures.length}개 확인
                </summary>
                <ul className="mt-2 space-y-2">
                  {visibleState.result.captures.map((capture) => (
                    <li key={capture.captureId} className="min-w-0 rounded-md bg-white p-2">
                      <p className="break-words font-bold text-[#0F172A]">{capture.providerId} · {capture.captureId}</p>
                      <p className="mt-1 break-all">SHA-256 {capture.contentHash}</p>
                      <p className="mt-1 break-words">수집 {capture.retrievedAt} · {capture.bodyByteLength} bytes · HTTP {capture.responseStatus}</p>
                    </li>
                  ))}
                </ul>
              </details>
              <a
                href={visibleState.result.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex min-h-9 items-center font-black text-[#1428A0] underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]"
              >
                공식 원천 열기 ↗
              </a>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

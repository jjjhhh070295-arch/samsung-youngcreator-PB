"use client";

import { useEffect, useRef, useState } from "react";
import type { Client, FinancialIncomeProfile } from "@/lib/types";
import { formatKRW } from "@/lib/format";
import { resolveFinancialIncomeProfile } from "@/lib/financialIncome";
import { listDepositProducts } from "@/lib/deposits/store";
import { aggregateDerivedDepositInterest } from "@/lib/tax/depositInterest";

type Props = {
  client: Client;
  onChangeComprehensiveTax: (value: boolean) => Promise<void> | void;
  onChangeFinancialIncomeProfile: (profile: FinancialIncomeProfile) => Promise<void> | void;
};

export default function FinancialIncomeTaxSection({
  client,
  onChangeComprehensiveTax,
  onChangeFinancialIncomeProfile,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [liveDepositInterestWon, setLiveDepositInterestWon] = useState<number | null>(null);
  const comprehensive = Boolean(client.financialIncomeComprehensiveTax);
  const profile = resolveFinancialIncomeProfile(client);

  useEffect(() => {
    let cancelled = false;
    const year = profile.taxYear ?? new Date().getFullYear();
    const asOf = new Date().toISOString().slice(0, 10);
    void listDepositProducts(client.id).then((rows) => {
      if (cancelled) return;
      const agg = aggregateDerivedDepositInterest(rows, { asOf, projectionYear: year });
      setLiveDepositInterestWon(agg.totalGrossWon);
    });
    return () => {
      cancelled = true;
    };
  }, [client.id, client.financialIncomeProfile?.derivedDepositInterestWon, profile.taxYear]);

  const patchProfile = async (patch: Partial<FinancialIncomeProfile>, markManual = false) => {
    const next: FinancialIncomeProfile = {
      ...profile,
      ...patch,
      parseStatus: markManual
        ? "manual"
        : (patch.parseStatus ?? profile.parseStatus),
    };
    await onChangeFinancialIncomeProfile(next);
  };

  const uploadPdf = async (file: File) => {
    setUploading(true);
    setMessage("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/tax/withholding-slip", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || data.parseStatus === "parse_failed" || !data.ok) {
        await patchProfile({
          parseStatus: "parse_failed",
          fileName: file.name,
          extractedAt: new Date().toISOString(),
          extractedInterestIncomeWon: null,
          extractedDividendIncomeWon: null,
        });
        setMessage(data.message || data.error || "PDF에서 금융소득을 읽지 못했습니다. 수동 입력이 필요합니다.");
        return;
      }
      const interest = data.extract?.interestIncomeWon ?? null;
      const dividend = data.extract?.dividendIncomeWon ?? null;
      await patchProfile({
        parseStatus: "parsed",
        fileName: file.name,
        extractedAt: new Date().toISOString(),
        interestIncomeWon: interest,
        dividendIncomeWon: dividend,
        extractedInterestIncomeWon: interest,
        extractedDividendIncomeWon: dividend,
      });
      setMessage(data.message || "추출값을 확인·수정한 뒤 세전·세후 계산에 반영하세요.");
    } catch {
      await patchProfile({
        parseStatus: "parse_failed",
        fileName: file.name,
        extractedAt: new Date().toISOString(),
      });
      setMessage("PDF 파싱에 실패했습니다. 수동 입력이 필요합니다.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <section className="console-panel space-y-4 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[#0D57BA]">Tax profile</p>
        <h3 className="mt-1 text-base font-bold text-fg">금융소득 종합과세</h3>
        <p className="mt-1 text-[11px] text-fg-muted">
          고객 기본정보에 저장되며, 세전·세후 계산과 포트폴리오 승인 조건에 반영됩니다.
        </p>
      </div>

      <div className="rounded-md border border-border bg-white p-4">
        <p className="text-sm font-bold text-fg">금융소득 종합과세 대상자입니까?</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={`rounded border px-4 py-2 text-sm font-bold ${
              !comprehensive ? "border-[#1769D2] bg-[#1769D2] text-white" : "border-border bg-white text-fg-muted"
            }`}
            onClick={() => void onChangeComprehensiveTax(false)}
          >
            아니오
          </button>
          <button
            type="button"
            className={`rounded border px-4 py-2 text-sm font-bold ${
              comprehensive ? "border-[#1769D2] bg-[#1769D2] text-white" : "border-border bg-white text-fg-muted"
            }`}
            onClick={() => void onChangeComprehensiveTax(true)}
          >
            예
          </button>
        </div>
        <p className="mt-2 text-[11px] text-fg-muted">
          현재: <b className="text-fg">{comprehensive ? "예" : "아니오"}</b>
          {!comprehensive ? " (기본값)" : ""}
        </p>
      </div>

      <div className="space-y-3 rounded-md border border-border bg-[#F2F6FC] p-4">
          <div>
            <p className="text-sm font-bold text-fg">원천징수영수증 PDF 첨부</p>
            <p className="mt-1 text-[11px] text-fg-muted">
              PDF에서 이자·배당을 읽습니다. 실패 시 자동 추정하지 않으며 수동 입력이 필요합니다.
              선언이 「아니오」여도 예상 금융소득이 기준을 넘으면 소득 입력이 필요합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadPdf(file);
              }}
            />
            <button
              type="button"
              className="btn-primary text-sm disabled:opacity-40"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "업로드 중…" : "PDF 선택"}
            </button>
            {profile.fileName && (
              <span className="text-[11px] font-semibold text-fg-muted">첨부: {profile.fileName}</span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                profile.parseStatus === "parsed"
                  ? "bg-emerald-100 text-emerald-800"
                  : profile.parseStatus === "manual"
                    ? "bg-blue-100 text-blue-800"
                    : profile.parseStatus === "parse_failed"
                      ? "bg-amber-100 text-amber-900"
                      : "bg-slate-100 text-slate-600"
              }`}
            >
              {profile.parseStatus === "parsed"
                ? "추출 완료"
                : profile.parseStatus === "manual"
                  ? "수동 입력"
                  : profile.parseStatus === "parse_failed"
                    ? "추출 실패 · 수동 입력 필요"
                    : "미첨부"}
            </span>
          </div>
          {message && <p className="text-xs font-semibold text-amber-800">{message}</p>}

          <div className="rounded-lg border border-border bg-white p-3">
            <p className="text-xs font-bold text-fg">소득·납부세액 입력</p>
            <p className="mt-1 text-[10px] text-fg-muted">
              작년 값은 참고입니다. 「작년과 동일」은 올해 가정을 초기화할 뿐, 작년을 사실로 쓰지 않습니다.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="text-[11px] font-bold">
                귀속연도
                <input
                  type="number"
                  className="mt-1 w-full rounded border border-border px-2 py-1.5 text-sm"
                  value={profile.taxYear ?? new Date().getFullYear()}
                  onChange={(e) =>
                    void patchProfile({ taxYear: Number(e.target.value) || null }, true)
                  }
                />
              </label>
              <label className="text-[11px] font-bold">
                작년 총급여
                <input
                  type="number"
                  className="mt-1 w-full rounded border border-border px-2 py-1.5 text-sm"
                  value={profile.priorYearWageGrossWon ?? ""}
                  placeholder="미입력"
                  onChange={(e) =>
                    void patchProfile(
                      {
                        priorYearWageGrossWon:
                          e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0),
                      },
                      true,
                    )
                  }
                />
              </label>
              <label className="text-[11px] font-bold sm:col-span-2">
                작년 총 결정세액(금융소득 제외·국세+지방세)
                <input
                  type="number"
                  className="mt-1 w-full rounded border border-border px-2 py-1.5 text-sm"
                  value={profile.priorYearNonFinancialAssessedTaxWon ?? ""}
                  placeholder="미입력"
                  onChange={(e) =>
                    void patchProfile(
                      {
                        priorYearNonFinancialAssessedTaxWon:
                          e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0),
                      },
                      true,
                    )
                  }
                />
                <span className="mt-1 block text-[10px] font-normal text-fg-muted">
                  이자·배당 등 금융소득 관련 세액을 제외한 국세와 지방세의 합계입니다.
                </span>
              </label>
              <label className="text-[11px] font-bold">
                올해 예상 총급여
                <input
                  type="number"
                  className="mt-1 w-full rounded border border-border px-2 py-1.5 text-sm"
                  value={profile.expectedWageGrossWon ?? ""}
                  placeholder="미입력"
                  onChange={(e) =>
                    void patchProfile(
                      {
                        expectedWageGrossWon:
                          e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0),
                      },
                      true,
                    )
                  }
                />
              </label>
              <label className="text-[11px] font-bold">
                올해 기타 종합소득
                <input
                  type="number"
                  className="mt-1 w-full rounded border border-border px-2 py-1.5 text-sm"
                  value={profile.otherComprehensiveIncomeWon ?? ""}
                  placeholder="미입력"
                  onChange={(e) =>
                    void patchProfile(
                      {
                        otherComprehensiveIncomeWon:
                          e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0),
                      },
                      true,
                    )
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="btn-outline mt-2 text-xs"
              onClick={() =>
                void patchProfile(
                  {
                    expectedWageGrossWon: profile.priorYearWageGrossWon ?? null,
                    otherComprehensiveIncomeWon: profile.priorYearOtherComprehensiveIncomeWon ?? null,
                  },
                  true,
                )
              }
            >
              작년과 동일(올해 가정 초기화)
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-dashed border-border bg-white p-3 text-xs">
              <p className="font-bold text-fg">이자소득 (총액·읽기전용 집계)</p>
              <p className="mt-1 text-fg-muted">
                기존 확정 {formatKRW(profile.interestIncomeWon ?? 0)}
              </p>
              <p className="text-fg-muted">
                예·적금 예상{" "}
                {formatKRW(
                  liveDepositInterestWon ?? profile.derivedDepositInterestWon ?? 0,
                )}{" "}
                · 채권 예상 {formatKRW(profile.derivedBondInterestWon ?? 0)}
              </p>
              <label className="mt-2 block text-[11px] font-bold">
                기존 확정 이자(외부·원천징수)
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-bold"
                  value={profile.interestIncomeWon ?? ""}
                  placeholder="미입력"
                  onChange={(event) => {
                    const raw = event.target.value;
                    void patchProfile(
                      { interestIncomeWon: raw === "" ? null : Math.max(0, Number(raw) || 0) },
                      true,
                    );
                  }}
                />
              </label>
            </div>
            <div className="rounded-lg border border-dashed border-border bg-white p-3 text-xs">
              <p className="font-bold text-fg">배당소득 (총액·읽기전용 집계)</p>
              <p className="mt-1 text-fg-muted">
                기존 확정 {formatKRW(profile.dividendIncomeWon ?? 0)}
              </p>
              <p className="text-fg-muted">
                주식·ETF 예상 {formatKRW(profile.derivedDividendWon ?? 0)}
              </p>
              <label className="mt-2 block text-[11px] font-bold">
                기존 확정 배당(외부·원천징수)
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-bold"
                  value={profile.dividendIncomeWon ?? ""}
                  placeholder="미입력"
                  onChange={(event) => {
                    const raw = event.target.value;
                    void patchProfile(
                      { dividendIncomeWon: raw === "" ? null : Math.max(0, Number(raw) || 0) },
                      true,
                    );
                  }}
                />
              </label>
            </div>
          </div>
        </div>
    </section>
  );
}

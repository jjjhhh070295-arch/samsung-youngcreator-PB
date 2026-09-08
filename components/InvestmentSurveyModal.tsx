"use client";

import { useEffect, useMemo, useState } from "react";
import type { Client, IPS } from "@/lib/types";
import {
  SURVEY_MAX_SCORE,
  SURVEY_QUESTIONS,
  calculateSurveyScore,
  emptySurveyAnswers,
  isSurveyComplete,
  mapSurveyToIPS,
  type InvestmentSurveyAnswers,
  type InvestmentSurveyResult,
} from "@/lib/investmentSurvey";
import {
  loadInvestmentSurvey,
  saveInvestmentSurvey,
} from "@/lib/investmentSurveyStorage";

interface Props {
  open: boolean;
  pbId: string;
  client: Client;
  onClose: () => void;
  onApplied: (ips: IPS, result: InvestmentSurveyResult) => Promise<void> | void;
}

export default function InvestmentSurveyModal({
  open,
  pbId,
  client,
  onClose,
  onApplied,
}: Props) {
  const [answers, setAnswers] = useState<InvestmentSurveyAnswers>(emptySurveyAnswers());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const saved = loadInvestmentSurvey(pbId, client.id);
    setAnswers({
      ...emptySurveyAnswers(),
      ...(saved?.answers ?? {}),
      investmentExperience: saved?.answers?.investmentExperience ?? [],
      taxConsideration: saved?.answers?.taxConsideration ?? "",
    });
    setError("");
  }, [open, pbId, client.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const preview = useMemo(() => {
    if (!isSurveyComplete(answers)) return null;
    return calculateSurveyScore(answers);
  }, [answers]);

  const setSingle = (id: keyof InvestmentSurveyAnswers, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  };

  const toggleMultiple = (id: "investmentExperience", optionId: string) => {
    setAnswers((prev) => {
      const current = prev[id];
      const next = current.includes(optionId)
        ? current.filter((item) => item !== optionId)
        : [...current, optionId];
      return { ...prev, [id]: next };
    });
  };

  const handleSubmit = async () => {
    setError("");
    if (!isSurveyComplete(answers)) {
      setError("모든 설문 문항을 선택해 주세요. (고유상황은 선택 입력)");
      return;
    }

    setSaving(true);
    try {
      const score = calculateSurveyScore(answers);
      const result: InvestmentSurveyResult = {
        answers,
        ...score,
        submittedAt: new Date().toISOString(),
      };
      const ips = mapSurveyToIPS(answers, result, client);
      saveInvestmentSurvey(pbId, client.id, result);
      await onApplied(ips, result);
      onClose();
    } catch (e) {
      console.error(e);
      setError("설문 결과 저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="고객 투자성향 설문조사"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border bg-surface-2 px-5 py-4">
          <p className="text-base font-black text-fg">고객 투자성향 설문조사</p>
          <p className="mt-1 text-xs text-fg-muted">
            고객 투자성향 설문 내용 및 점수기준 · 총점 {SURVEY_MAX_SCORE}점 (문항 4·세금 요인은 총점 미반영)
          </p>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <div className="space-y-5">
            {SURVEY_QUESTIONS.map((question) => (
              <section key={question.id} className="rounded-xl border border-border bg-surface-2 p-4">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-fg">
                      {question.number}. {question.title}
                    </p>
                    {question.referenceOnly ? (
                      <p className="mt-0.5 text-[11px] font-semibold text-[#1428A0]">
                        참고용 (점수 미반영)
                      </p>
                    ) : null}
                    {question.factorOnly ? (
                      <p className="mt-0.5 text-[11px] font-semibold text-[#1428A0]">
                        세금 요인 점수 (1~5) · 총점 미반영
                      </p>
                    ) : null}
                    {question.multiple ? (
                      <p className="mt-0.5 text-[11px] text-fg-muted">복수 선택 가능 · 최고점만 반영</p>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2">
                  {question.options.map((option) => {
                    const checked = question.multiple
                      ? answers.investmentExperience.includes(option.id)
                      : answers[question.id] === option.id;

                    return (
                      <label
                        key={option.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                          checked
                            ? "border-[#1428A0] bg-[#1428A0]/5"
                            : "border-border bg-white hover:border-[#1428A0]/40"
                        }`}
                      >
                        <input
                          type={question.multiple ? "checkbox" : "radio"}
                          name={question.id}
                          checked={checked}
                          onChange={() =>
                            question.multiple
                              ? toggleMultiple("investmentExperience", option.id)
                              : setSingle(question.id, option.id)
                          }
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1 text-sm text-fg">{option.label}</span>
                        {!question.referenceOnly || question.factorOnly ? (
                          <span className="shrink-0 text-[11px] font-bold text-[#1428A0]">
                            {option.score}점
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}

            <section className="rounded-xl border border-border bg-surface-2 p-4">
              <p className="text-sm font-black text-fg">고유상황 직접 입력</p>
              <p className="mt-0.5 text-[11px] text-fg-muted">
                예: 자녀 증여 예정, 부동산 매각 예정, 세금 납부 예정, IPO 보호예수 해제 예정, 대출 만기 예정
              </p>
              <textarea
                className="input mt-3 min-h-[88px] w-full"
                value={answers.uniqueSituation}
                onChange={(e) => setSingle("uniqueSituation", e.target.value)}
                placeholder="고객 고유 상황을 입력하세요."
              />
            </section>

            {preview ? (
              <section className="rounded-xl border border-[#1428A0]/20 bg-[#1428A0]/5 p-4">
                <p className="text-sm font-black text-fg">점수 미리보기</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <p className="text-sm text-fg">
                    원점수: <b>{preview.rawScore}</b> / {SURVEY_MAX_SCORE}점
                  </p>
                  <p className="text-sm text-fg">
                    환산점수: <b>{preview.convertedScore}</b>점
                  </p>
                  <p className="text-sm text-fg">
                    최종 투자성향: <b className="text-[#1428A0]">{preview.finalTendency}</b>
                  </p>
                  {preview.capReason ? (
                    <p className="text-xs text-fg-muted sm:col-span-2">{preview.capReason}</p>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>
        </div>

        <div className="border-t border-border bg-surface-2 px-5 py-4">
          {error ? <p className="mb-2 text-xs font-semibold text-red-600">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-outline text-sm" onClick={onClose} disabled={saving}>
              취소
            </button>
            <button type="button" className="btn-primary text-sm" onClick={handleSubmit} disabled={saving}>
              {saving ? "저장 중…" : "설문 제출 · 7요인 반영"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

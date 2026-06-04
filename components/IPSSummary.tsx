"use client";

import type { IPS } from "@/lib/types";
import { FACTOR_META } from "@/lib/types";

interface Props {
  ips: IPS;
  lang?: "ko" | "en";
}

// 고객 화면용 쉬운 언어 요약 (핵심 값만 크게)
const SCORE_WORD_KO = ["", "매우 낮음", "낮음", "보통", "높음", "매우 높음"];
const SCORE_WORD_EN = ["", "Very Low", "Low", "Moderate", "High", "Very High"];

export default function IPSSummary({ ips, lang = "ko" }: Props) {
  const en = lang === "en";
  const SCORE_WORD = en ? SCORE_WORD_EN : SCORE_WORD_KO;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {FACTOR_META.map((m) => {
        const f = ips[m.key];
        const hasScore = f.status === "explicit" && f.score != null;
        return (
          <div key={m.key} className="card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-fg">{en ? m.labelEn : m.label}</p>
              {hasScore && (
                <span className="badge-gold">
                  {SCORE_WORD[f.score as number]} · {f.score}
                  {en ? "/5" : "점"}
                </span>
              )}
            </div>
            <p className="mt-2 text-lg font-medium text-fg">
              {f.value ? (
                f.value
              ) : f.status === "inferred" ? (
                <span className="text-sm font-normal text-fg-muted">
                  {en ? "Note: " : "참고: "}
                  {f.inferenceHint || (en ? "Needs confirmation" : "추가 확인 필요")}
                </span>
              ) : (
                <span className="text-sm font-normal text-fg-muted">
                  {en ? "Not yet recorded" : "아직 정리되지 않음"}
                </span>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}

"use client";

import type { IPS } from "@/lib/types";
import { FACTOR_META } from "@/lib/types";

interface Props {
  ips: IPS;
}

// 고객 화면용 쉬운 언어 요약 (핵심 값만 크게)
const SCORE_WORD = ["", "매우 낮음", "낮음", "보통", "높음", "매우 높음"];

export default function IPSSummary({ ips }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {FACTOR_META.map((m) => {
        const f = ips[m.key];
        const hasScore = f.status === "explicit" && f.score != null;
        return (
          <div key={m.key} className="card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-fg">{m.label}</p>
              {hasScore && (
                <span className="badge-gold">
                  {SCORE_WORD[f.score as number]} · {f.score}점
                </span>
              )}
            </div>
            <p className="mt-2 text-lg font-medium text-fg">
              {f.value ? (
                f.value
              ) : f.status === "inferred" ? (
                <span className="text-sm font-normal text-fg-muted">
                  참고: {f.inferenceHint || "추가 확인 필요"}
                </span>
              ) : (
                <span className="text-sm font-normal text-fg-muted">아직 정리되지 않음</span>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}

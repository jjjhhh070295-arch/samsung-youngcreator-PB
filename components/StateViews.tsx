"use client";

import type { ReactNode } from "react";

// 로딩 / 에러 / 빈 상태 공용 컴포넌트

export function LoadingView({ label = "불러오는 중…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-fg-muted">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-gold-400" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorView({
  message = "불러오기에 실패했습니다.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <p className="text-2xl">⚠️</p>
      <p className="text-sm text-fg-muted">{message}</p>
      {onRetry && (
        <button className="btn-outline" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  );
}

export function EmptyView({
  title = "아직 데이터가 없어요",
  hint,
  action,
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
      <p className="text-3xl opacity-40">🗂️</p>
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint && <p className="max-w-sm text-xs text-fg-muted">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-10 animate-pulse rounded-lg bg-surface-2"
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}

"use client";

import type { RefObject } from "react";

interface QuickScrollButtonsProps {
  topRef: RefObject<HTMLElement>;
  bottomRef: RefObject<HTMLElement>;
}

export default function QuickScrollButtons({ topRef, bottomRef }: QuickScrollButtonsProps) {
  const scrollToTop = () => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const scrollToBottom = () => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });

  return (
    <div className="fixed right-3 top-1/2 z-30 hidden -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface/85 text-[11px] font-black text-fg-muted shadow-lg backdrop-blur transition-opacity hover:bg-surface focus-within:bg-surface md:flex">
      <button
        type="button"
        aria-label="맨 위로 이동"
        onClick={scrollToTop}
        className="min-h-10 w-12 border-b border-border px-2 py-2 transition-colors hover:bg-surface-2 hover:text-blue-700 focus:bg-surface-2 focus:text-blue-700 focus:outline-none"
      >
        TOP
      </button>
      <button
        type="button"
        aria-label="맨 아래로 이동"
        onClick={scrollToBottom}
        className="min-h-10 w-12 px-2 py-2 transition-colors hover:bg-surface-2 hover:text-blue-700 focus:bg-surface-2 focus:text-blue-700 focus:outline-none"
      >
        END
      </button>
    </div>
  );
}

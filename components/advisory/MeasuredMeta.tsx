"use client";

import type { MeasuredNumber } from "@/lib/advisory/types";

export default function MeasuredMeta({ n, className = "" }: { n: MeasuredNumber; className?: string }) {
  return (
    <p className={`text-[10px] leading-snug text-fg-muted ${className}`}>
      as-of {n.asOf.slice(0, 10)} · {n.source}
      {n.currency ? ` · ${n.currency}` : ""}
      {n.assumption ? ` · ${n.assumption}` : ""}
    </p>
  );
}

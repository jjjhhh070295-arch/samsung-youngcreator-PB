"use client";

import { useRouter } from "next/navigation";
import type { PB } from "@/lib/types";

interface Props {
  pb: PB;
  clientCount: number;
}

export default function PBCard({ pb, clientCount }: Props) {
  const router = useRouter();

  return (
    <div className="card flex flex-col p-5 transition-shadow hover:shadow-lg">
      {/* 상단: PB 이름 + 우측 상단 작은 열기 버튼 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-400/15 text-sm font-bold text-gold-400">
            {pb.name?.[0] ?? "?"}
          </span>
          <h3 className="text-lg font-semibold text-fg">{pb.name}</h3>
        </div>
        <button
          className="btn-gold h-7 px-2.5 text-xs"
          onClick={() => router.push(`/pb/${pb.id}`)}
        >
          열기 →
        </button>
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        담당 고객 <span className="font-semibold text-fg">{clientCount}</span>명
      </p>
    </div>
  );
}

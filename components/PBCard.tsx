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
      {/* 상단: 코드 + 우측 상단 작은 열기 버튼 */}
      <div className="flex items-start justify-between gap-2">
        <span className="badge-gold">{pb.code}</span>
        <button
          className="btn-gold h-7 px-2.5 text-xs"
          onClick={() => router.push(`/pb/${pb.id}`)}
        >
          열기 →
        </button>
      </div>

      <h3 className="mt-2 text-lg font-semibold text-fg">{pb.name}</h3>
      <p className="mt-1 text-sm text-fg-muted">
        담당 고객 <span className="font-semibold text-fg">{clientCount}</span>명
      </p>
    </div>
  );
}

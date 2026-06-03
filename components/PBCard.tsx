"use client";

import Link from "next/link";
import type { PB } from "@/lib/types";

interface Props {
  pb: PB;
  clientCount: number;
  onEdit: () => void;
  onDelete: () => void;
}

export default function PBCard({ pb, clientCount, onEdit, onDelete }: Props) {
  return (
    <div className="card group relative p-5 transition-shadow hover:shadow-lg">
      <Link href={`/pb/${pb.id}`} className="block">
        <div className="flex items-center gap-2">
          <span className="badge-gold">{pb.code}</span>
        </div>
        <h3 className="mt-2 text-lg font-semibold text-fg">{pb.name}</h3>
        <p className="mt-1 text-sm text-fg-muted">
          담당 고객 <span className="font-semibold text-fg">{clientCount}</span>명
        </p>
      </Link>
      <div className="mt-4 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          className="btn-ghost h-8 px-2 text-xs"
          onClick={(e) => {
            e.preventDefault();
            onEdit();
          }}
        >
          수정
        </button>
        <button
          className="btn-ghost h-8 px-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
          onClick={(e) => {
            e.preventDefault();
            onDelete();
          }}
        >
          삭제
        </button>
      </div>
    </div>
  );
}

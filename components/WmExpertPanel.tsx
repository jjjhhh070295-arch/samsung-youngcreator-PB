"use client";
import { useMemo, useState } from "react";
import type { TaxPainPoint } from "@/lib/portfolio";
import { expertForTaxPain, type WmExpert } from "@/lib/wmExperts";
import MeetingBookingModal from "./MeetingBookingModal";

export default function WmExpertPanel({ taxPainPoints }: { taxPainPoints: TaxPainPoint[] }) {
  const [expert, setExpert] = useState<WmExpert | null>(null); const [notice, setNotice] = useState("");
  const points = useMemo(() => taxPainPoints.filter((point) => point.severity === "높음" || point.severity === "중간"), [taxPainPoints]);
  const experts = useMemo(() => Array.from(new Map(points.map((point) => { const advisor = expertForTaxPain(point.id); return [advisor.id, advisor]; })).values()), [points]);
  if (!points.length) return <section className="rounded-2xl border border-border bg-surface p-5 text-sm text-fg-muted">현재 별도 세무 상담 권고가 없습니다.</section>;
  return <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm"><div className="border-b border-border pb-3"><h3 className="text-base font-bold text-fg">삼성 WM센터 전문 세무·패밀리오피스 상담</h3><p className="mt-1 text-xs leading-relaxed text-fg-muted">이 화면은 절세 실행안을 제안하지 않습니다. 전문가 상담이 필요한 영역을 안내합니다.</p></div>{notice && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">예약 요청이 접수되었습니다. {notice}</p>}<div className="mt-4 grid gap-3 lg:grid-cols-2">{experts.map((advisor) => <article key={advisor.id} className="rounded-xl border border-border bg-surface-2 p-4"><div className="flex items-start justify-between gap-3"><div><h4 className="font-bold text-fg">{advisor.name}</h4><p className="mt-1 text-xs text-fg-muted">{advisor.title}</p></div><span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800">{advisor.region}</span></div><div className="mt-3 flex flex-wrap gap-1">{advisor.specialties.map((item) => <span key={item} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-fg-muted">{item}</span>)}</div><p className="mt-3 text-xs text-fg-muted">{advisor.phone} · {advisor.email}</p><button type="button" onClick={() => setExpert(advisor)} className="mt-4 w-full rounded-lg border border-emerald-600 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50">상담 예약하기</button></article>)}</div><MeetingBookingModal expert={expert} open={Boolean(expert)} onClose={() => setExpert(null)} onConfirm={setNotice} /></section>;
}

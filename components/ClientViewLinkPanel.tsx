"use client";

/**
 * 고객 공유 링크 발급 — PB 상세 「고객화면」 탭 상단.
 *
 * 서명은 서버에서만 한다(POST /api/client-view). CLIENT_VIEW_SECRET 이 브라우저로
 * 나가면 누구나 아무 고객의 링크를 만들 수 있으므로, 이 컴포넌트는 발급을 요청만 한다.
 *
 * QR 도 우리 서버가 그린다(/api/client-view/qr). 외부 QR 이미지 API 를 쓰면 서명된
 * URL — 곧 살아 있는 자격증명 — 이 제3자 액세스 로그에 남는다.
 */

import { useState } from "react";

interface Props {
  clientId: string;
  pbId: string;
  clientName?: string;
}

interface Issued {
  url: string;
  token: string;
  expiresAt: string;
}

const TTL_OPTIONS = [
  { label: "1시간", sec: 60 * 60 },
  { label: "24시간", sec: 24 * 60 * 60 },
  { label: "7일", sec: 7 * 24 * 60 * 60 },
] as const;

export default function ClientViewLinkPanel({ clientId, pbId, clientName }: Props) {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [ttlSec, setTtlSec] = useState<number>(TTL_OPTIONS[1].sec);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const issue = async () => {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const res = await fetch("/api/client-view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, pbId, ttlSec }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        // 서버가 준 문구를 그대로 보여 준다 — CLIENT_VIEW_SECRET 미설정 같은 원인이
        // 여기서 바로 읽혀야 PB 가 담당자에게 무엇을 말할지 안다.
        setError(data?.error || "링크를 만들지 못했습니다.");
        setIssued(null);
        return;
      }
      setIssued({ url: data.url, token: data.token, expiresAt: data.expiresAt });
      setShowQr(false);
    } catch (e: any) {
      setError(e?.message || "링크를 만들지 못했습니다.");
      setIssued(null);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 권한이 없는 브라우저·http 환경 — 아래 입력창에서 직접 복사하면 된다.
      setError("자동 복사에 실패했습니다. 아래 주소를 직접 복사해 주세요.");
    }
  };

  return (
    <section className="rounded-lg border border-[#DCE4F5] bg-[#F7F9FE] px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-[#1428A0]">고객 공유 링크</h2>
          <p className="mt-0.5 text-[11px] text-[#64748B]">
            {clientName ? `${clientName} 님` : "이 고객"}이 PB 계정 없이 본인 화면만 볼 수 있는
            링크입니다. 유효기간이 지나면 자동으로 닫힙니다.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="text-[11px] text-[#64748B]">
            <span className="sr-only">유효기간</span>
            <select
              className="rounded border border-[#CBD5E1] bg-white px-2 py-1 text-[11px]"
              value={ttlSec}
              onChange={(e) => setTtlSec(Number(e.target.value))}
              disabled={busy}
            >
              {TTL_OPTIONS.map((o) => (
                <option key={o.sec} value={o.sec}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-primary text-xs" onClick={() => void issue()} disabled={busy}>
            {busy ? "생성 중…" : issued ? "새 링크 생성" : "링크 생성"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
          {error}
        </p>
      )}

      {issued && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={issued.url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded border border-[#CBD5E1] bg-white px-2 py-1 text-[11px] text-[#0F172A]"
            />
            <button type="button" className="btn-outline text-xs" onClick={() => void copy()}>
              {copied ? "복사됨" : "복사"}
            </button>
            <button type="button" className="btn-outline text-xs" onClick={() => setShowQr((v) => !v)}>
              {showQr ? "QR 접기" : "QR"}
            </button>
          </div>

          <p className="text-[10px] text-[#64748B]">
            {new Date(issued.expiresAt).toLocaleString("ko-KR")}까지 유효 · 링크를 가진 사람은
            누구나 열 수 있으니 본인에게만 전달하세요.
          </p>

          {showQr && (
            <div className="flex justify-center rounded border border-[#E2E8F0] bg-white p-3">
              {/* 우리 서버가 그린 SVG. 토큰이 외부로 나가지 않는다. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/client-view/qr?t=${encodeURIComponent(issued.token)}`}
                alt="고객 공유 링크 QR 코드"
                width={200}
                height={200}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

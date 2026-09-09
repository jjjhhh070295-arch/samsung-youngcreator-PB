"use client";

// 매도 입력 모달.
//
// HoldingsExtractor 에서 분리한 이유: 그 파일은 팀원이 자주 만지는 곳이라(KIS 심볼 매핑,
// 시세 스냅샷 등) 매도 UI 를 그 안에 넣으면 충돌면적이 커진다. 여기로 빼고 저쪽에는
// 버튼 한 줄만 둔다.
//
// 1단계 범위 — 이력 기록과 잔고 차감까지. AUM 은 건드리지 않는다. 그래서 이 모달은
// 실현손익을 "기록됩니다"라고만 말하고 "자산에 반영됩니다"라고 말하지 않는다.

import { useEffect, useMemo, useState } from "react";
import { formatKRW } from "@/lib/format";
import {
  computeGrossProceedsWon,
  computeRealizedPnlWon,
  recordSell,
  validateSellInput,
} from "@/lib/holdings/trades";

export interface SellTargetHolding {
  id: string;
  name: string;
  ticker: string | null;
  market: string | null;
  currency: string;
  quantity: number;
  avg_price: number | null;
}

interface Props {
  open: boolean;
  clientId: string;
  holding: SellTargetHolding | null;
  onClose: () => void;
  /** 기록 성공 후. 부모가 목록을 다시 읽고 자산 변경을 알린다. */
  onSold: () => void;
}

export default function SellHoldingModal({ open, clientId, holding, onClose, onSold }: Props) {
  const todayStr = new Date().toLocaleDateString("en-CA");

  const [quantityText, setQuantityText] = useState("");
  const [unitPriceText, setUnitPriceText] = useState("");
  const [fxRateText, setFxRateText] = useState("");
  const [tradedAt, setTradedAt] = useState(todayStr);
  const [feeText, setFeeText] = useState("");
  const [taxText, setTaxText] = useState("");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ClientForm 과 같은 이유로 "열릴 때 한 번만" 채운다. 부모가 뒤에서 갱신해도 입력 중인
  // 값이 되돌아가지 않게 한다 — 열려 있는 폼은 사용자 것이다.
  useEffect(() => {
    if (!open) return;
    setQuantityText("");
    setUnitPriceText("");
    setFxRateText("");
    setTradedAt(todayStr);
    setFeeText("");
    setTaxText("");
    setMemo("");
    setError("");
    setSaving(false);
    // holding?.id 만 본다. holding 객체는 부모가 재조회할 때마다 참조가 바뀐다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, holding?.id]);

  const isForeign = (holding?.currency ?? "KRW").toUpperCase() !== "KRW";
  const costBasis = holding?.avg_price ?? 0;

  const quantity = Number(quantityText);
  const unitPrice = Number(unitPriceText);
  const fxRate = fxRateText === "" ? null : Number(fxRateText);
  const feeWon = Number(feeText) || 0;
  const taxWon = Number(taxText) || 0;

  const preview = useMemo(() => {
    if (!holding) return null;
    if (!Number.isFinite(quantity) || quantity <= 0) return null;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return null;
    if (isForeign && (!Number.isFinite(fxRate ?? NaN) || (fxRate ?? 0) <= 0)) return null;
    return {
      gross: computeGrossProceedsWon(quantity, unitPrice, fxRate),
      pnl: computeRealizedPnlWon({
        quantity,
        unitPrice,
        costBasisUnitPrice: costBasis,
        fxRate,
        feeWon,
        taxWon,
      }),
      remaining: holding.quantity - quantity,
    };
  }, [holding, quantity, unitPrice, fxRate, feeWon, taxWon, costBasis, isForeign]);

  if (!open || !holding) return null;

  const submit = async () => {
    setError("");
    const reasons = validateSellInput({
      quantity,
      unitPrice,
      tradedAt,
      heldQuantity: holding.quantity,
      currency: holding.currency,
      fxRate,
    });
    if (reasons.length) {
      setError(reasons.join("\n"));
      return;
    }
    if (holding.avg_price == null) {
      setError(
        "평균매입단가가 없어 실현손익을 계산할 수 없습니다. 보유종목의 매입단가를 먼저 채워 주세요.",
      );
      return;
    }

    setSaving(true);
    try {
      await recordSell({
        clientId,
        holdingId: holding.id,
        name: holding.name,
        ticker: holding.ticker,
        market: holding.market,
        currency: holding.currency,
        heldQuantity: holding.quantity,
        costBasisUnitPrice: holding.avg_price,
        quantity,
        unitPrice,
        fxRate,
        tradedAt,
        feeWon,
        taxWon,
        memo: memo.trim() || null,
      });
      onSold();
      onClose();
    } catch (e) {
      // 기록 실패는 반드시 화면에 드러낸다. 조용히 넘어가면 잔고만 줄고 근거가 사라진다.
      setError(e instanceof Error ? e.message : "매도 기록에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-black text-fg">매도 기록</h3>
        <p className="mt-1 text-xs text-fg-muted">
          {holding.name}
          {holding.ticker ? ` (${holding.ticker})` : ""} · 보유{" "}
          {holding.quantity.toLocaleString("ko-KR")}주 · 평단{" "}
          {holding.avg_price == null ? "미입력" : holding.avg_price.toLocaleString("ko-KR")}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="label">매도 수량</label>
            <input
              className="input w-full text-right tabular-nums"
              inputMode="decimal"
              value={quantityText}
              onChange={(e) => setQuantityText(e.target.value)}
              placeholder={String(holding.quantity)}
            />
          </div>
          <div>
            <label className="label">매도 단가{isForeign ? ` (${holding.currency})` : ""}</label>
            <input
              className="input w-full text-right tabular-nums"
              inputMode="decimal"
              value={unitPriceText}
              onChange={(e) => setUnitPriceText(e.target.value)}
            />
          </div>
          {isForeign && (
            <div>
              <label className="label">체결 환율</label>
              <input
                className="input w-full text-right tabular-nums"
                inputMode="decimal"
                value={fxRateText}
                onChange={(e) => setFxRateText(e.target.value)}
                placeholder="예: 1380"
              />
            </div>
          )}
          <div>
            <label className="label">매도일</label>
            <input
              className="input w-full"
              type="date"
              max={todayStr}
              value={tradedAt}
              onChange={(e) => setTradedAt(e.target.value)}
            />
          </div>
          <div>
            <label className="label">수수료 (원)</label>
            <input
              className="input w-full text-right tabular-nums"
              inputMode="decimal"
              value={feeText}
              onChange={(e) => setFeeText(e.target.value)}
              placeholder="0"
            />
          </div>
          <div>
            <label className="label">거래세 (원)</label>
            <input
              className="input w-full text-right tabular-nums"
              inputMode="decimal"
              value={taxText}
              onChange={(e) => setTaxText(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="col-span-2">
            <label className="label">메모 (선택)</label>
            <input
              className="input w-full"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="예: 리밸런싱 차익 실현"
            />
          </div>
        </div>

        {preview && (
          <div className="mt-4 rounded-xl border border-border bg-surface-2 p-3 text-xs">
            <div className="flex justify-between">
              <span className="text-fg-muted">매도대금</span>
              <span className="font-bold text-fg tabular-nums">{formatKRW(preview.gross)}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-fg-muted">실현손익</span>
              <span
                className={`font-black tabular-nums ${
                  preview.pnl > 0
                    ? "text-red-500"
                    : preview.pnl < 0
                      ? "text-blue-600"
                      : "text-fg"
                }`}
              >
                {preview.pnl > 0 ? "+" : ""}
                {formatKRW(preview.pnl)}
              </span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-fg-muted">매도 후 잔여</span>
              <span className="font-bold text-fg tabular-nums">
                {preview.remaining.toLocaleString("ko-KR")}주
                {preview.remaining === 0 ? " (전량 매도 — 종목이 목록에서 사라집니다)" : ""}
              </span>
            </div>
            <p className="mt-2 leading-relaxed text-fg-muted">
              실현손익은 거래 이력에 기록됩니다. 이번 단계에서는 자산규모(AUM)에 자동
              반영되지 않으므로, 필요하면 기본정보에서 직접 갱신해 주세요.
            </p>
          </div>
        )}

        {error && (
          <p className="mt-3 whitespace-pre-line rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600 dark:bg-red-950/40">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost px-4 py-2 text-xs" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="btn-primary px-5 py-2 text-xs disabled:opacity-40"
            disabled={saving || !preview}
            onClick={submit}
          >
            {saving ? "기록 중…" : "매도 기록"}
          </button>
        </div>
      </div>
    </div>
  );
}

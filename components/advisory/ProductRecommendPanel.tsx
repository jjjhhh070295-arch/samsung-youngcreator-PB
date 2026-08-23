"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Client } from "@/lib/types";
import type { RecommendResult } from "@/lib/advisory/types";
import { PRODUCT_CATEGORY_LABEL } from "@/lib/advisory/types";
import { appendRun, loadBundle, saveBundle } from "@/lib/advisory/control";
import {
  DEMO_CATALOG_AS_OF,
  DEMO_SALE_PRODUCTS,
  PRODUCT_GUIDES,
  demoProductName,
} from "./productRecommendationDemoData";
import type { DemoSaleProduct, ProductGuide } from "./productRecommendationDemoData";

type ProductView = "candidates" | "saleable" | "guide";
type DetailSelection =
  | { kind: "product"; item: DemoSaleProduct }
  | { kind: "guide"; item: ProductGuide };

const PRODUCT_VIEWS: Array<{ id: ProductView; label: string; description: string }> = [
  { id: "candidates", label: "추천 후보", description: "고객 조건을 반영한 교육용 A/B/C안" },
  { id: "saleable", label: "판매·상담 가능 상품", description: "교육용 가상 판매상태와 차단 사유" },
  { id: "guide", label: "상품 이해 가이드", description: "복잡한 상품을 쉬운 말로 확인" },
];

const STATUS_STYLE: Record<DemoSaleProduct["status"], { badge: string; card: string; icon: string }> = {
  demo_available: { badge: "border-green-200 bg-green-50 text-green-800", card: "border-border", icon: "✓" },
  demo_review: { badge: "border-amber-200 bg-amber-50 text-amber-900", card: "border-amber-200", icon: "!" },
  demo_blocked: { badge: "border-red-200 bg-red-50 text-red-700", card: "border-red-300", icon: "×" },
};

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8] focus-visible:ring-offset-2";

export default function ProductRecommendPanel({ client }: { client: Client }) {
  const [activeView, setActiveView] = useState<ProductView>("candidates");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecommendResult | null>(null);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<DetailSelection | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreDetailFocusRef = useRef(false);

  const run = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/advisory/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client, constraintText: text }),
      });
      const data = await res.json();
      if (!data.ok) {
        if (data.bundle?.runs?.[0]) {
          let blockedRunBundle = loadBundle(client.id);
          blockedRunBundle = appendRun(blockedRunBundle, {
            kind: "recommend",
            engine: data.bundle.runs[0].engine ?? "deterministic-catalog",
            inputHash: data.bundle.inputHash ?? "",
            outputHash: data.bundle.outputHash ?? "",
            notes: data.error ?? "고객 제안 차단",
            judge: data.judge,
            citations: data.bundle.citations ?? [],
          });
          saveBundle(blockedRunBundle);
          window.dispatchEvent(new Event("pb-evidence-updated"));
        }
        throw new Error(data.error || "고객 제안 차단: 추천 검증 실패");
      }
      setResult(data.result as RecommendResult);
      let next = loadBundle(client.id);
      next = appendRun(next, {
        kind: "recommend",
        engine: "deterministic-catalog",
        inputHash: data.bundle.inputHash,
        outputHash: data.bundle.outputHash,
        notes: data.bundle.runs?.[0]?.notes ?? "상품 추천 산출",
        judge: data.judge,
        citations: data.result?.citations ?? data.bundle.citations ?? [],
      });
      // 추천 Judge·출처는 추천 응답에만 유지한다. 고객 PDF 게이트용 계산 Judge·인용을 덮어쓰지 않는다.
      saveBundle(next);
      window.dispatchEvent(new Event("pb-evidence-updated"));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "추천을 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const selectView = (next: ProductView, focus = false) => {
    setActiveView(next);
    if (focus) {
      const index = PRODUCT_VIEWS.findIndex((view) => view.id === next);
      tabRefs.current[index]?.focus();
    }
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % PRODUCT_VIEWS.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + PRODUCT_VIEWS.length) % PRODUCT_VIEWS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = PRODUCT_VIEWS.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    selectView(PRODUCT_VIEWS[nextIndex].id, true);
  };

  const openDetail = (selection: DetailSelection, trigger: HTMLButtonElement) => {
    detailTriggerRef.current = trigger;
    setDetail(selection);
  };

  const closeDetail = useCallback(() => {
    restoreDetailFocusRef.current = true;
    setDetail(null);
  }, []);

  useLayoutEffect(() => {
    if (detail !== null || !restoreDetailFocusRef.current) return;
    restoreDetailFocusRef.current = false;
    detailTriggerRef.current?.focus({ preventScroll: true });
  }, [detail]);

  return (
    <section
      className="product-recommendation-shell min-w-0 space-y-4 [color-scheme:light]"
      aria-labelledby="product-recommendation-title"
    >
      <div className="card overflow-hidden">
        <div className="border-b border-border bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#1428A0] px-2.5 py-1 text-[11px] font-bold text-white">
                  교육용 데모
                </span>
                <span className="text-xs text-fg-muted">기준일 {DEMO_CATALOG_AS_OF}</span>
              </div>
              <h2 id="product-recommendation-title" className="text-lg font-bold text-fg sm:text-xl">
                상품추천 검토 워크스페이스
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-fg-muted">
                PB가 후보를 비교하고 복잡한 상품을 설명하기 위한 교육용 화면입니다. 실제 삼성증권 내부 상품 DB,
                판매승인, 재고, 수수료, 운용사 자료와 연결되어 있지 않으며 PB의 판단과 준법 절차를 대신하지 않습니다.
              </p>
            </div>
            <div className="rounded-lg border border-[#DCE4F5] bg-[#F0F3FA] px-3 py-2 text-xs text-fg-muted">
              고객: <strong className="text-fg">{client.name}</strong>
            </div>
          </div>
        </div>

        <div role="tablist" aria-label="상품추천 내부 보기" className="grid grid-cols-1 gap-2 bg-[#F0F3FA] p-2 sm:grid-cols-3">
          {PRODUCT_VIEWS.map((view, index) => {
            const active = activeView === view.id;
            return (
              <button
                key={view.id}
                ref={(element) => { tabRefs.current[index] = element; }}
                id={`product-tab-${view.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`product-panel-${view.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => selectView(view.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`min-h-14 rounded-lg border px-3 py-2 text-left transition-colors ${FOCUS_RING} ${
                  active ? "border-[#1428A0] bg-[#1428A0] text-white" : "border-transparent bg-white text-fg hover:border-[#8A9BFF]"
                }`}
              >
                <span className="block text-sm font-bold">{view.label}</span>
                <span className={`mt-0.5 block text-[11px] ${active ? "text-white/75" : "text-fg-muted"}`}>{view.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {activeView === "candidates" && (
        <div id="product-panel-candidates" role="tabpanel" aria-labelledby="product-tab-candidates" className="min-w-0 space-y-4">
          <div className="card p-4 sm:p-5">
            <h3 className="text-base font-bold text-fg">고객 맞춤 추천 후보 만들기 (데모)</h3>
            <p className="mt-1 text-sm leading-relaxed text-fg-muted">
              상담메모·현금흐름·RRTTLLU·투자성향·세금일정을 반영해 교육용 후보를 정렬합니다. 비중·세금·손실한도는
              확정하지 않으며, 실제 판매 가능 여부는 별도로 확인해야 합니다.
            </p>
            <label htmlFor="recommendation-constraint" className="mt-4 block text-xs font-bold text-fg">추가 조건</label>
            <textarea
              id="recommendation-constraint"
              className={`input mt-1 min-h-[96px] ${FOCUS_RING}`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="예: 12개월 안에 필요한 현금은 제외 / 신탁만 검토 / 해외주식 비중 확대 후보"
            />
            <button
              type="button"
              className={`btn-primary mt-3 min-h-11 w-full sm:w-auto ${FOCUS_RING}`}
              onClick={() => void run()}
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? "교육용 후보 계산 중…" : "교육용 A/B/C 추천 후보 생성"}
            </button>
            {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
          </div>

          <div aria-live="polite" aria-atomic="true" className="sr-only">
            {result ? "교육용 추천 후보가 생성되었습니다." : ""}
          </div>

          {result ? (
            <>
              <div className="rounded-lg border border-[#DCE4F5] bg-[#F0F3FA] px-3 py-2 text-xs text-fg-muted">
                교육용 산출 · as-of {result.asOf} · {result.source} · {result.currency}
                {result.constraints.tags.length > 0 && (
                  <span className="ml-2 font-semibold text-[#1428A0]">조건: {result.constraints.tags.join(" · ")}</span>
                )}
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-3">
                {result.plans.map((plan) => (
                  <article key={plan.id} className="card min-w-0 overflow-hidden p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-bold text-fg">{plan.label}</h3>
                      <span className="rounded-full bg-[#1428A0] px-2 py-0.5 text-[10px] text-white">{plan.posture}</span>
                    </div>
                    <p className="mb-3 text-xs leading-relaxed text-fg-muted">{plan.constraintNote}</p>
                    {plan.products.length === 0 ? (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-900">
                        입력 조건을 충족한다고 확인된 교육용 후보가 없습니다. 조건을 낮추기 전에 고객 목표와 손실감수능력을 다시 확인하세요.
                      </p>
                    ) : (
                      <ul className="space-y-3">
                        {plan.products.map((product) => (
                        <li key={`${plan.id}-${product.name}`} className="min-w-0 border-t border-border pt-3 first:border-0 first:pt-0">
                          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                            <p className="min-w-0 break-words text-sm font-semibold text-fg">{demoProductName(product.name)}</p>
                            <span className="shrink-0 rounded-full bg-[#EEF1FF] px-2 py-0.5 text-[10px] font-semibold text-[#1428A0]">
                              교육용 가상 상품
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-fg-muted">
                            {PRODUCT_CATEGORY_LABEL[product.category]} · {product.role} · {product.suggestedWeightRange} (미확정)
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-fg">{product.fitReason}</p>
                          {product.expectedReturnPct && (
                            <p className="mt-1 break-words text-[11px] text-fg-muted">
                              시장 proxy {product.expectedReturnPct.value}% · as-of {product.expectedReturnPct.asOf.slice(0, 10)} · {product.expectedReturnPct.source}
                            </p>
                          )}
                          <dl className="mt-2 space-y-1 text-[11px] leading-relaxed">
                            <div><dt className="inline font-bold text-fg">위험 </dt><dd className="inline text-fg-muted">{product.riskNote}</dd></div>
                            <div><dt className="inline font-bold text-fg">유동성 </dt><dd className="inline text-fg-muted">{product.liquidityNote}</dd></div>
                            <div><dt className="inline font-bold text-fg">세금 </dt><dd className="inline text-fg-muted">{product.taxNote}</dd></div>
                          </dl>
                        </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-3 rounded-lg bg-[#F0F3FA] p-2 text-[11px] leading-relaxed text-fg-muted">{plan.weightDisclaimer}</p>
                  </article>
                ))}
              </div>
              <p className="text-xs leading-relaxed text-fg-muted">{result.disclaimers.join(" ")}</p>
              {result.citations && result.citations.length > 0 && (
                <details className="card p-4 text-xs text-fg-muted">
                  <summary className={`cursor-pointer font-bold text-fg ${FOCUS_RING}`}>추천 산출 출처 메타데이터</summary>
                  <ul className="mt-3 space-y-2">
                    {result.citations.map((citation) => (
                      <li key={`${citation.sourceId}-${citation.chunkId}`} className="break-words leading-relaxed">
                        <strong className="text-fg">{citation.title}</strong> · as-of {citation.asOf} · {citation.sourceId} · chunk {citation.chunkId}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <div className="card border-dashed p-6 text-center">
              <p className="font-bold text-fg">아직 생성된 추천 후보가 없습니다.</p>
              <p className="mt-1 text-sm text-fg-muted">추가 조건을 입력하거나 그대로 실행해 교육용 A/B/C안을 비교하세요.</p>
            </div>
          )}
        </div>
      )}

      {activeView === "saleable" && (
        <div id="product-panel-saleable" role="tabpanel" aria-labelledby="product-tab-saleable" className="min-w-0 space-y-3">
          <div className="rounded-xl border border-[#8A9BFF] bg-[#EEF1FF] p-4 text-sm leading-relaxed text-[#0F1E7A]">
            <strong>교육용 가상 판매·상담 상태입니다.</strong> 삼성증권의 실제 소싱 상품, 판매 가능 목록, 본부 승인,
            청약 일정 또는 영업전략을 뜻하지 않습니다. 실제 구현에는 상품 마스터·준법승인·재고·문서 유효기간 데이터가 필요합니다.
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {DEMO_SALE_PRODUCTS.map((product) => {
              const statusStyle = STATUS_STYLE[product.status];
              const describedBy = product.blockReason ? `block-reason-${product.id}` : undefined;
              return (
                <article key={product.id} className={`card min-w-0 overflow-hidden border-2 p-4 ${statusStyle.card}`} aria-describedby={describedBy}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-fg-muted">
                        {product.classification.vehicle} · {product.classification.strategy}
                      </p>
                      <h3 className="mt-1 break-words text-base font-bold text-fg">{demoProductName(product.name)}</h3>
                      <span className="mt-2 inline-flex rounded-full border border-[#8A9BFF] bg-[#EEF1FF] px-2 py-1 text-[11px] font-bold text-[#1428A0]">
                        교육용 가상 상품
                      </span>
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold ${statusStyle.badge}`}>
                      <span aria-hidden="true">{statusStyle.icon}</span>{product.statusLabel}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-fg-muted">{product.summary}</p>
                  <dl className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-[#DCE4F5] bg-white p-3 text-xs sm:grid-cols-2">
                    {[
                      ["모집 구분", product.classification.offering],
                      ["투자자 구분", product.eligibility],
                      ["최소 투자금액", product.minimumInvestment],
                      ["위험등급·고난도", product.riskGrade],
                      ["최대손실", product.maximumLoss],
                      ["만기·락업·환매", product.liquidity],
                      ["비용", product.fees],
                      ["문서·출처", `${product.documentStatus} · ${product.source}`],
                    ].map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <dt className="font-bold text-fg">{label}</dt>
                        <dd className="mt-0.5 break-words leading-relaxed text-fg-muted">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-3 space-y-2 rounded-lg bg-[#F0F3FA] p-3 text-xs leading-relaxed">
                    <p><strong className="text-fg">시장 국면 적합성 가설:</strong> <span className="text-fg-muted">{product.marketContext}</span></p>
                    <p><strong className="text-fg">고객 적합성 가설:</strong> <span className="text-fg-muted">{product.fitHypothesis}</span></p>
                  </div>
                  {product.blockReason && (
                    <p id={describedBy} className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold leading-relaxed text-red-700">
                      고객 제안 차단 사유: {product.blockReason}
                    </p>
                  )}
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      className={`btn-outline min-h-11 flex-1 ${FOCUS_RING}`}
                      onClick={(event) => openDetail({ kind: "product", item: product }, event.currentTarget)}
                    >
                      상품 상세 및 PB 확인사항 열기
                    </button>
                    {product.status === "demo_blocked" && (
                      <button type="button" className="btn-danger min-h-11 flex-1" disabled aria-describedby={describedBy}>
                        고객 제안 차단
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {activeView === "guide" && (
        <div id="product-panel-guide" role="tabpanel" aria-labelledby="product-tab-guide" className="min-w-0 space-y-3">
          <div className="rounded-xl border border-[#DCE4F5] bg-white p-4">
            <h3 className="font-bold text-fg">복잡상품을 설명할 때의 순서</h3>
            <p className="mt-1 text-sm leading-relaxed text-fg-muted">
              이름보다 ① 돈이 어디에 투자되는지 ② 언제 현금화할 수 있는지 ③ 최악의 손실은 무엇인지 ④ 비용과 이해상충은 무엇인지
              ⑤ 고객 현금흐름과 맞는지를 먼저 확인합니다.
            </p>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {PRODUCT_GUIDES.map((guide) => (
              <article key={guide.id} className="card min-w-0 overflow-hidden p-4">
                <p className="text-xs font-semibold text-[#1428A0]">상품 이해 가이드</p>
                <h3 className="mt-1 text-base font-bold text-fg">{guide.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{guide.shortDescription}</p>
                <div className="mt-3 rounded-lg bg-[#F0F3FA] p-3 text-xs leading-relaxed text-fg"><strong>쉬운 설명:</strong> {guide.plainLanguage}</div>
                <p className="mt-3 text-xs font-semibold leading-relaxed text-red-700">주의: {guide.caution}</p>
                <button
                  type="button"
                  className={`btn-outline mt-4 min-h-11 w-full ${FOCUS_RING}`}
                  onClick={(event) => openDetail({ kind: "guide", item: guide }, event.currentTarget)}
                >
                  가이드 상세 및 PB 질문 열기
                </button>
              </article>
            ))}
          </div>
        </div>
      )}

      {detail && <ProductDetailDialog selection={detail} onClose={closeDetail} />}
    </section>
  );
}

function ProductDetailDialog({ selection, onClose }: { selection: DetailSelection; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const title = selection.kind === "product" ? selection.item.name : selection.item.title;
  const description = selection.kind === "product" ? selection.item.summary : selection.item.plainLanguage;
  const caution = selection.kind === "product" ? selection.item.blockReason : selection.item.caution;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-detail-title"
        aria-describedby="product-detail-description"
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-[#DCE4F5] bg-white p-4 text-fg shadow-2xl [color-scheme:light] sm:max-w-2xl sm:rounded-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-[#1428A0]">{selection.kind === "product" ? "교육용 가상 상품 상세" : "상품 이해 가이드"}</p>
            <h2 id="product-detail-title" className="mt-1 break-words text-lg font-bold text-fg">{title}</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className={`shrink-0 rounded-lg border border-border bg-white px-3 py-2 text-sm font-bold text-fg hover:bg-[#F0F3FA] ${FOCUS_RING}`}
            onClick={onClose}
            aria-label="상품 상세 닫기"
          >
            닫기 ×
          </button>
        </div>
        <p id="product-detail-description" className="mt-3 text-sm leading-relaxed text-fg-muted">{description}</p>
        {caution && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold leading-relaxed text-red-700">
            {selection.kind === "product" ? "고객 제안 차단 사유" : "주의"}: {caution}
          </p>
        )}
        <div className="mt-4 space-y-4">
          {selection.item.sections.map((section, sectionIndex) => (
            <section key={section.title} aria-labelledby={`detail-section-${sectionIndex}`}>
              <h3 id={`detail-section-${sectionIndex}`} className="text-sm font-bold text-fg">{section.title}</h3>
              <ul className="mt-2 space-y-2 text-sm leading-relaxed text-fg-muted">
                {section.items.map((line) => (
                  <li key={line} className="flex gap-2">
                    <span className="font-bold text-[#1428A0]" aria-hidden="true">•</span><span>{line}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-5 border-t border-border pt-4 text-xs leading-relaxed text-fg-muted">
          교육용 가상 정보입니다. 실제 고객 설명 전에는 최신 상품설명서·약관·위험등급·수수료·환매조건·판매 가능 여부를 확인해야 합니다.
        </p>
      </div>
    </div>
  );
}

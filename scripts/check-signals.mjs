/**
 * scoreResearchSignals 검증 스크립트 v2
 * - 이전 방식(소스 무시 합산 + clamp) vs 새 방식(캡 + 가중평균 정규화 × SIGNAL_SCALE) 비교
 * - 실행: node scripts/check-signals.mjs
 */

const MAX_SOURCE_WEIGHT = 0.25;
const SIGNAL_SCALE = 10;
const WINDOW_DAYS = 30;

function dateRecencyWeight(date) {
  if (!date) return 2;
  const t = new Date(date).getTime();
  if (isNaN(t)) return 2;
  const days = (Date.now() - t) / 86_400_000;
  if (days <= 7)  return 4;
  if (days <= 14) return 3;
  if (days <= 30) return 2;
  return 1;
}
function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString().split("T")[0];
}
function clampOld(v) { return Math.max(-8, Math.min(12, Math.round(v))); }
function clampNew(v) { return Math.max(-SIGNAL_SCALE, Math.min(SIGNAL_SCALE, Math.round(v))); }

// ── 이전 방식: 소스 구분 없이 합산 + clamp(-8,12) ──────────────────────────
function scoreOld(items) {
  const raw = {};
  for (const item of items) {
    const w = dateRecencyWeight(item.date);
    if (item.analysis?.length) {
      for (const a of item.analysis)
        raw[a.signal] = (raw[a.signal] ?? 0) + a.direction * a.strength * w;
    } else {
      for (const sig of item.signals)
        raw[sig] = (raw[sig] ?? 0) + w;
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(raw)) out[k] = { raw: v, score: clampOld(v) };
  return out;
}

// ── 새 방식: signal→source→캡→정규화 + clamp(-10,10) ─────────────────────
function scoreNew(items) {
  const sourceScores = {};
  for (const item of items) {
    const w = dateRecencyWeight(item.date);
    const source = item.source.split(" · ")[0];
    if (item.analysis?.length) {
      for (const a of item.analysis) {
        sourceScores[a.signal] ??= {};
        sourceScores[a.signal][source] = (sourceScores[a.signal][source] ?? 0)
          + a.direction * a.strength * w;
      }
    } else {
      for (const sig of item.signals) {
        sourceScores[sig] ??= {};
        sourceScores[sig][source] = (sourceScores[sig][source] ?? 0) + w;
      }
    }
  }

  const out = {};
  const details = {};
  for (const [signal, bySource] of Object.entries(sourceScores)) {
    const entries = Object.entries(bySource);
    const totalAbsBeforeCap = entries.reduce((s, [, v]) => s + Math.abs(v), 0);
    let cappedSum = 0;
    const parts = [];
    const capped = [];

    for (const [src, raw] of entries) {
      const share = totalAbsBeforeCap > 0 ? Math.abs(raw) / totalAbsBeforeCap : 0;
      if (share > MAX_SOURCE_WEIGHT) {
        const cappedVal = Math.sign(raw) * totalAbsBeforeCap * MAX_SOURCE_WEIGHT;
        capped.push({ src, raw, cappedVal, share });
        cappedSum += cappedVal;
        parts.push({ src, raw, cappedVal, share, hit: true });
      } else {
        cappedSum += raw;
        parts.push({ src, raw, cappedVal: raw, share, hit: false });
      }
    }

    const capFactor = totalAbsBeforeCap > 0 ? cappedSum / totalAbsBeforeCap : 0;
    const scaledScore = capFactor * SIGNAL_SCALE;
    out[signal] = { cappedSum, capFactor, scaledScore, score: clampNew(scaledScore) };
    details[signal] = { parts, capped, totalAbsBeforeCap };
  }
  return { out, details };
}

// ── 합성 테스트 데이터 (이전과 동일) ────────────────────────────────────────
const ITEMS = [
  // equity: 미래에셋 6건(80%) + 하나 2건 + KB 1건 + 키움 1건
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `mae-${i}`, source: "미래에셋증권 · 글로벌전략팀",
    date: daysAgo(3), signals: ["equity"],
    analysis: [{ signal: "equity", direction: 1, strength: 3 }],
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `hana-eq-${i}`, source: "하나증권 · 리서치",
    date: daysAgo(8), signals: ["equity"],
    analysis: [{ signal: "equity", direction: 1, strength: 2 }],
  })),
  { id: "kb-1", source: "KB증권 · 리서치", date: daysAgo(15), signals: ["equity"],
    analysis: [{ signal: "equity", direction: 1, strength: 2 }] },
  { id: "kiwoom-1", source: "키움증권", date: daysAgo(22), signals: ["equity"],
    analysis: [{ signal: "equity", direction: 1, strength: 1 }] },

  // bond: 하나 4건(67%) + 신한 2건 + KB 2건
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `hana-bd-${i}`, source: "하나증권 · 리서치",
    date: daysAgo(5), signals: ["bond"],
    analysis: [{ signal: "bond", direction: 1, strength: 2 }],
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `shinhan-bd-${i}`, source: "신한투자증권",
    date: daysAgo(10), signals: ["bond"],
    analysis: [{ signal: "bond", direction: 1, strength: 2 }],
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `kb-bd-${i}`, source: "KB증권 · 리서치",
    date: daysAgo(18), signals: ["bond"],
    analysis: [{ signal: "bond", direction: 1, strength: 1 }],
  })),

  // gold: 3개 소스 균등(40/30/30%) — 3개 모두 캡 발동 확인용
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `mae-gold-${i}`, source: "미래에셋증권 · 글로벌전략팀",
    date: daysAgo(4), signals: ["gold"],
    analysis: [{ signal: "gold", direction: 1, strength: 2 }],
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `kb-gold-${i}`, source: "KB증권 · 리서치",
    date: daysAgo(9), signals: ["gold"],
    analysis: [{ signal: "gold", direction: 1, strength: 2 }],
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `hana-gold-${i}`, source: "하나증권 · 리서치",
    date: daysAgo(12), signals: ["gold"],
    analysis: [{ signal: "gold", direction: 1, strength: 2 }],
  })),

  // liquidity: 단 1건 (single-source, low data)
  { id: "liq-1", source: "미래에셋증권 · 글로벌전략팀",
    date: daysAgo(6), signals: ["liquidity"],
    analysis: [{ signal: "liquidity", direction: 1, strength: 3 }] },
];

const windowed = ITEMS.filter(
  (item) => !item.date || (Date.now() - new Date(item.date).getTime()) / 86_400_000 <= WINDOW_DAYS,
);

const sourceDist = {};
for (const item of windowed) {
  const src = item.source.split(" · ")[0];
  sourceDist[src] = (sourceDist[src] ?? 0) + 1;
}

const oldScores = scoreOld(windowed);
const { out: newScores, details } = scoreNew(windowed);

const ALL_SIGNALS = ["equity", "bond", "liquidity", "dollar", "gold", "risk", "tax"];

// ── ① 수집 ────────────────────────────────────────────────────────────────
console.log("═".repeat(65));
console.log("① 수집 결과 (window=30d)");
console.log("═".repeat(65));
console.log(`  전체 ${windowed.length}건`);
for (const [src, cnt] of Object.entries(sourceDist).sort((a, b) => b[1] - a[1]))
  console.log(`  ${src.padEnd(22)} ${cnt}건`);

// ── ② 소스 비중 캡 상세 ──────────────────────────────────────────────────
console.log("\n" + "═".repeat(65));
console.log("② 소스 비중 캡 적용 상세");
console.log("═".repeat(65));

for (const signal of ALL_SIGNALS) {
  const d = details[signal];
  if (!d) { console.log(`  [${signal}] 리포트 없음`); continue; }
  const { parts, totalAbsBeforeCap } = d;
  console.log(`\n  [${signal}]  totalAbs(pre-cap)=${totalAbsBeforeCap.toFixed(1)}`);
  for (const { src, raw, share, hit } of parts) {
    const pct = (share * 100).toFixed(0).padStart(3);
    const bar = "█".repeat(Math.round(share * 20)).padEnd(20);
    const hitMark = hit ? " ◀ CAP!" : "";
    console.log(`    ${src.padEnd(22)} ${bar} ${pct}%  raw=${raw.toFixed(1)}${hitMark}`);
  }
  if (d.capped.length > 0) {
    for (const { src, raw, cappedVal } of d.capped)
      console.log(`    → ${src}: ${raw.toFixed(1)} → ${cappedVal.toFixed(1)}  (버림 ${(raw - cappedVal).toFixed(1)})`);
  } else {
    console.log("    → 캡 미발동 (모든 소스 ≤25%)");
  }
  const ns = newScores[signal];
  console.log(`    capFactor=${ns.capFactor.toFixed(3)}  cappedSum=${ns.cappedSum.toFixed(1)}  scaled=${ns.scaledScore.toFixed(2)}`);
}

// ── ③ low_confidence (리포트 건수 기준) ──────────────────────────────────
console.log("\n" + "═".repeat(65));
console.log("③ low_confidence 판단 (기여 리포트 ≤2건 자산군)");
console.log("═".repeat(65));
for (const signal of ALL_SIGNALS) {
  const cnt = windowed.filter((it) =>
    it.signals.includes(signal) || it.analysis?.some((a) => a.signal === signal)
  ).length;
  const low = cnt <= 2;
  console.log(`  [${signal}] ${cnt}건 → ${low ? "⚠ LOW_CONFIDENCE" : "정상"}${cnt === 0 ? " (데이터 없음)" : ""}`);
}
console.log(`  ※ low_confidence 필드는 현재 ResearchSignalScore 타입에 없음 (미구현)`);

// ── ④ 이전/새 점수 비교 ──────────────────────────────────────────────────
console.log("\n" + "═".repeat(65));
console.log("④ 최종 점수 비교");
console.log("═".repeat(65));
console.log("  signal      [이전] raw→score(clamp±8/12)   [새] factor→scaled→score(clamp±10)   차이");
console.log("  " + "─".repeat(63));

for (const signal of ALL_SIGNALS) {
  const o = oldScores[signal] ?? { raw: 0, score: 0 };
  const n = newScores[signal] ?? { capFactor: 0, scaledScore: 0, score: 0 };
  const diff = n.score - o.score;
  const diffStr = diff > 0 ? `+${diff}` : String(diff);
  const mark = diff !== 0 ? " ◀" : "";
  console.log(
    `  ${signal.padEnd(12)}` +
    `${String(o.raw.toFixed(1)).padStart(8)} → ${String(o.score).padStart(3)}   ` +
    `   ${n.capFactor.toFixed(3)} → ${n.scaledScore.toFixed(1).padStart(5)} → ${String(n.score).padStart(3)}   ` +
    `${diffStr.padStart(4)}${mark}`,
  );
}

// ── ⑤ 임계값 호환성 확인 ─────────────────────────────────────────────────
console.log("\n" + "═".repeat(65));
console.log("⑤ 다운스트림 임계값 호환성");
console.log("═".repeat(65));
const checks = [
  ["equity >= 5 (ETF 바스켓)", "equity", (s) => s >= 5],
  ["risk   >= 8 (고위험 신호)", "risk",   (s) => s >= 8],
  ["bond   >  0 (금리 아웃룩)", "bond",   (s) => s > 0],
  ["gold   >  0 (실물자산 적합)", "gold",  (s) => s > 0],
];
for (const [label, sig, fn] of checks) {
  const oScore = oldScores[sig]?.score ?? 0;
  const nScore = newScores[sig]?.score ?? 0;
  const changed = fn(oScore) !== fn(nScore) ? " ← 결과 달라짐!" : "";
  console.log(`  ${label.padEnd(25)}  이전=${fn(oScore)}(${oScore})  새=${fn(nScore)}(${nScore})${changed}`);
}

// ── ⑥ 이상 탐지 ──────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(65));
console.log("⑥ 이상 탐지");
console.log("═".repeat(65));

// equity/bond/gold 에서 이전과 새 점수가 달라야 함 (캡 효과 검증)
const mustDiffer = ["equity", "bond", "gold"];
for (const sig of mustDiffer) {
  const o = oldScores[sig]?.score ?? 0;
  const n = newScores[sig]?.score ?? 0;
  if (o === n)
    console.log(`  ⚠ [${sig}] 캡 적용 후에도 점수 동일 (${o}) — 정규화가 효과 없음`);
  else
    console.log(`  ✓ [${sig}] 캡 효과 확인: ${o} → ${n}`);
}

// liquidity 단독 소스 캡
const liqN = newScores["liquidity"]?.score ?? 0;
const liqO = oldScores["liquidity"]?.score ?? 0;
if (liqN < liqO)
  console.log(`  ✓ [liquidity] 단독 소스 캡 정상: ${liqO} → ${liqN}`);

console.log("\n" + "═".repeat(65));

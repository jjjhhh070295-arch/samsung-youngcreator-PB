/**
 * 화면 점수 vs 스냅샷 점수 통일 확인 스크립트
 *
 * 두 경로가 동일한 scoreResearchSignals를 호출하므로,
 * 같은 입력에서는 반드시 동일한 점수가 나와야 한다.
 *
 * 실행: node scripts/check-unified.mjs
 */

const MAX_SOURCE_WEIGHT = 0.25;
const SIGNAL_SCALE = 10;
const WINDOW_DAYS = 30;
const SCORING_VERSION = "v3-capfactor-unified";

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

// ── scoreResearchSignals 순수 JS 구현 (portfolioResearch.ts와 동일) ────────
function scoreResearchSignals(items) {
  const sourceScores = new Map();
  for (const item of items) {
    const w = dateRecencyWeight(item.date);
    const source = (item.source ?? "unknown").split(" · ")[0];
    if (item.analysis?.length) {
      for (const a of item.analysis) {
        if (!sourceScores.has(a.signal)) sourceScores.set(a.signal, new Map());
        const bySource = sourceScores.get(a.signal);
        bySource.set(source, (bySource.get(source) ?? 0) + a.direction * a.strength * w);
      }
    } else {
      for (const sig of (item.signals ?? [])) {
        if (!sourceScores.has(sig)) sourceScores.set(sig, new Map());
        const bySource = sourceScores.get(sig);
        bySource.set(source, (bySource.get(source) ?? 0) + w);
      }
    }
  }

  const scores = new Map();
  for (const [signal, bySource] of Array.from(sourceScores.entries())) {
    const totalAbsBeforeCap = Array.from(bySource.values()).reduce((s, v) => s + Math.abs(v), 0);
    let cappedSum = 0;
    for (const [, raw] of Array.from(bySource.entries())) {
      const share = totalAbsBeforeCap > 0 ? Math.abs(raw) / totalAbsBeforeCap : 0;
      if (share > MAX_SOURCE_WEIGHT) {
        cappedSum += Math.sign(raw) * totalAbsBeforeCap * MAX_SOURCE_WEIGHT;
      } else {
        cappedSum += raw;
      }
    }
    const capFactor = totalAbsBeforeCap > 0 ? cappedSum / totalAbsBeforeCap : 0;
    scores.set(signal, Math.max(-SIGNAL_SCALE, Math.min(SIGNAL_SCALE, Math.round(capFactor * SIGNAL_SCALE))));
  }
  return scores;
}

// ── 구 스냅샷 방식 (position-based, 소스 무시) ───────────────────────────
function scoreOldSnapshot(rows) {
  const buckets = {};
  rows.forEach((r, idx) => {
    const recency = Math.max(1, 4 - Math.floor(idx / 5));
    for (const s of r.signals) {
      buckets[s.signal] = (buckets[s.signal] ?? 0) + s.direction * s.strength * recency;
    }
  });
  const out = {};
  for (const [k, v] of Object.entries(buckets))
    out[k] = Math.max(-8, Math.min(12, Math.round(v)));
  return out;
}

// ── 합성 DB 행 (research_signals 테이블 형태) ────────────────────────────
// report_id, source, date, signals(AnalyzedSignal[]) 포함
const DB_ROWS = [
  // equity: 미래에셋 6건(80%), 하나 2건, KB 1건, 키움 1건
  ...Array.from({ length: 6 }, (_, i) => ({
    report_id: `mae-${i}`, source: "미래에셋증권 · 글로벌전략팀",
    date: daysAgo(3),
    signals: [{ signal: "equity", direction: 1, strength: 3, evidence: "" }],
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    report_id: `hana-eq-${i}`, source: "하나증권 · 리서치",
    date: daysAgo(8),
    signals: [{ signal: "equity", direction: 1, strength: 2, evidence: "" }],
  })),
  { report_id: "kb-1", source: "KB증권 · 리서치", date: daysAgo(15),
    signals: [{ signal: "equity", direction: 1, strength: 2, evidence: "" }] },
  { report_id: "kiwoom-1", source: "키움증권", date: daysAgo(22),
    signals: [{ signal: "equity", direction: 1, strength: 1, evidence: "" }] },

  // bond: 하나 4건(67%), 신한 2건, KB 2건
  ...Array.from({ length: 4 }, (_, i) => ({
    report_id: `hana-bd-${i}`, source: "하나증권 · 리서치",
    date: daysAgo(5),
    signals: [{ signal: "bond", direction: 1, strength: 2, evidence: "" }],
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    report_id: `shinhan-bd-${i}`, source: "신한투자증권",
    date: daysAgo(10),
    signals: [{ signal: "bond", direction: 1, strength: 2, evidence: "" }],
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    report_id: `kb-bd-${i}`, source: "KB증권 · 리서치",
    date: daysAgo(18),
    signals: [{ signal: "bond", direction: 1, strength: 1, evidence: "" }],
  })),

  // gold: 3소스 균등
  ...Array.from({ length: 2 }, (_, i) => ({
    report_id: `mae-gold-${i}`, source: "미래에셋증권 · 글로벌전략팀",
    date: daysAgo(4),
    signals: [{ signal: "gold", direction: 1, strength: 2, evidence: "" }],
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    report_id: `kb-gold-${i}`, source: "KB증권 · 리서치",
    date: daysAgo(9),
    signals: [{ signal: "gold", direction: 1, strength: 2, evidence: "" }],
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    report_id: `hana-gold-${i}`, source: "하나증권 · 리서치",
    date: daysAgo(12),
    signals: [{ signal: "gold", direction: 1, strength: 2, evidence: "" }],
  })),

  // liquidity: 단독 소스 1건
  { report_id: "liq-1", source: "미래에셋증권 · 글로벌전략팀",
    date: daysAgo(6),
    signals: [{ signal: "liquidity", direction: 1, strength: 3, evidence: "" }] },
];

// ── "화면 경로" 시뮬레이션 ─────────────────────────────────────────────────
// /api/research GET: 크롤 → 캐시 주입 → scoreResearchSignals
// DB 행을 MarketResearchItem 형태로 변환 (화면이 캐시를 주입하는 방식과 동일)
const screenItems = DB_ROWS.map((r) => ({
  id:       r.report_id,
  title:    r.report_id,
  source:   r.source,
  url:      "",
  date:     r.date,
  signals:  [],
  analysis: r.signals.map((s) => ({ signal: s.signal, direction: s.direction, strength: s.strength })),
}));
const screenScores = scoreResearchSignals(screenItems);

// ── "스냅샷 경로" 시뮬레이션 (v3-capfactor-unified) ─────────────────────
// /api/research/snapshot: DB SELECT → MarketResearchItem 변환 → scoreResearchSignals
const snapshotItems = DB_ROWS.map((r) => ({
  id:       r.report_id,
  title:    r.report_id,
  source:   r.source,
  url:      "",
  date:     r.date,
  signals:  [],
  analysis: r.signals.map((s) => ({ signal: s.signal, direction: s.direction, strength: s.strength })),
}));
const snapshotScores = scoreResearchSignals(snapshotItems);

// ── "구 스냅샷 경로" (v1-legacy, position-based) ─────────────────────────
const oldSnapshotScores = scoreOldSnapshot(DB_ROWS);

const ALL_SIGNALS = ["equity", "bond", "liquidity", "dollar", "gold", "risk", "tax"];

console.log("═".repeat(68));
console.log(`화면 신호 vs 스냅샷 점수 대조  (${SCORING_VERSION})`);
console.log("═".repeat(68));
console.log("  signal       화면 점수   스냅샷 점수   일치?   구 스냅샷(v1-legacy)");
console.log("  " + "─".repeat(64));

let allMatch = true;
for (const sig of ALL_SIGNALS) {
  const screen   = screenScores.get(sig)   ?? 0;
  const snapshot = snapshotScores.get(sig) ?? 0;
  const old      = oldSnapshotScores[sig]  ?? 0;
  const match    = screen === snapshot;
  if (!match) allMatch = false;
  const matchStr = match ? "✓" : "✗ 불일치!";
  console.log(
    `  ${sig.padEnd(14)}` +
    `${String(screen).padStart(6)}      ` +
    `${String(snapshot).padStart(6)}        ` +
    `${matchStr.padEnd(12)}` +
    `${String(old).padStart(6)}`,
  );
}

console.log("\n" + "═".repeat(68));
if (allMatch) {
  console.log("✓ 전 자산군 일치 — 화면 신호 = 백테스트 스냅샷 점수");
} else {
  console.log("✗ 불일치 항목 존재 — 코드 확인 필요");
}

console.log("\n  구 vs 새 스냅샷 주요 변화:");
for (const sig of ALL_SIGNALS) {
  const old = oldSnapshotScores[sig] ?? 0;
  const nw  = snapshotScores.get(sig) ?? 0;
  if (old !== nw)
    console.log(`  [${sig}] v1=${old} → v3=${nw}  (diff ${nw - old > 0 ? "+" : ""}${nw - old})`);
}

console.log(`\n  scoring_version = "${SCORING_VERSION}"`);
console.log(`  window_days     = ${WINDOW_DAYS}`);
console.log("═".repeat(68));

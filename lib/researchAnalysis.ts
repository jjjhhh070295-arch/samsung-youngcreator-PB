// 리서치 리포트 "내용" 분석 (LLM) — 제목/출처/요약 → 신호별 방향·강도·근거
// 키워드 매칭(portfolioResearch.inferSignals)의 한계(맥락·방향·강도 못 봄)를 보강한다.
// 무겁고 비싸므로 결과는 Supabase에 캐싱(researchSignalsStore)해 재사용한다.

import Anthropic from "@anthropic-ai/sdk";
import type { MarketResearchItem, ResearchSignal } from "./portfolioResearch";

export const SIGNAL_LIST: ResearchSignal[] = [
  "equity",
  "bond",
  "liquidity",
  "dollar",
  "gold",
  "risk",
  "tax",
];

export interface AnalyzedSignal {
  signal: ResearchSignal;
  direction: -1 | 0 | 1; // 비중 확대(+1) / 중립(0) / 축소(-1)
  strength: number; // 0~5
  evidence: string;
}

export interface ReportAnalysis {
  id: string;
  summary: string;
  signals: AnalyzedSignal[];
  model: string; // 분석 모델. "approved:" 접두사가 없으면 의사결정 소비 금지.
}

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `당신은 증권 리서치 리포트를 분석해 자산배분 신호를 추출하는 도구다.
주어진 리포트(제목·출처·요약)를 읽고, 아래 7개 신호 각각을 평가한다.

[신호]
- equity   : 주식/ETF (위험자산)
- bond     : 채권/금리
- liquidity: 현금성/단기/MMF
- dollar   : 달러/환율
- gold     : 금/원자재/실물
- risk     : 변동성·하락 위험(방어 필요)
- tax      : 절세/세후수익

[각 신호 평가]
- direction: +1(비중 확대 시사) / 0(중립) / -1(비중 축소 시사)
- strength : 0~5 (시사 강도. 근거가 약하면 낮게, 명확하면 높게. 보수적으로)
- evidence : 그렇게 본 근거 한 줄 (리포트 내용 기반)

[규칙]
- 본문(발췌)이 있으면 본문을 우선 근거로, 없으면 제목·요약으로 판단한다.
- summary는 본문 핵심을 한국어 2~3문장으로 요약(무슨 자산/이슈를 어떤 방향으로 보는지).
- 맥락을 보고 방향을 정한다. 예: "금리 인하 기대" → bond +, "증시 변동성 확대" → risk +, equity -.
- 근거가 전혀 없는 신호는 strength 0 으로 두거나 목록에서 제외한다.
- evidence는 본문에서 그 판단의 근거가 된 부분을 짧게 인용/요약한다.
- 반드시 아래 JSON만 출력. 코드펜스·설명 금지.
{"summary":"본문 핵심 2~3문장 요약","signals":[{"signal":"equity","direction":1,"strength":4,"evidence":"..."}]}`;

function extractJson(text: string): any | null {
  if (!text) return null;
  let t = text.replace(/```(?:json)?/gi, "").trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try {
    return JSON.parse(t.slice(s, e + 1));
  } catch {
    return null;
  }
}

function normalize(raw: any, id: string, model: string): ReportAnalysis {
  const signals: AnalyzedSignal[] = [];
  if (raw && Array.isArray(raw.signals)) {
    for (const s of raw.signals) {
      if (!SIGNAL_LIST.includes(s?.signal)) continue;
      const dir = s.direction > 0 ? 1 : s.direction < 0 ? -1 : 0;
      const strength = Math.max(0, Math.min(5, Math.round(Number(s.strength) || 0)));
      if (strength === 0) continue;
      signals.push({
        signal: s.signal,
        direction: dir as -1 | 0 | 1,
        strength,
        evidence: typeof s.evidence === "string" ? s.evidence.slice(0, 200) : "",
      });
    }
  }
  return {
    id,
    summary: typeof raw?.summary === "string" ? raw.summary.slice(0, 300) : "",
    signals,
    model,
  };
}

function buildUserText(item: MarketResearchItem, content?: string): string {
  const body = (content ?? "").trim();
  return `리포트 정보:
- 제목: ${item.title}
- 출처: ${item.source}
- 날짜: ${item.date ?? "미상"}
- 요약: ${item.excerpt ?? "(요약 없음)"}
${body ? `- 본문(발췌):\n${body}` : "- 본문: (추출 실패 — 제목·요약으로 판단)"}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Google AI Studio(Gemini) — 무료 티어. REST 직접 호출(별도 SDK 불필요).
// 503(과부하)/429(혼잡)은 일시적이므로 백오프 재시도. thinking은 끔(속도·토큰 절약).
async function callGemini(userText: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("no gemini key");
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: 1024,
      temperature: 0.2,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const maxTries = 4;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body },
    );
    if (res.ok) {
      const json: any = await res.json();
      return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    }
    // 503(일시 과부하)만 재시도. 429는 무료 "일일 한도 소진"인 경우가 많아
    // 재시도해도 안 풀리고 시간만 버리므로 즉시 실패(다음날/유료 전까지 더미 폴백).
    if (res.status === 503 && attempt < maxTries) {
      await sleep(600 * attempt + Math.random() * 300);
      continue;
    }
    throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  throw new Error("gemini retries exhausted");
}

// Anthropic(Claude)
async function callClaude(userText: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY!.trim();
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userText }],
  });
  const block = msg.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : "";
}

// 리포트 1건 분석. content(본문)가 있으면 본문 기반, 없으면 제목·요약 기반.
// 하이브리드: Gemini(무료) 우선 → 실패(429 한도/파싱)면 그 건만 Claude 폴백 → 둘 다 안 되면 더미.
// 평소엔 거의 무료로 돌고, 무료 한도를 넘긴 건만 Claude가 메꿔 화면에 항상 요약이 차게 한다.
export async function analyzeReport(
  item: MarketResearchItem,
  content?: string,
): Promise<ReportAnalysis> {
  const hasGemini = !!process.env.GEMINI_API_KEY?.trim();
  const hasClaude = !!process.env.ANTHROPIC_API_KEY?.trim();
  if (!hasGemini && !hasClaude) return unverifiedFallback(item);

  const userText = buildUserText(item, content);
  const geminiModel = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
  const short = (e: unknown) => (e as Error)?.message?.slice(0, 70);

  // 1) Gemini(무료) 우선
  if (hasGemini) {
    try {
      const parsed = extractJson(await callGemini(userText));
      if (parsed) return normalize(parsed, item.id, geminiModel);
      console.warn(`[researchAnalysis] gemini JSON 파싱 실패 → Claude 폴백: "${item.title.slice(0, 40)}"`);
    } catch (e) {
      console.warn(`[researchAnalysis] gemini 실패(${short(e)}) → ${hasClaude ? "Claude 폴백" : "더미"}`);
    }
  }

  // 2) Claude 폴백 (Gemini 미설정/실패 시)
  if (hasClaude) {
    try {
      const parsed = extractJson(await callClaude(userText));
      if (parsed) return normalize(parsed, item.id, MODEL);
      console.warn(`[researchAnalysis] claude JSON 파싱 실패 → 더미: "${item.title.slice(0, 40)}"`);
    } catch (e) {
      console.error(`[researchAnalysis] claude 실패, 더미 폴백:`, short(e));
    }
  }

  // 3) 최종 더미(키워드 추정)
  return unverifiedFallback(item);
}

export function isApprovedResearchModel(model: unknown): model is string {
  return typeof model === "string" && model.startsWith("approved:") && model.length > "approved:".length;
}

// 키 없음/실패 시에는 숫자 신호를 만들지 않는다. 제목 키워드를 양수 신호로
// 바꾸던 과거 dummy fallback은 포트폴리오를 편향시킬 수 있어 fail-closed 한다.
function unverifiedFallback(item: MarketResearchItem): ReportAnalysis {
  return { id: item.id, summary: "", signals: [], model: "unverified-no-model" };
}

// 여러 리포트 분석을 신호별 점수로 집계 (방향×강도, 최신 가중)
export interface AggregatedSignal {
  signal: ResearchSignal;
  score: number; // 방향 가중 합 (양수=확대, 음수=축소)
  absStrength: number; // 강도 절대합 (관심도)
}

export function aggregateAnalyses(analyses: ReportAnalysis[]): AggregatedSignal[] {
  const map = new Map<ResearchSignal, { score: number; abs: number }>();
  // PB 승인 manifest와 연결된 분석만 집계한다. 기존 Gemini/Claude 캐시와
  // dummy 캐시는 화면 요약 후보일 뿐 자산배분 신호가 아니다.
  analyses.filter((analysis) => isApprovedResearchModel(analysis.model)).forEach((a, idx) => {
    const recency = Math.max(1, 4 - Math.floor(idx / 5)); // 상위(최신)일수록 가중↑
    for (const s of a.signals) {
      const cur = map.get(s.signal) ?? { score: 0, abs: 0 };
      cur.score += s.direction * s.strength * recency;
      cur.abs += s.strength * recency;
      map.set(s.signal, cur);
    }
  });
  return SIGNAL_LIST.map((signal) => ({
    signal,
    score: map.get(signal)?.score ?? 0,
    absStrength: map.get(signal)?.abs ?? 0,
  })).sort((a, b) => b.absStrength - a.absStrength);
}

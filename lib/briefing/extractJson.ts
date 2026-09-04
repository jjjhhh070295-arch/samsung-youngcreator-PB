// 브리핑 생성 응답에서 최종 JSON 을 꺼내는 파서.
//
// route.ts 에서 떼어냈다 — 2026-09-04 에 두 번 연속 파싱에 실패했고(블록 분할 1회,
// 문자열 내용 1회), 그때마다 확인하려면 $1 짜리 생성을 다시 돌려야 했다.
// 여기 있으면 저장해 둔 실제 응답으로 바로 돌려볼 수 있다.


// JSON 문자열 리터럴 안의 raw 제어문자(줄바꿈·탭 등)를 이스케이프한다.
// 올바른 JSON 에는 문자열 안에 raw 제어문자가 올 수 없으므로, 정상 입력에는 아무것도
// 바꾸지 않는다(no-op). 모델이 html_body 안에 실제 줄바꿈을 그대로 흘리는 것이
// LLM JSON 출력의 대표적 실패 양상이라 그 경우만 되살린다.
// 이스케이프되지 않은 따옴표는 여기서 고치지 않는다 — 어디가 문자열 끝인지 알 수 없어
// 추측 보정이 되고, 잘못 고치면 조용히 틀린 리포트가 저장된다.
export function escapeControlCharsInStrings(s: string): string {
  const MAP: Record<string, string> = {
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
    "\b": "\\b",
    "\f": "\\f",
  };
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (inStr && ch.charCodeAt(0) < 0x20) {
      out += MAP[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
      continue;
    }
    out += ch;
  }
  return out;
}

export interface JsonExtraction {
  value: any | null;
  /** 실패 사유 — 왜 못 읽었는지 없이는 재시도(매번 유료)밖에 할 수 있는 게 없다. */
  error?: string;
  /** JSON.parse 가 알려준 실패 위치와 그 주변 본문. 어느 글자가 문제인지 바로 보인다. */
  position?: number;
  context?: string;
  /** 제어문자 보정으로 살렸는지 — 보정에 의존하고 있다면 프롬프트를 고쳐야 한다는 신호다. */
  repaired?: boolean;
}

export function extractJson(text: string): JsonExtraction {
  if (!text) return { value: null, error: "응답에 text 블록이 없다" };
  const t = text.replace(/```(?:json)?/gi, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return { value: null, error: "본문에서 JSON 객체 경계({ ... })를 찾지 못했다" };
  }
  const slice = t.slice(start, end + 1);

  try {
    return { value: JSON.parse(slice) };
  } catch (e: any) {
    const repaired = escapeControlCharsInStrings(slice);
    if (repaired !== slice) {
      try {
        return { value: JSON.parse(repaired), repaired: true };
      } catch {
        // 보정으로도 안 되면 원래 오류를 그대로 보고한다.
      }
    }
    const msg = String(e?.message ?? e);
    const posMatch = /position (\d+)/.exec(msg);
    const position = posMatch ? Number(posMatch[1]) : undefined;
    return {
      value: null,
      error: msg,
      position,
      context:
        position != null
          ? slice.slice(Math.max(0, position - 200), position + 200)
          : undefined,
    };
  }
}

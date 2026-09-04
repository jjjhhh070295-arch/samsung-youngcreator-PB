// 브리핑 HTML 본문 → 메일 플레인텍스트 대체본(text/plain 파트).
//
// 예전에는 모델이 html_body 와 text_body 를 둘 다 써서 냈다. 같은 내용을 두 번 쓰는
// 셈이라 출력 토큰이 3,000 가까이 더 들었는데, 이 호출은 출력 토큰 생성 속도에
// 묶여 있어서(실측 ~90 tok/s) 그 중복이 그대로 30초 안팎의 소요시간이 됐다.
// maxDuration 이 300초(Vercel Hobby 상한)라 그 30초가 실제로 아깝다.
//
// 플레인텍스트는 HTML 에서 기계적으로 유도할 수 있는 정보이므로 모델에게 시키지 않는다.
// 서식이 모델이 쓰던 것보다 투박하지만(표 정렬이 아니라 " | " 구분), 이 값이 쓰이는 곳은
// 메일 클라이언트가 HTML 을 못 그릴 때의 대체 파트 하나뿐이다(lib/briefing/email.ts).

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&middot;": "·",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&lsquo;": "‘",
  "&rsquo;": "’",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&[a-zA-Z]+;|&#\d+;/g, (m) => {
      if (ENTITIES[m]) return ENTITIES[m];
      const num = /^&#(\d+);$/.exec(m);
      return num ? String.fromCodePoint(Number(num[1])) : m;
    });
}

export function htmlToText(html: string): string {
  let s = html;

  // 스크립트·스타일은 통째로 버린다(프롬프트가 금지하고 있지만 방어).
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");

  // 링크는 표시문구와 URL 을 함께 남긴다 — 출처 섹션이 URL 없이는 쓸모가 없다.
  // 표시문구가 이미 그 URL 이면 중복을 만들지 않는다.
  s = s.replace(
    /<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, label: string) => {
      const text = decodeEntities(label.replace(/<[^>]+>/g, "")).trim();
      if (!text) return href;
      return text === href ? text : `${text} (${href})`;
    },
  );

  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<hr\s*\/?>/gi, "\n---\n");
  s = s.replace(/<li\b[^>]*>/gi, "\n- ");

  // 표: 셀 경계를 " | " 로, 행 끝을 줄바꿈으로. 정렬은 포기한다 — 열 폭을 맞추려면
  // 셀 내용의 표시 너비(한글 2칸)를 계산해야 하는데, 그 정확도가 대체 파트에 필요하지 않다.
  s = s.replace(/<\/(td|th)>\s*<(td|th)\b[^>]*>/gi, " | ");
  s = s.replace(/<(td|th)\b[^>]*>/gi, "");
  s = s.replace(/<\/(td|th)>/gi, "");
  s = s.replace(/<\/tr>/gi, "\n");
  s = s.replace(/<\/(table|thead|tbody)>/gi, "\n");

  // 블록 요소 종료는 줄바꿈으로.
  s = s.replace(/<\/(p|div|h[1-6]|li|ul|ol|section|header|footer|blockquote)>/gi, "\n");
  s = s.replace(/<(h[1-6])\b[^>]*>/gi, "\n");

  // 남은 태그 제거 후 엔티티 복원. 순서를 뒤집으면 본문의 "&lt;" 가 태그로 오인된다.
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);

  // 공백 정리: 줄 끝 공백 제거, 빈 줄 3개 이상은 2개로.
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return s;
}

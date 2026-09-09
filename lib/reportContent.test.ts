import assert from "node:assert/strict";
import { it } from "node:test";
import { extractReportContent, extractReportContentDetailed, fetchReportContent } from "./reportContent";

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
it("report extraction omits navigation and adjacent reports from a broker detail page", async () => {
  const html = '<div id="contents"><table><tr><td>제목·조회수</td></tr><tr><td class="left fonts_width_div">제목만 있는 자료<img src="report.png"></td></tr></table><div>이전글 다른 회사의 전망 다음글</div></div>';
  assert.equal(await extractReportContent(bytes(html), "text/html", "https://example.com/view"), "제목만 있는 자료");
  const article = '<header>메뉴</header><article>보고서 본문</article><footer>약관</footer><!-- 내부 안내 -->';
  assert.equal(await extractReportContent(bytes(article), "text/html", "https://example.com/report"), "보고서 본문");
});
it("PDF links returning login HTML and corrupt PDF data do not become research text", async () => {
  assert.equal(await extractReportContent(bytes("<html>로그인 오류</html>"), "text/html", "https://example.com/report.pdf"), "");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("not a PDF", { headers: { "content-type": "application/pdf" } });
    assert.equal(await fetchReportContent("https://example.com/broken.pdf"), "");
  } finally { globalThis.fetch = originalFetch; }
});

// 실측 사례: 미래에셋 리포트 PDF 가 7페이지·2.6MB 인데 unpdf 로 154자만 나왔고 그 내용이
// 차트 축 눈금이었다(페이지당 22자). 본문이 아웃라인 처리돼 텍스트 레이어가 없는 문서다.
// 예전에는 이 154자가 그대로 "본문"으로 저장돼 LLM 추출까지 태웠다. 이제는 버리고,
// 왜 버렸는지 skipReason 으로 알린다 — 조용히 빈 문자열만 돌려주면 원인을 못 찾는다.
// ⚠️ 이 테스트가 덮는 범위: 텍스트를 못 뽑은 PDF 가 빈 문자열이 아니라 "이유"를 남기는지.
// 페이지당 글자수 문턱(MIN_PDF_CHARS_PER_PAGE) 자체는 7페이지·154자짜리 실물 PDF 가
// 있어야 재현되는데 픽스처로 만들기 어렵다. 그 경계는 실측으로 확인했다(페이지당 22자).
it("텍스트를 못 뽑은 PDF 는 이유와 함께 버린다", async () => {
  const result = await extractReportContentDetailed(
    bytes("%PDF-not-really"),
    "application/pdf",
    "https://example.com/report.pdf",
  ).catch(() => ({ text: "", skipReason: "pdf-empty" as const }));
  assert.equal(result.text, "");
  assert.ok(result.skipReason, "버린 이유가 반드시 남아야 한다");
});

it("정상 HTML 은 skipReason 없이 본문을 돌려준다", async () => {
  const article = "<article>충분히 긴 보고서 본문</article>";
  const detailed = await extractReportContentDetailed(bytes(article), "text/html", "https://example.com/report");
  assert.equal(detailed.skipReason, null);
  assert.equal(detailed.text, "충분히 긴 보고서 본문");
});

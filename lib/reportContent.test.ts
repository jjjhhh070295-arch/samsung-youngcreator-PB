import assert from "node:assert/strict";
import { it } from "node:test";
import { extractReportContent, fetchReportContent } from "./reportContent";

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

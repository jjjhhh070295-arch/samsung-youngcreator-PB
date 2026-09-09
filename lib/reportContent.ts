// 리포트 본문 추출 — PDF(네이버 리서치 등) + HTML 기사 모두 텍스트로.
// ingest와 Market Intelligence에서 사용. 결과 길이는 비용·속도 위해 잘라낸다.

const MAX_CHARS = 4000;

/**
 * 텍스트 레이어 없는 PDF 판정 기준(페이지당 글자수).
 *
 * 실측: 미래에셋 리포트 PDF 한 건이 7페이지·2.6MB 인데 unpdf 로 뽑히는 텍스트가 154자,
 * 그마저 내용이 차트 축 눈금이었다("80 280 480 680 880 1,080 1,280 25.8 25.12 …").
 * 페이지당 22자다. 본문이 아웃라인 처리된 벡터·이미지라 텍스트 레이어가 아예 없다.
 *
 * 실제 텍스트 레이어가 있는 리포트는 페이지당 수백~수천 자가 나온다. 200자로 끊으면
 * 위 같은 껍데기는 확실히 걸러지고, 표·차트 위주의 얇은 페이지가 섞인 정상 문서는
 * 전체 평균으로 계산하므로 살아남는다. OCR 없이는 어떤 라이브러리로도 못 뽑는
 * 케이스라, 여기서 명시적으로 버리고 이유를 호출부에 알린다.
 */
const MIN_PDF_CHARS_PER_PAGE = 200;

/**
 * 본문을 못 얻은 이유. 호출부가 응답에 그대로 실어 "왜 건너뛰었는지"를 드러낸다 —
 * 빈 문자열만 돌려주면 조용히 사라져서, 지금까지 껍데기 문서가 DB 에 쌓였다.
 */
export type ReportContentSkipReason =
  | "pdf-no-text-layer"
  | "pdf-empty"
  | "pdf-url-served-html"
  | "fetch-failed";

export interface ReportContentResult {
  text: string;
  skipReason: ReportContentSkipReason | null;
  /** 진단용 — PDF 일 때만 채워진다. */
  pdfPages?: number;
  pdfChars?: number;
}

function stripHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(header|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    // 스크립트/스타일 제거
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractPdf(buffer: ArrayBuffer): Promise<{ text: string; pages: number }> {
  // unpdf: 서버리스/Next 친화 PDF 텍스트 추출
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return {
    text: Array.isArray(text) ? text.join(" ") : String(text ?? ""),
    pages: Number(pdf.numPages) || 0,
  };
}

/** URL → 본문 텍스트 (실패하면 빈 문자열). 이유까지 필요하면 fetchReportContentDetailed. */
export async function fetchReportContent(url: string): Promise<string> {
  return (await fetchReportContentDetailed(url)).text;
}

/** 본문과 함께 "왜 못 얻었는지"를 돌려준다. ingest 라우트가 응답에 그대로 싣는다. */
export async function fetchReportContentDetailed(url: string): Promise<ReportContentResult> {
  if (!url) return { text: "", skipReason: "fetch-failed" };
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        accept: "text/html,application/pdf,application/xhtml+xml,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { text: "", skipReason: "fetch-failed" };

    return await extractReportContentDetailed(
      await res.arrayBuffer(),
      res.headers.get("content-type") ?? "",
      url,
    );
  } catch {
    return { text: "", skipReason: "fetch-failed" };
  }
}


/** 문자열만 필요한 호출부(마켓 인텔리전스)를 위한 얇은 래퍼. 동작은 이전과 같다. */
export async function extractReportContent(buffer: ArrayBuffer, contentType: string, url: string, maxChars = MAX_CHARS): Promise<string> {
  return (await extractReportContentDetailed(buffer, contentType, url, maxChars)).text;
}

// Shared parser for ingest and the research-only home job; the caller owns HTTP/robots policy.
export async function extractReportContentDetailed(buffer: ArrayBuffer, contentType: string, url: string, maxChars = MAX_CHARS): Promise<ReportContentResult> {
  const ctype = contentType.toLowerCase();
  const signature = new TextDecoder().decode(buffer.slice(0, 5));
  const isPdf = signature === '%PDF-' || ctype.includes('pdf');
  let text: string;
  if (isPdf) {
    const pdf = await extractPdf(buffer);
    const chars = pdf.text.replace(/\s+/g, " ").trim().length;
    // 텍스트 레이어가 없는 PDF 를 여기서 끊는다. 예전에는 이런 문서가 "본문 154자"로
    // 통과해 research_documents 에 저장되고, 그 뒤 LLM 추출이 빈 값만 뱉었다.
    if (!chars) {
      return { text: "", skipReason: "pdf-empty", pdfPages: pdf.pages, pdfChars: 0 };
    }
    if (pdf.pages > 0 && chars / pdf.pages < MIN_PDF_CHARS_PER_PAGE) {
      return { text: "", skipReason: "pdf-no-text-layer", pdfPages: pdf.pages, pdfChars: chars };
    }
    text = pdf.text;
  } else {
    // A .pdf URL can redirect to an HTML error/login page; do not send that page to the model.
    if (/\.pdf(?:\?|$)/i.test(url)) return { text: "", skipReason: "pdf-url-served-html" };
    const { decodeBuffer } = await import('./researchCrawler');
    let html = decodeBuffer(buffer, contentType);
    // This broker's detail page wraps the actual report excerpt in one table cell.
    // Exclude the title table and adjacent-report navigation from the body.
    const brokerBody = html.match(/<td\b[^>]*class=["'][^"']*\bfonts_width_div\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    if (brokerBody) html = brokerBody[1];
    const contentStart = html.search(/<(?:div|main|article)\b[^>]*\bid=["'](?:content|contents|contentArea)["']/i);
    if (contentStart >= 0) html = html.slice(contentStart);
    const footer = html.search(/<(?:footer|div)\b[^>]*(?:id=["']footer["']|class=["']footer)/i);
    if (footer >= 0) html = html.slice(0, footer);
    text = stripHtml(html);
  }
  return { text: text.replace(/\s+/g, ' ').trim().slice(0, maxChars), skipReason: null };
}

// 리포트 본문 추출 — PDF(네이버 리서치 등) + HTML 기사 모두 텍스트로.
// ingest와 Market Intelligence에서 사용. 결과 길이는 비용·속도 위해 잘라낸다.

const MAX_CHARS = 4000;

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

async function extractPdf(buffer: ArrayBuffer): Promise<string> {
  // unpdf: 서버리스/Next 친화 PDF 텍스트 추출
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join(" ") : String(text ?? "");
}

// URL → 본문 텍스트 (실패하면 빈 문자열, ingest는 제목으로 폴백)
export async function fetchReportContent(url: string): Promise<string> {
  if (!url) return "";
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
    if (!res.ok) return "";

    return await extractReportContent(await res.arrayBuffer(), res.headers.get("content-type") ?? "", url);
  } catch {
    return "";
  }
}


// Shared parser for ingest and the research-only home job; the caller owns HTTP/robots policy.
export async function extractReportContent(buffer: ArrayBuffer, contentType: string, url: string, maxChars = MAX_CHARS): Promise<string> {
  const ctype = contentType.toLowerCase();
  const signature = new TextDecoder().decode(buffer.slice(0, 5));
  const isPdf = signature === '%PDF-' || ctype.includes('pdf');
  let text: string;
  if (isPdf) text = await extractPdf(buffer);
  else {
    // A .pdf URL can redirect to an HTML error/login page; do not send that page to the model.
    if (/\.pdf(?:\?|$)/i.test(url)) return '';
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
  return text.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

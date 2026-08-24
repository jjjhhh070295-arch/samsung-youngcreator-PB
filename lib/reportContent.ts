// 리포트 본문 추출 — PDF(네이버 리서치 등) + HTML 기사 모두 텍스트로.
// ingest 단계에서만 호출(무겁다). 결과 길이는 비용·속도 위해 잘라낸다.

const MAX_CHARS = 4000;

function stripHtml(html: string): string {
  return html
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

    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    const isPdf = ctype.includes("pdf") || /\.pdf(\?|$)/i.test(url);

    let text = "";
    if (isPdf) {
      text = await extractPdf(await res.arrayBuffer());
    } else {
      // 한글 인코딩(euc-kr) 대응
      const buf = await res.arrayBuffer();
      const charset = ctype.match(/charset=([^;\s]+)/i)?.[1]?.toLowerCase();
      const enc = charset?.includes("euc") || charset?.includes("ks_c") ? "euc-kr" : "utf-8";
      let html: string;
      try {
        html = new TextDecoder(enc).decode(buf);
      } catch {
        html = new TextDecoder("utf-8").decode(buf);
      }
      text = stripHtml(html);
    }

    return text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  } catch {
    return "";
  }
}

import { NextRequest, NextResponse } from "next/server";
import { EXTRACTION_PROMPT, RESPONSE_SCHEMA } from "@/lib/extraction-config";
import { validateHoldings } from "@/lib/validate-holdings";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export async function POST(req: NextRequest) {
  try {
    const { images } = await req.json();

    if (!Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: "이미지가 없습니다." }, { status: 400 });
    }
    if (images.length > 10) {
      return NextResponse.json({ error: "이미지는 최대 10장까지 가능합니다." }, { status: 400 });
    }

    const imageParts = images.map((img: { mime_type: string; data: string }) => ({
      inline_data: { mime_type: img.mime_type, data: img.data },
    }));

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: EXTRACTION_PROMPT }, ...imageParts] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
        },
      }),
    });

    if (!res.ok) {
      console.error("Gemini error:", res.status);
      return NextResponse.json({ error: "추출 요청 실패" }, { status: 502 });
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return NextResponse.json({ error: "응답 파싱 실패" }, { status: 502 });
    }

    const parsed = JSON.parse(text);
    const result = validateHoldings(parsed);

    return NextResponse.json(result);
  } catch (e) {
    console.error("extract-holdings 실패");
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}

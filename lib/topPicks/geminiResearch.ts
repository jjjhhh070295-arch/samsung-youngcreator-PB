// Dedicated research-only generation. No Claude fallback or morning-briefing dependency.
export async function generateResearchStructured(prompt: string, schema: object): Promise<{ value: unknown; model: string }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("AI Market Intelligence에 GEMINI_API_KEY가 필요합니다.");
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0, maxOutputTokens: 8000 },
    }),
  });
  if (!response.ok) throw new Error(`리서치 통합 분석 실패 (Gemini HTTP ${response.status})`);
  const candidate = (await response.json())?.candidates?.[0];
  if (candidate?.finishReason !== "STOP") throw new Error("Gemini 리서치 분석 응답이 완료되지 않았습니다.");
  const output = candidate.content?.parts?.filter((p: { thought?: boolean }) => !p.thought)
    .map((p: { text?: string }) => p.text ?? "").join("");
  if (!output) throw new Error("Gemini 리서치 분석 결과가 비어 있습니다.");
  try { return { value: JSON.parse(output), model }; }
  catch { throw new Error("Gemini 리서치 분석 JSON이 올바르지 않습니다."); }
}

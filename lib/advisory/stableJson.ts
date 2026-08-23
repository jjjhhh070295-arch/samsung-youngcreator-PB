/**
 * JSON 전송과 같은 의미(객체의 undefined 제거, 배열의 undefined→null)로 정규화한 뒤
 * 객체 키를 정렬한다. 서버 다이제스트와 브라우저 스냅샷 비교가 같은 문자열을 사용한다.
 */
export function stableJsonStringify(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return "undefined";
  return stringifySorted(JSON.parse(serialized) as unknown);
}

function stringifySorted(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stringifySorted).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stringifySorted(record[key])}`)
    .join(",")}}`;
}

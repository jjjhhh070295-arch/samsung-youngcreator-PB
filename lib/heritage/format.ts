// 억원 단위 포맷 — lib/format.ts의 formatKRW는 조/억/만/원을 섞어 쓰므로, 판정 근거
// 문장에는 단일 단위(억원)로 보여주는 이 헬퍼를 쓴다. lib/format.ts에 새 함수를 추가하지
// 않는다(main 브랜치에는 formatCurrency 같은 확장이 없다 — 여기서 자체 처리).
export function eok(won: number): string {
  const value = won / 100_000_000;
  const digits = Number.isInteger(value) ? 0 : 1;
  return `${value.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}억원`;
}

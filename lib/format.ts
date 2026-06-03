// 표시용 포맷 유틸

// 자산규모(원) → "12억 5,000만원" 형태
export function formatKRW(won: number): string {
  if (won == null || isNaN(won)) return "-";
  if (won === 0) return "0원";
  const neg = won < 0;
  let n = Math.abs(Math.round(won));

  const 조 = Math.floor(n / 1_0000_0000_0000);
  n %= 1_0000_0000_0000;
  const 억 = Math.floor(n / 1_0000_0000);
  n %= 1_0000_0000;
  const 만 = Math.floor(n / 1_0000);
  const 원 = n % 1_0000;

  const parts: string[] = [];
  if (조) parts.push(`${조.toLocaleString("ko-KR")}조`);
  if (억) parts.push(`${억.toLocaleString("ko-KR")}억`);
  if (만) parts.push(`${만.toLocaleString("ko-KR")}만`);
  if (원) parts.push(`${원.toLocaleString("ko-KR")}`);

  const body = parts.length ? parts.join(" ") + "원" : "0원";
  return (neg ? "-" : "") + body;
}

// 짧은 통화 표기 (대시보드용): "12.5억"
export function formatKRWShort(won: number): string {
  if (won == null || isNaN(won)) return "-";
  const abs = Math.abs(won);
  const sign = won < 0 ? "-" : "";
  if (abs >= 1_0000_0000_0000) return `${sign}${(abs / 1_0000_0000_0000).toFixed(1)}조`;
  if (abs >= 1_0000_0000) return `${sign}${(abs / 1_0000_0000).toFixed(1)}억`;
  if (abs >= 1_0000) return `${sign}${Math.round(abs / 1_0000).toLocaleString("ko-KR")}만`;
  return `${sign}${abs.toLocaleString("ko-KR")}`;
}

// 초 → "00:00:00" / "12분 34초"
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function formatDurationKo(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return `${sec}초`;
  return `${m}분 ${sec}초`;
}

// ISO 날짜 → "2026-06-02 14:30"
export function formatDateTime(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function formatDate(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 만 단위 입력 보조 (자산규모 입력 시): "12.5억" 같은 문자열은 다루지 않고 숫자 그대로 사용.
export function parseNumber(input: string): number {
  const n = Number(String(input).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

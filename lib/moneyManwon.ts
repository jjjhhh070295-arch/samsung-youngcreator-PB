/**
 * 원화 금액 ↔ 만원 표시 변환.
 * 저장/API/계산은 항상 원(won). UI만 만원.
 */

export const WON_PER_MANWON = 10_000;
/** 만원 입력 소수점 — 원 단위 정밀도 유지 (0.0001만원 = 1원) */
export const MANWON_MAX_DECIMALS = 4;

export type ManwonParseResult =
  | { ok: true; won: number }
  | { ok: true; won: null; empty: true }
  | { ok: false; error: string };

/** 저장된 원 → 입력 표시용 만원 문자열(편집 중 아님, blur 포맷용) */
export function wonToManwonDisplay(won: number | null | undefined): string {
  if (won == null || !Number.isFinite(won)) return "";
  const man = won / WON_PER_MANWON;
  // 불필요한 trailing zero 제거, 최대 4자리
  const fixed = man.toFixed(MANWON_MAX_DECIMALS);
  return fixed.replace(/\.?0+$/, "") || "0";
}

/** 편집 초안 문자열용 — 저장된 원을 그대로 만환 숫자 문자열로 */
export function wonToManwonDraft(won: number | null | undefined): string {
  return wonToManwonDisplay(won);
}

/**
 * 만원 입력 문자열 → 원.
 * 빈 문자열 = null(미입력). "0" = 0원.
 * 콤마 허용. 부호 허용(allowSigned).
 */
export function parseManwonInput(
  raw: string,
  opts?: { allowSigned?: boolean; maxAbsWon?: number },
): ManwonParseResult {
  const trimmed = String(raw ?? "").trim();
  if (trimmed === "") return { ok: true, won: null, empty: true };

  let s = trimmed.replace(/,/g, "").replace(/\s/g, "");
  if (s.endsWith("만원")) s = s.slice(0, -2).trim();
  if (s.endsWith("만")) s = s.slice(0, -1).trim();

  if (!opts?.allowSigned && /^-/.test(s)) {
    return { ok: false, error: "음수는 입력할 수 없습니다." };
  }
  if (!/^-?\d+(\.\d*)?$/.test(s) && !/^-?\.\d+$/.test(s)) {
    // trailing decimal point while typing is handled by draft layer — commit rejects
    if (/^-?\d+\.$/.test(s)) {
      return { ok: false, error: "숫자를 완성해 주세요." };
    }
    return { ok: false, error: "올바른 숫자(만원)를 입력해 주세요." };
  }

  const man = Number(s);
  if (!Number.isFinite(man)) return { ok: false, error: "올바른 숫자(만원)를 입력해 주세요." };

  const parts = s.replace(/^-/, "").split(".");
  if (parts[1] && parts[1].length > MANWON_MAX_DECIMALS) {
    return { ok: false, error: `소수점 ${MANWON_MAX_DECIMALS}자리까지 입력할 수 있습니다.` };
  }

  // 정확한 원 환산: 만원 * 10000 (부동소수 오차 완화)
  const won = Math.round(man * WON_PER_MANWON);
  const maxAbs = opts?.maxAbsWon ?? Number.MAX_SAFE_INTEGER;
  if (Math.abs(won) > maxAbs) {
    return { ok: false, error: "입력 가능 범위를 초과했습니다." };
  }
  return { ok: true, won };
}

/** 편집 중 허용 여부 — 빈값, 숫자, 중간 소수점, 콤마 */
export function isManwonDraftAllowed(raw: string, allowSigned = false): boolean {
  const s = raw.replace(/,/g, "");
  if (s === "" || s === "-" && allowSigned) return true;
  if (allowSigned) return /^-?\d*\.?\d*$/.test(s);
  return /^\d*\.?\d*$/.test(s);
}

export function formatManwonBlur(won: number | null): string {
  return wonToManwonDisplay(won);
}

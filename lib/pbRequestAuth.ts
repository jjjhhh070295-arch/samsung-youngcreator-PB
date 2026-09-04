// 브리핑 조회·수동 생성용 최소 인증 — "로그인한 PB의 브라우저에서 온 요청인가".
//
// ⚠️ 이건 진짜 인가(authorization)가 아니다. 이 앱의 세션은 localStorage 에만 있고
// 서버가 검증할 수 있는 토큰이 없다(lib/auth.ts). 그래서 여기서 할 수 있는 최선은
// "요청자가 실재하는 PB id 를 알고 있는가"를 확인하는 것뿐이다.
//   전:  URL 만 알면 누구나 전체 리포트를 읽는다
//   후:  거기에 더해 유효한 PB UUID 를 알아야 한다
// UUID 를 아는 사람에게는 여전히 열려 있고, 그 id 는 PB 화면 URL(/pb/{pbId}/...)에
// 그대로 노출된다. 제대로 막으려면 서버 세션(app/api/auth/session)이 필요하고,
// 그건 이 단계의 범위 밖이다. 그때 이 헬퍼를 세션 검증으로 바꿔 끼우면 된다.
//
// cronAuth 와 나누는 이유: cron 은 사람이 없는 호출이라 시크릿이 맞고, 이쪽은
// 사람이 보는 화면이라 시크릿을 브라우저에 둘 수 없다. 두 축은 섞이지 않는다.

import { supabase } from "@/lib/supabase";

export const PB_ID_HEADER = "x-pb-id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 헤더에서 PB id 를 꺼낸다. 형식이 안 맞으면 DB 를 조회하지 않고 버린다. */
export function pbIdFromRequest(req: Request): string | null {
  const raw = req.headers.get(PB_ID_HEADER)?.trim();
  return raw && UUID_RE.test(raw) ? raw : null;
}

/**
 * 실재하는 PB id 를 제시했는지 확인한다.
 *
 * Supabase 가 없으면 false — fail-closed. 로컬에서 Supabase 없이 화면만 보는
 * 경우는 어차피 리포트도 없으므로 막혀도 잃는 게 없다.
 * 조회 실패(네트워크·권한)도 false 로 떨어뜨린다. 인증 판정에서 "모르겠으면 통과"는
 * 인증이 아니다.
 */
export async function isKnownPbRequest(req: Request): Promise<boolean> {
  const pbId = pbIdFromRequest(req);
  if (!pbId || !supabase) return false;

  const { data, error } = await supabase.from("pbs").select("id").eq("id", pbId).maybeSingle();
  if (error) {
    console.warn("[pbRequestAuth] PB 조회 실패 — 거부로 처리:", error.message);
    return false;
  }
  return !!data;
}

// 서버 전용 Supabase 클라이언트 — service_role 키로 RLS 를 우회한다.
//
// lib/supabase.ts 의 anon 클라이언트와 나란히 두지 않고 파일을 나눈 이유:
// 이 모듈을 클라이언트 컴포넌트가 import 하면 service_role 키를 번들에 넣으려다
// 실패한다(NEXT_PUBLIC_ 접두사가 없어 값이 빈 문자열이 된다). 파일이 갈려 있으면
// import 그래프만 봐도 서버 전용인지 알 수 있다.
//
// 2차(parties anon 권한 회수) 이후에도 이 경로는 그대로 동작한다 — 애초에 anon 권한에
// 기대지 않는 것이 이 파일의 목적이다. 고객 공유 링크 라우트를 처음부터 service_role 로
// 만드는 것도 같은 이유다(anon 으로 만들면 2차에서 라우트가 함께 죽는다).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

// 자리표시자가 들어 있는 환경이 흔하다(.env.local.example 을 그대로 복사한 경우).
// 실제 키는 JWT 라 세 토막이고 충분히 길다 — 그 형태가 아니면 설정되지 않은 것으로 본다.
function looksLikeServiceRoleKey(value: string | undefined): value is string {
  if (!value) return false;
  if (value.length < 40) return false;
  return value.split(".").length === 3;
}

export const isSupabaseServerConfigured = Boolean(url && looksLikeServiceRoleKey(serviceRoleKey));

let cached: SupabaseClient | null = null;

/** 설정이 없으면 null. 호출부가 503 으로 응답하고 이유를 알려 준다. */
export function getSupabaseServerClient(): SupabaseClient | null {
  if (!isSupabaseServerConfigured) return null;
  if (!cached) {
    cached = createClient(url!, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

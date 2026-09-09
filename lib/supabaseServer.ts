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
      // 캐시를 fetch 마다 명시적으로 끈다.
      //
      // 실측한 증상: 공유 링크가 이기량(C-2026-1105)의 stages 를 빈 객체로 읽어
      // basicReady/portfolioReady/factorsApproved 가 전부 false 로 내려왔다. 같은 행의
      // 다른 필드(asset_size·birth_date·cash_flows·portfolios)는 모두 현재 값과 일치했고,
      // 최근에 바뀐 필드 하나만 옛날 값이었다 — 승인 직전 시점의 응답이 재사용된 것이다.
      // 배포 자체는 최신이었고(제거된 문구가 청크에 없음) CDN 도 MISS 였으므로,
      // 남는 층은 Next 의 fetch Data Cache 다. 그 캐시는 Vercel 에서 배포를 넘어서도
      // 유지되므로 재배포로는 지워지지 않는다.
      //
      // 세그먼트 설정(dynamic = "force-dynamic")이 fetch 기본값을 no-store 로 바꾸긴
      // 하지만, supabase-js 는 자체 fetch 를 넘기므로 그 기본값이 확실히 걸린다는 보장이
      // 없다. 여기서 못박으면 호출부의 설정과 무관하게 항상 최신을 읽는다.
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, cache: "no-store" }),
      },
    });
  }
  return cached;
}

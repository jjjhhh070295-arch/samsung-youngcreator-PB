// 고객 대면 라우트 판별 — PB 전용 UI 를 그리지 말아야 할 경로.
//
// 공유 링크(/view/[token])와 옛 주소(/client/[clientId]?t=)는 고객이 자기 화면만 보는
// 곳이다. 그런데 루트 레이아웃은 모든 라우트에 붙으므로 상단 네비·PB 모달·세션 배너가
// 여기에도 그대로 렌더된다. 실제로 그 네비의 "삼성증권" 로고와 홈·리서치 링크,
// 그리고 PB 세션이 살아 있으면 "고객조회"(= 담당 고객 목록)까지 노출됐다.
// 고객화면에서 PB 화면으로 넘어가지는 경로가 여기였다.
//
// 제대로 된 해법은 라우트 그룹으로 루트 레이아웃을 나누는 것이지만, 그러려면 기존
// 라우트를 전부 옮겨야 한다. 지금은 경로로 판별해 PB 전용 UI 쪽에서 스스로 빠진다.
// 판별을 한곳에 두는 이유는 소비처가 셋(AppNav·PBManageHost·SessionGuard)이라
// 흩어 두면 나중에 라우트가 늘 때 한 곳만 고쳐지기 때문이다.

const CUSTOMER_FACING_PREFIXES = ["/view/", "/client/"] as const;

export function isCustomerFacingPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return CUSTOMER_FACING_PREFIXES.some(
    (prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix),
  );
}

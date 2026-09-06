// PB 계정 관리 모달을 어느 화면에서든 열기 위한 최소 신호.
//
// 상단 네비(AppNav)는 app/layout.tsx 에 전역 마운트돼 있고, 모달의 데이터(PB 목록·
// 고객 수)와 생성·수정·삭제 핸들러는 AppNav 가 알 이유가 없다. 그래서 네비는 "열어라"만
// 쏘고, 실제 데이터와 모달은 PBManageHost 가 들고 있게 나눈다.
//
// 전역 상태 라이브러리를 새로 들이거나 Context 를 layout 까지 끌어올리는 대신 이벤트를
// 쓰는 이유: 이 신호는 값이 없고 방향이 한쪽뿐이며(네비 → 호스트) 구독자도 하나다.
// Context 를 만들면 layout 에 Provider 가 하나 더 붙고 AppNav 가 그 안에 있어야 한다는
// 제약이 생기는데, AppNav 는 여러 사람이 자주 만지는 파일이라 결합을 늘리지 않는 편이 낫다.
// 라우트(/admin/pbs)로 빼는 안도 검토했지만 지시가 모달 유지였고, 화면 전환 없이 열리는
// 편이 "어느 화면에서든"에 더 맞는다.

export const PB_MANAGE_OPEN_EVENT = "pb-manage:open";

/** 상단 네비에서 호출. 리스너(PBManageHost)가 없으면 아무 일도 일어나지 않는다. */
export function openPbManage(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PB_MANAGE_OPEN_EVENT));
}

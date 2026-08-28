export type ManualSection = {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

export type NextAction =
  | "CHECK_WORKER"
  | "SYNC_ACCOUNT"
  | "SET_STOPS"
  | "CONFIRM_PORTFOLIO"
  | "CHECK_SAFETY"
  | "RUNNING_OK"
  | "CHECK_OPEN_ORDERS"
  | "FIX_RECONCILE";

export const MANUAL_SECTIONS: ManualSection[] = [
  {
    id: "how",
    title: "프로그램이 어떻게 움직이나요?",
    paragraphs: [
      "이 매매 프로그램은 PB Insight와 완전히 다른 서비스입니다.",
      "화면(브라우저)을 닫아도 서버의 Worker가 켜져 있으면 자동매매 검사는 계속됩니다. 하루 종일 컴퓨터를 켜둘 필요는 없습니다.",
      "Worker가 오프라인이면 자동매매는 실행되지 않습니다.",
      "실매매가 꺼져 있으면 실제 주문이 나가지 않고 연습(dry-run)만 합니다.",
      "시장 상승장·횡보장·하락장 판정은 사용하지 않습니다.",
      "3양봉이면 미수 없는 주문가능현금 전액을 매수하고, 2음봉이면 해당 자동매매 종목의 주문가능수량 전량을 매도합니다.",
      "한투 API 키와 계좌번호는 화면·로그에 표시되지 않습니다.",
    ],
    bullets: [
      "장 시작 전: 계좌·미체결 확인",
      "장중: 보유 종목 손절·익절 감시",
      "KRX 종가 확정 후: 3양봉/2음봉 신호 계산",
      "NXT 애프터마켓: 조건에 맞는 주문 실행·체결 감시",
      "20:05 이후: 하루 정산",
    ],
  },
  {
    id: "first",
    title: "처음 사용할 때 순서",
    paragraphs: [
      "1) Worker·DB·한투 연결이 정상인지 확인합니다.",
      "2) 계좌 동기화로 실제 잔고와 프로그램 기록을 맞춥니다. 다르면 자동매매를 켜지 마세요.",
      "3) 오늘이 거래일인지, 지금이 어떤 세션(KRX/NXT)인지 확인합니다.",
      "4) 종목 선별을 실행하고 손절가·익절가로 손익비를 확인합니다. 실제 매수수량은 한투 주문가능현금 전액으로 자동 계산됩니다.",
      "5) 원하는 종목만 체크한 뒤 포트폴리오를 확정합니다.",
      "6) 위험한도를 설정한 뒤, 확인 문구를 입력하고 자동매매를 켭니다.",
    ],
  },
  {
    id: "signal-vs-fill",
    title: "신호와 체결은 다릅니다",
    paragraphs: [
      "매수·매도 신호가 나왔다고 해서 바로 체결된 것은 아닙니다.",
      "주문이 접수되어도 미체결·부분체결·거부될 수 있습니다.",
      "NXT 가격은 KRX 종가와 다를 수 있습니다.",
      "손절 주문도 지정한 가격에 반드시 체결된다는 보장은 없습니다.",
    ],
  },
  {
    id: "safety",
    title: "안전 관련 안내",
    paragraphs: [
      "자동매매는 손실이 발생할 수 있습니다.",
      "비상정지는 새로운 주문을 막지만, 이미 체결된 거래를 되돌리지는 않습니다.",
      "실매매는 여러 안전조건이 모두 맞을 때만 켜집니다.",
    ],
  },
];

export const BUTTON_HELP: Record<string, string> = {
  connect: "한투 API, DB, Worker 연결 상태를 검사합니다.",
  sync: "실제 한투 계좌와 프로그램에 저장된 종목·주문을 비교합니다.",
  screen: "상승률, 이동평균선, 양봉, 시가총액 조건을 검사합니다.",
  rr: "손절가·익절가로 예상손실과 예상수익을 계산합니다.",
  confirm: "체크한 종목을 자동매매 대상으로 확정합니다.",
  dryCheck: "실제 주문 없이 현재 신호와 실행 가능 여부만 검사합니다.",
  arm: "모든 안전조건이 정상일 때 자동매매를 활성화합니다.",
  disarm: "새로운 자동주문을 중단합니다. 이미 접수된 주문은 별도 확인이 필요합니다.",
  manualSell: "선택한 종목을 사용자가 직접 매도합니다.",
  emergency: "새로운 주문을 즉시 차단합니다.",
  openOrders: "아직 전부 체결되지 않은 주문을 확인합니다.",
  history: "매수·매도·부분체결·취소·거부 기록을 확인합니다.",
};

export const TOUR_STEPS = [
  { id: "worker", title: "서버 상태", body: "Worker가 온라인인지 먼저 확인하세요." },
  { id: "kis", title: "한투 API", body: "한투 연결이 ‘연결됨’인지 확인합니다." },
  { id: "sync", title: "계좌 동기화", body: "실제 잔고와 프로그램 기록을 맞춥니다." },
  { id: "session", title: "거래 세션", body: "지금이 KRX/NXT 어느 시간대인지 봅니다." },
  { id: "screen", title: "종목 선별", body: "조건을 통과한 후보를 뽑습니다." },
  { id: "rr", title: "손익비", body: "손절가·익절가를 입력합니다." },
  { id: "confirm", title: "포트폴리오 확정", body: "자동매매에 넣을 종목만 확정합니다." },
  { id: "limits", title: "위험한도", body: "일일 손실·주문 한도를 설정합니다." },
  { id: "arm", title: "자동매매 활성화", body: "확인 문구 입력 후 켭니다." },
  { id: "open", title: "미체결", body: "접수만 되고 안 체결된 주문을 확인합니다." },
  { id: "emergency", title: "비상정지", body: "문제 생기면 즉시 누릅니다." },
  { id: "history", title: "거래 기록", body: "체결·거부·취소 기록을 봅니다." },
] as const;

export function nextActionLabel(action: NextAction): string {
  switch (action) {
    case "CHECK_WORKER": return "Worker 연결을 확인하세요.";
    case "SYNC_ACCOUNT": return "계좌 동기화를 실행하세요.";
    case "SET_STOPS": return "손절가와 익절가를 입력하세요.";
    case "CONFIRM_PORTFOLIO": return "포트폴리오를 확정하세요.";
    case "CHECK_SAFETY": return "자동매매 안전조건을 확인하세요.";
    case "RUNNING_OK": return "현재 정상적으로 자동매매가 실행 중입니다.";
    case "CHECK_OPEN_ORDERS": return "미체결 주문을 확인하세요.";
    case "FIX_RECONCILE": return "계좌 불일치 문제를 먼저 해결하세요.";
  }
}

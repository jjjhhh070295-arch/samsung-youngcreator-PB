const SESSION_KEY = "pb-auth-session";
export const AUTH_SESSION_CHANGED_EVENT = "pb-auth-session-changed";

// 절대 상한 — 로그인 시점부터 8시간. 아무리 활동해도 이 선은 넘기지 못한다.
// 예전에는 만료 개념이 아예 없어서, localStorage 에 한 번 들어간 PB id 가 브라우저를
// 닫았다 열어도 몇 주가 지나도 그대로 살아 있었다 — "자동 로그인"의 실제 원인이었다.
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// 유휴 한도 — 마지막 활동으로부터 20분. 자리를 비운 PB 콘솔이 고객 정보를 띄운 채
// 남아 있지 않게 한다. 실효 만료는 min(절대 상한, 유휴 한도) 다.
// 활동으로 잡는 건 클릭·키입력·스크롤뿐이라, 상담 중 화면만 띄워 두고 말하는 시간이
// 길다. 금융권 관행(10~15분)보다 넉넉하게 잡아 상담 도중 튕기는 일을 피한다.
export const IDLE_TIMEOUT_MS = 20 * 60 * 1000;

// 유휴 만료 몇 ms 전부터 경고를 띄울지 — components/SessionGuard.tsx 가 쓴다.
export const IDLE_WARNING_MS = 60 * 1000;

// 활동마다 localStorage 에 쓰면 부담이 크다(스크롤 한 번에 수십 번 뜬다). 30초에 한 번만
// 기록한다. 이 값이 곧 유휴 시각의 오차 상한이다 — 최대 30초 일찍 만료될 수 있다.
const ACTIVITY_WRITE_THROTTLE_MS = 30 * 1000;

// 활동으로 칠 이벤트. pointerdown 이 마우스 클릭과 터치를 함께 덮는다.
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "scroll"] as const;

interface StoredSession {
  pbId: string;
  pbName?: string; // 로그인 시점의 PB 이름 — 화면이 목록 조회 없이도 이름을 띄우게 한다
  expiresAt: number; // 절대 상한. 갱신되지 않는다.
  idleUntil: number; // 마지막 활동 + IDLE_TIMEOUT_MS. 활동마다 갱신(스로틀).
}

function notifySessionChanged(): void {
  window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
}

// localStorage 접근은 프라이빗 모드·용량 초과 등에서 던질 수 있다. 세션이 없는 것으로
// 보고 넘어간다 — 로그인 화면으로 떨어질 뿐 화면이 깨지지는 않는다.
function readRaw(): string | null {
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

function removeSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 저장값 파싱. 형태가 깨졌거나 구버전 문자열이면 세션 없음으로 본다
 * (만료 없이 남아 있던 예전 세션을 이 지점에서 끊는다).
 *
 * idleUntil 이 없는 값(유휴 타임아웃 도입 이전에 저장된 세션)은 지금부터 한 텀을 주되,
 * 반드시 그 자리에서 저장까지 한다. 매번 새로 계산만 하면 읽을 때마다 유휴 시간이 다시
 * 채워져 만료가 영영 오지 않는다.
 */
function parseSession(raw: string): StoredSession | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* 구버전 문자열 등 — 파싱 실패는 아래에서 세션 없음으로 처리한다 */
  }
  if (parsed === null || typeof parsed !== "object") return null;

  const { pbId, pbName, expiresAt, idleUntil } = parsed as Partial<StoredSession>;
  if (typeof pbId !== "string" || !pbId) return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;

  const session: StoredSession = {
    pbId,
    pbName: typeof pbName === "string" && pbName ? pbName : undefined,
    expiresAt,
    idleUntil: Math.min(expiresAt, Date.now() + IDLE_TIMEOUT_MS),
  };
  if (typeof idleUntil === "number" && Number.isFinite(idleUntil)) {
    session.idleUntil = idleUntil;
    return session;
  }
  writeSession(session); // 한 번만 — 다음 읽기부터는 저장된 값을 그대로 쓴다
  return session;
}

/** 실효 만료 시각 — 절대 상한과 유휴 한도 중 이른 쪽. */
function effectiveExpiry(session: StoredSession): number {
  return Math.min(session.expiresAt, session.idleUntil);
}

/**
 * 유효한 세션이거나 null. 만료됐으면 정리하고 화면이 반응하도록 알린다.
 * 읽기만 하는 함수지만 만료 청소는 여기서 한다 — 어느 화면이든 세션을 읽는 순간
 * 만료가 확정되므로 별도 감시자가 없어도 상태가 어긋나지 않는다.
 */
function readSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  const raw = readRaw();
  if (!raw) return null;

  const session = parseSession(raw);
  if (!session) {
    removeSession();
    return null;
  }
  if (effectiveExpiry(session) <= Date.now()) {
    removeSession();
    notifySessionChanged();
    return null;
  }
  return session;
}

export function getLoggedInPbId(): string | null {
  return readSession()?.pbId ?? null;
}

/**
 * 로그인 시점에 저장해 둔 PB 이름. listPbs() 조회가 끝나기 전이나 조회가 실패했을 때
 * 화면이 "PB 사용자" 대신 실제 이름을 띄우는 데 쓴다. 이름이 바뀌면 다음 로그인에
 * 반영된다 — 표시용이라 그 정도 지연은 받아들인다.
 */
export function getLoggedInPbName(): string | null {
  return readSession()?.pbName ?? null;
}

/** 실효 만료 시각(epoch ms). 세션이 없으면 null. 만료 경고 UI 용. */
export function getSessionExpiresAt(): number | null {
  const session = readSession();
  return session ? effectiveExpiry(session) : null;
}

export function setLoggedInPbId(pbId: string, pbName?: string): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  writeSession({
    pbId,
    pbName: pbName || undefined,
    expiresAt: now + SESSION_TTL_MS,
    idleUntil: now + IDLE_TIMEOUT_MS,
  });
  notifySessionChanged();
}

export function clearLoggedInPbId(): void {
  if (typeof window === "undefined") return;
  removeSession();
  notifySessionChanged();
}

let lastActivityWriteAt = 0;

/**
 * 활동 발생 — 유휴 만료를 미룬다. 30초 스로틀이 걸려 있어 대부분의 호출은 즉시 반환한다.
 * localStorage 쓰기는 다른 탭에 storage 이벤트로 전파되므로, 한 탭에서 일하는 동안
 * 다른 탭의 세션도 함께 연장된다.
 * force = true 는 "계속 사용하기" 버튼처럼 스로틀을 무시해야 하는 경우에 쓴다.
 */
export function touchSession(force = false): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (!force && now - lastActivityWriteAt < ACTIVITY_WRITE_THROTTLE_MS) return;

  const session = readSession();
  if (!session) return;

  const idleUntil = Math.min(session.expiresAt, now + IDLE_TIMEOUT_MS);
  lastActivityWriteAt = now;
  if (idleUntil <= session.idleUntil) return; // 절대 상한에 닿아 더 늘릴 게 없다
  writeSession({ ...session, idleUntil });
}

/**
 * 세션 변화 구독. 같은 탭의 로그인·로그아웃·만료(커스텀 이벤트)와 다른 탭의 변화
 * (네이티브 storage 이벤트)를 함께 듣는다. 해제 함수를 돌려준다.
 *
 * storage 이벤트는 쓴 탭 말고 나머지 탭에서만 뜬다 — 그래서 두 경로가 모두 필요하다.
 * 예전에는 커스텀 이벤트만 있어서, 한 탭에서 로그아웃해도 다른 탭은 계속 열려 있었다.
 */
export function onSessionChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    // key 가 null 인 경우는 localStorage.clear() 다 — 세션도 함께 날아갔다고 본다.
    if (event.key === null || event.key === SESSION_KEY) handler();
  };
  window.addEventListener(AUTH_SESSION_CHANGED_EVENT, handler);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, handler);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * 활동 감시 시작. 해제 함수를 돌려준다.
 * capture 단계에서 듣기 때문에 중간에서 stopPropagation 하는 컴포넌트가 있어도 놓치지 않고,
 * passive 라 스크롤 성능에 영향을 주지 않는다.
 */
export function startActivityTracking(): () => void {
  if (typeof window === "undefined") return () => {};
  const onActivity = () => touchSession();
  for (const type of ACTIVITY_EVENTS) {
    window.addEventListener(type, onActivity, { passive: true, capture: true });
  }
  return () => {
    for (const type of ACTIVITY_EVENTS) {
      window.removeEventListener(type, onActivity, { capture: true });
    }
  };
}

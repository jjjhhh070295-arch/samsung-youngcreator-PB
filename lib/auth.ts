const SESSION_KEY = "pb-auth-session";
export const AUTH_SESSION_CHANGED_EVENT = "pb-auth-session-changed";

// 세션 유효 시간 — 로그인 시점부터 8시간. 갱신 없는 절대 만료다.
// 예전에는 만료 개념이 아예 없어서, localStorage 에 한 번 들어간 PB id 가 브라우저를
// 닫았다 열어도 몇 주가 지나도 그대로 살아 있었다 — "자동 로그인"의 실제 원인이었다.
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

interface StoredSession {
  pbId: string;
  expiresAt: number; // epoch ms
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
 * 저장값 파싱. 두 가지 형태를 받는다.
 * - 현재: {"pbId":"…","expiresAt":1234567890123}
 * - 구버전: PB id 문자열 그대로. 만료 개념이 없던 시절의 값이라 이어받지 않고 버린다 —
 *   이번 배포에서 전원 한 번 로그아웃시켜, 몇 주씩 살아 있던 세션을 여기서 끊는다.
 * 형태가 깨진 값도 세션 없음으로 본다.
 */
function parseSession(raw: string): StoredSession | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* 구버전 문자열 등 — 파싱 실패는 아래에서 세션 없음으로 처리한다 */
  }

  if (parsed !== null && typeof parsed === "object") {
    const { pbId, expiresAt } = parsed as Partial<StoredSession>;
    if (typeof pbId === "string" && pbId && typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
      return { pbId, expiresAt };
    }
    return null;
  }

  // 구버전 문자열 값 — 호출부(getLoggedInPbId)가 removeSession() 으로 정리한다.
  return null;
}

export function getLoggedInPbId(): string | null {
  if (typeof window === "undefined") return null;
  const raw = readRaw();
  if (!raw) return null;

  const session = parseSession(raw);
  if (!session) {
    removeSession();
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    // 만료된 값은 읽는 김에 정리하고, 화면이 곧바로 로그인 상태를 다시 그리게 알린다.
    removeSession();
    notifySessionChanged();
    return null;
  }
  return session.pbId;
}

export function setLoggedInPbId(pbId: string): void {
  if (typeof window === "undefined") return;
  writeSession({ pbId, expiresAt: Date.now() + SESSION_TTL_MS });
  notifySessionChanged();
}

export function clearLoggedInPbId(): void {
  if (typeof window === "undefined") return;
  removeSession();
  notifySessionChanged();
}

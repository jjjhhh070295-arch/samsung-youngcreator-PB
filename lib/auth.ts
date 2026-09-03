const SESSION_KEY = "pb-auth-session";
export const AUTH_SESSION_CHANGED_EVENT = "pb-auth-session-changed";

// 세션 유효 시간 — 로그인 시점부터 8시간. 갱신 없는 절대 만료다.
// 예전에는 만료 개념이 아예 없어서, localStorage 에 한 번 들어간 PB id 가 브라우저를
// 닫았다 열어도 몇 주가 지나도 그대로 살아 있었다 — "자동 로그인"의 실제 원인이었다.
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

interface StoredSession {
  pbId: string;
  pbName?: string; // 로그인 시점의 PB 이름 — 화면이 목록 조회 없이도 이름을 띄우게 한다
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
 * 저장값 파싱. 형태가 깨졌거나 구버전 문자열이면 세션 없음으로 본다
 * (만료 없이 남아 있던 예전 세션을 이 지점에서 끊는다).
 */
function parseSession(raw: string): StoredSession | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* 구버전 문자열 등 — 파싱 실패는 아래에서 세션 없음으로 처리한다 */
  }
  if (parsed === null || typeof parsed !== "object") return null;

  const { pbId, pbName, expiresAt } = parsed as Partial<StoredSession>;
  if (typeof pbId !== "string" || !pbId) return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;

  return {
    pbId,
    pbName: typeof pbName === "string" && pbName ? pbName : undefined,
    expiresAt,
  };
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
  if (session.expiresAt <= Date.now()) {
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

export function setLoggedInPbId(pbId: string, pbName?: string): void {
  if (typeof window === "undefined") return;
  writeSession({
    pbId,
    pbName: pbName || undefined,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  notifySessionChanged();
}

export function clearLoggedInPbId(): void {
  if (typeof window === "undefined") return;
  removeSession();
  notifySessionChanged();
}

const SESSION_KEY = "pb-auth-session";
const CREDS_KEY = "pb-credentials";

interface PBCred { employeeId: string; password: string; }

function loadCreds(): Record<string, PBCred> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(window.localStorage.getItem(CREDS_KEY) ?? "{}"); }
  catch { return {}; }
}

function saveCreds(creds: Record<string, PBCred>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CREDS_KEY, JSON.stringify(creds));
}

// PB 목록 로드 시 기존 PB에 기본 자격증명 없으면 초기화 (사원번호=코드, 비밀번호=1234)
export function initDefaultCredentials(pbs: { id: string; code: string }[]) {
  const creds = loadCreds();
  let changed = false;
  for (const pb of pbs) {
    if (!creds[pb.id]) {
      creds[pb.id] = { employeeId: pb.code, password: "1234" };
      changed = true;
    }
  }
  if (changed) saveCreds(creds);
}

export function setPbCredentials(pbId: string, employeeId: string, password: string) {
  const creds = loadCreds();
  creds[pbId] = { employeeId, password };
  saveCreds(creds);
}

export function getPbCredentials(pbId: string): PBCred | null {
  return loadCreds()[pbId] ?? null;
}

// 로그인: employeeId + password 로 PB 찾기
export function findPbByCredentials(
  pbs: { id: string }[],
  employeeId: string,
  password: string
): string | null {
  const creds = loadCreds();
  for (const pb of pbs) {
    const c = creds[pb.id];
    if (c && c.employeeId === employeeId && c.password === password) return pb.id;
  }
  return null;
}

export function getEmployeeId(pbId: string): string {
  return loadCreds()[pbId]?.employeeId ?? "";
}

// 세션 관리
export function getLoggedInPbId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_KEY);
}

export function setLoggedInPbId(pbId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_KEY, pbId);
}

export function clearLoggedInPbId(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_KEY);
}

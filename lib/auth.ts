export const AUTH_SESSION_CHANGED_EVENT = "pb-auth-session-changed";

function notifySessionChanged(): void {
  window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
}

export interface PublicPbSession {
  pbId: string;
  pbName: string;
  expiresAt: number;
}

async function readResponse(response: Response): Promise<{
  ok: boolean;
  session?: PublicPbSession;
  error?: string;
}> {
  const data = await response.json().catch(() => null) as unknown;
  if (!data || typeof data !== "object") return { ok: false, error: "세션 응답 형식이 올바르지 않습니다." };
  return data as { ok: boolean; session?: PublicPbSession; error?: string };
}

export async function getLoggedInPbSession(): Promise<PublicPbSession | null> {
  const response = await fetch("/api/auth/session", { method: "GET", cache: "no-store", credentials: "same-origin" });
  if (!response.ok) return null;
  const data = await readResponse(response);
  return data.ok && data.session ? data.session : null;
}

export async function loginPb(employeeId: string, password: string): Promise<PublicPbSession> {
  const response = await fetch("/api/auth/session", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ employeeId, password }),
  });
  const data = await readResponse(response);
  if (!response.ok || !data.ok || !data.session) {
    throw new Error(data.error || "로그인에 실패했습니다.");
  }
  notifySessionChanged();
  return data.session;
}

export async function logoutPb(): Promise<void> {
  await fetch("/api/auth/session", { method: "DELETE", cache: "no-store", credentials: "same-origin" });
  notifySessionChanged();
}

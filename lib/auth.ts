const SESSION_KEY = "pb-auth-session";

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

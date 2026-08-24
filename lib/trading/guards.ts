import type { TraderUser } from "./types";

export interface AuthRequestLike {
  headers: {
    get(name: string): string | null;
  };
}

let authResolver: ((req: AuthRequestLike) => Promise<TraderUser | null>) | null = null;

/** Test hook — inject a mock authenticated user resolver. */
export function setAuthResolverForTests(
  resolver: ((req: AuthRequestLike) => Promise<TraderUser | null>) | null,
): void {
  authResolver = resolver;
}

export function canAuthenticate(user: TraderUser | null | undefined): user is TraderUser {
  return !!user && (user.role === "trader" || user.role === "admin");
}

async function resolveSupabaseTrader(req: AuthRequestLike): Promise<TraderUser | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const user = (await res.json()) as {
      id?: string;
      email?: string;
      app_metadata?: { role?: string };
      user_metadata?: { role?: string };
    };
    if (!user.id) return null;
    const role =
      (user.app_metadata?.role as TraderUser["role"] | undefined) ??
      (user.user_metadata?.role as TraderUser["role"] | undefined) ??
      "viewer";
    if (role !== "trader" && role !== "admin") return null;
    return { id: user.id, role, email: user.email };
  } catch {
    return null;
  }
}

async function resolveTraderFromHeader(req: AuthRequestLike): Promise<TraderUser | null> {
  const traderHeader = req.headers.get("x-trader-user");
  if (!traderHeader) return null;
  try {
    const parsed = JSON.parse(traderHeader) as TraderUser;
    return canAuthenticate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function requireTraderAuth(req: AuthRequestLike): Promise<TraderUser> {
  if (authResolver) {
    const resolved = await authResolver(req);
    if (canAuthenticate(resolved)) return resolved;
    throw new AuthError("Unauthorized — trader role required.");
  }

  const headerUser = await resolveTraderFromHeader(req);
  if (canAuthenticate(headerUser)) return headerUser;

  const supabaseUser = await resolveSupabaseTrader(req);
  if (canAuthenticate(supabaseUser)) return supabaseUser;

  throw new AuthError("Unauthorized — trader role required.");
}

export class AuthError extends Error {
  readonly status = 401;

  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

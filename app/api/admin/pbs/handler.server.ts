import { NextRequest, NextResponse } from "next/server";
import {
  PB_SESSION_COOKIE,
  PbSessionConfigurationError,
  verifyPbSessionToken,
  type PbSession,
} from "@/lib/auth/session.server";
import {
  createPb,
  deletePb,
  listClientsByPb,
  listPbs,
  updatePb,
  usingLocalFallback,
} from "@/lib/store";
import type { PB } from "@/lib/types";
import type {
  PbAdminCreateInput,
  PbAdminDto,
  PbAdminUpdateInput,
} from "@/lib/admin/pbAdmin.shared";

type PbMutationResult = PB | void;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PbAdminDependencies {
  storageReady: () => boolean;
  listPbs: () => Promise<PB[]>;
  countClientsByPb: (pbId: string) => Promise<number>;
  createPb: (input: PbAdminCreateInput) => Promise<PB>;
  updatePb: (id: string, input: PbAdminUpdateInput) => Promise<void>;
  deletePb: (id: string) => Promise<void>;
}

export interface PbAdminSecurityOptions {
  adminIdsRaw?: string;
  sessionSecret?: string;
  nowSeconds?: number;
}

const defaultDependencies: PbAdminDependencies = {
  storageReady: () => !usingLocalFallback,
  listPbs,
  countClientsByPb: async (pbId) => (await listClientsByPb(pbId)).length,
  createPb,
  updatePb,
  deletePb,
};

class PbAdminConfigurationError extends Error {
  constructor() {
    super("PB_ADMIN_IDS is missing or empty.");
    this.name = "PbAdminConfigurationError";
  }
}

function privateJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  return response;
}

function parseAdminIds(explicitValue?: string): Set<string> {
  const value = explicitValue ?? process.env.PB_ADMIN_IDS ?? "";
  const ids = value
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) throw new PbAdminConfigurationError();
  return new Set(ids);
}

function authorizeAdmin(
  request: NextRequest,
  options: PbAdminSecurityOptions,
): PbSession | NextResponse {
  try {
    const session = verifyPbSessionToken(
      request.cookies.get(PB_SESSION_COOKIE)?.value,
      { secret: options.sessionSecret, nowSeconds: options.nowSeconds },
    );
    if (!session) {
      return privateJson({ ok: false, code: "PB_SESSION_REQUIRED" }, 401);
    }
    if (!parseAdminIds(options.adminIdsRaw).has(session.pbId)) {
      return privateJson({ ok: false, code: "PB_ADMIN_FORBIDDEN" }, 403);
    }
    return session;
  } catch (error) {
    if (
      error instanceof PbSessionConfigurationError ||
      error instanceof PbAdminConfigurationError
    ) {
      return privateJson({ ok: false, code: "PB_ADMIN_NOT_CONFIGURED" }, 503);
    }
    return privateJson({ ok: false, code: "PB_ADMIN_AUTH_FAILED" }, 500);
  }
}

function requiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength ? text : null;
}

function optionalText(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length <= maxLength ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseCreateInput(value: unknown): PbAdminCreateInput | null {
  if (!isRecord(value)) return null;
  const name = requiredText(value.name, 128);
  const employeeId = requiredText(value.employeeId, 128);
  const password = requiredText(value.password, 256);
  const email = optionalText(value.email, 320);
  const title = optionalText(value.title, 128);
  const phone = optionalText(value.phone, 64);
  if (
    !name ||
    !employeeId ||
    !password ||
    email === null ||
    (email !== undefined && email !== "" && !EMAIL_RE.test(email)) ||
    title === null ||
    phone === null
  ) {
    return null;
  }
  return { name, employeeId, password, email, title, phone };
}

function parseUpdateInput(value: unknown): PbAdminUpdateInput | null {
  if (!isRecord(value)) return null;
  const input: PbAdminUpdateInput = {};
  if (value.name !== undefined) {
    const name = requiredText(value.name, 128);
    if (!name) return null;
    input.name = name;
  }
  if (value.employeeId !== undefined) {
    const employeeId = requiredText(value.employeeId, 128);
    if (!employeeId) return null;
    input.employeeId = employeeId;
  }
  if (value.password !== undefined) {
    const password = requiredText(value.password, 256);
    if (!password) return null;
    input.password = password;
  }
  for (const key of ["email", "title", "phone"] as const) {
    if (value[key] === undefined) continue;
    const maxLength = key === "email" ? 320 : key === "title" ? 128 : 64;
    const text = optionalText(value[key], maxLength);
    if (text === null) return null;
    if (key === "email" && text !== undefined && text !== "" && !EMAIL_RE.test(text)) return null;
    input[key] = text;
  }
  return Object.keys(input).length > 0 ? input : null;
}

function sanitizePb(pb: PB, clientCount: number): PbAdminDto {
  return {
    id: pb.id,
    code: pb.code,
    name: pb.name,
    employeeId: pb.employeeId,
    createdAt: pb.createdAt,
    email: pb.email,
    title: pb.title,
    phone: pb.phone,
    clientCount: Number.isSafeInteger(clientCount) && clientCount >= 0 ? clientCount : 0,
  };
}

async function parseJson(request: NextRequest): Promise<unknown> {
  return request.json().catch(() => null);
}

async function performMutation(
  request: NextRequest,
  dependencies: PbAdminDependencies,
): Promise<PbMutationResult | NextResponse> {
  const body = await parseJson(request);
  if (request.method === "POST") {
    const input = parseCreateInput(body);
    if (!input) return privateJson({ ok: false, code: "INVALID_PB_INPUT" }, 400);
    return dependencies.createPb(input);
  }
  if (!isRecord(body)) return privateJson({ ok: false, code: "INVALID_PB_INPUT" }, 400);
  const id = requiredText(body.id, 128);
  if (!id) return privateJson({ ok: false, code: "INVALID_PB_INPUT" }, 400);
  if (request.method === "PATCH") {
    const input = parseUpdateInput(body.data);
    if (!input) return privateJson({ ok: false, code: "INVALID_PB_INPUT" }, 400);
    await dependencies.updatePb(id, input);
    return;
  }
  if (request.method === "DELETE") {
    await dependencies.deletePb(id);
    return;
  }
  return privateJson({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
}

export async function handlePbAdminRequest(
  request: NextRequest,
  dependencies: PbAdminDependencies = defaultDependencies,
  securityOptions: PbAdminSecurityOptions = {},
) {
  const authorization = authorizeAdmin(request, securityOptions);
  if (authorization instanceof NextResponse) return authorization;
  if (!dependencies.storageReady()) {
    return privateJson({ ok: false, code: "PB_ADMIN_STORAGE_UNAVAILABLE" }, 503);
  }

  try {
    if (request.method === "GET") {
      const pbs = await dependencies.listPbs();
      const sanitized = await Promise.all(
        pbs.map(async (pb) => sanitizePb(pb, await dependencies.countClientsByPb(pb.id))),
      );
      return privateJson({ ok: true, pbs: sanitized });
    }

    const result = await performMutation(request, dependencies);
    if (result instanceof NextResponse) return result;
    if (request.method === "POST" && result) {
      // 새 PB는 아직 담당 고객이 없다. 생성 성공 뒤 별도 조회 실패로 500을 내보내
      // 사용자가 생성을 재시도(중복 생성)하게 만들지 않는다.
      return privateJson({ ok: true, pb: sanitizePb(result, 0) }, 201);
    }
    return privateJson({ ok: true });
  } catch {
    return privateJson({ ok: false, code: "PB_ADMIN_OPERATION_FAILED" }, 500);
  }
}

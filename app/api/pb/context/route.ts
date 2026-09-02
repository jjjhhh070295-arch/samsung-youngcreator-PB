import { NextRequest, NextResponse } from "next/server";
import { listAuthorizedResearchClients } from "@/lib/auth/pbAccess.server";
import {
  PB_SESSION_COOKIE,
  PbSessionConfigurationError,
  verifyPbSessionToken,
} from "@/lib/auth/session.server";
import { listConsultationsByAuthorizedClientIds } from "@/lib/store";

export const dynamic = "force-dynamic";

function privateJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const session = verifyPbSessionToken(request.cookies.get(PB_SESSION_COOKIE)?.value);
    if (!session) return privateJson({ ok: false, error: "Unauthorized" }, { status: 401 });

    const requestedPbId = request.nextUrl.searchParams.get("pbId");
    if (requestedPbId && requestedPbId !== session.pbId) {
      return privateJson({ ok: false, error: "PB 권한이 일치하지 않습니다." }, { status: 403 });
    }

    const clients = await listAuthorizedResearchClients(session.pbId);
    const requestedClientId = request.nextUrl.searchParams.get("clientId");
    const selectedClient = requestedClientId
      ? clients.find((client) => client.id === requestedClientId) ?? null
      : null;
    if (requestedClientId && !selectedClient) {
      return privateJson({ ok: false, error: "허용되지 않은 고객입니다." }, { status: 404 });
    }

    const consultationClientIds = selectedClient
      ? [selectedClient.id]
      : clients.map((client) => client.id);
    const consultations = await listConsultationsByAuthorizedClientIds(consultationClientIds);
    return privateJson({
      ok: true,
      pb: { id: session.pbId, name: session.pbName },
      clients,
      consultations,
      client: selectedClient,
    });
  } catch (error) {
    if (error instanceof PbSessionConfigurationError) {
      return privateJson({ ok: false, error: "PB 세션 보안키가 설정되지 않았습니다." }, { status: 503 });
    }
    return privateJson({ ok: false, error: "PB 고객 문맥을 확인하지 못했습니다." }, { status: 500 });
  }
}

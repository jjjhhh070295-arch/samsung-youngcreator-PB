import { NextRequest, NextResponse } from "next/server";
import { listAuthorizedResearchClients } from "@/lib/auth/pbAccess.server";
import {
  PB_SESSION_COOKIE,
  PbSessionConfigurationError,
  verifyPbSessionToken,
} from "@/lib/auth/session.server";
import { isMacroTrendRange } from "@/lib/researchCopilot/macroEvidence/historyRange";
import type {
  MacroTrendResponse,
  MacroTrendResult,
} from "@/lib/researchCopilot/macroEvidence/historyTypes";
import {
  isMacroTrendResponse,
  isMacroTrendSeriesId,
} from "@/lib/researchCopilot/macroEvidence/historyValidation";
import {
  loadMacroTrendSeries,
  macroTrendSeriesNeedsEcos,
  type MacroHistoryServiceOptions,
} from "@/lib/researchCopilot/macroEvidence/macroHistoryService.server";
import { MACRO_CONSUMER_POLICY } from "@/lib/researchCopilot/macroEvidence/sourceRegistry";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
};

type ClientLister = (pbId: string) => Promise<Array<{ id: string }>>;
type SeriesLoader = (options: MacroHistoryServiceOptions) => Promise<MacroTrendResult>;

export interface MacroHistoryRouteDependencies {
  listClients: ClientLister;
  loadSeries: SeriesLoader;
  readEcosCredential: () => string | undefined;
}

const DEFAULT_DEPENDENCIES: MacroHistoryRouteDependencies = {
  listClients: listAuthorizedResearchClients,
  loadSeries: loadMacroTrendSeries,
  readEcosCredential: () => process.env.ECOS_API_KEY,
};

function privateJson(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function handleMacroHistoryRequest(
  request: NextRequest,
  dependencies: MacroHistoryRouteDependencies = DEFAULT_DEPENDENCIES,
) {
  try {
    // 세션 검증이 고객 조회, connector 호출, 환경변수 접근보다 반드시 먼저입니다.
    const session = verifyPbSessionToken(request.cookies.get(PB_SESSION_COOKIE)?.value);
    if (!session) return privateJson({ ok: false, code: "PB_SESSION_REQUIRED" }, 401);

    const pbId = request.nextUrl.searchParams.get("pbId")?.trim() ?? "";
    const clientId = request.nextUrl.searchParams.get("clientId")?.trim() ?? "";
    const seriesId = request.nextUrl.searchParams.get("seriesId")?.trim() ?? "";
    const range = request.nextUrl.searchParams.get("range")?.trim() ?? "";
    if (!pbId || !clientId || !seriesId || !range) {
      return privateJson({ ok: false, code: "MACRO_HISTORY_QUERY_REQUIRED" }, 400);
    }
    if (pbId !== session.pbId) {
      return privateJson({ ok: false, code: "PB_SESSION_PB_MISMATCH" }, 403);
    }

    if (clientId !== "book") {
      const clients = await dependencies.listClients(session.pbId);
      if (!clients.some((client) => client.id === clientId)) {
        return privateJson({ ok: false, code: "CLIENT_NOT_FOUND" }, 404);
      }
    }

    if (!isMacroTrendRange(range)) {
      return privateJson({ ok: false, code: "MACRO_HISTORY_RANGE_NOT_ALLOWED" }, 400);
    }
    if (!isMacroTrendSeriesId(seriesId)) {
      return privateJson({ ok: false, code: "MACRO_HISTORY_SERIES_NOT_ALLOWED" }, 400);
    }

    // ECOS 계열만 인증키 바인딩을 읽습니다. 값은 아래 서비스 호출 외에 사용하지 않습니다.
    const ecosCredential = macroTrendSeriesNeedsEcos(seriesId)
      ? dependencies.readEcosCredential()
      : undefined;
    const result = await dependencies.loadSeries({
      seriesId,
      range,
      ecosCredential,
    });
    const response: MacroTrendResponse = {
      ok: true,
      pbId: session.pbId,
      clientId,
      range,
      result,
      consumerPolicy: MACRO_CONSUMER_POLICY,
    };
    if (!isMacroTrendResponse(response, { pbId, clientId, seriesId, range })) {
      return privateJson({ ok: false, code: "MACRO_HISTORY_VALIDATION_FAILED" }, 503);
    }
    return privateJson(response, 200);
  } catch (error) {
    if (error instanceof PbSessionConfigurationError) {
      return privateJson({ ok: false, code: "PB_SESSION_CONFIGURATION_UNAVAILABLE" }, 503);
    }
    return privateJson({ ok: false, code: "MACRO_HISTORY_UNAVAILABLE" }, 503);
  }
}

// 고객 공유 링크 payload 조립 — 서버 전용. service_role 로 읽는다.
//
// 쿼리는 getClient() 와 같은 한 건이다(parties + individuals/corporates 조인).
// 다른 점은 셋:
//   · anon 이 아니라 service_role 로 읽는다 → 2차에서 parties anon 권한을 회수해도 산다
//   · 결과를 그대로 내보내지 않고 ClientViewPayload 로 좁힌다
//   · 미승인 초안(draft)을 조회하지 않는다 — 고객 링크에는 승인분만 나간다
//
// investableWon 을 위해 자산 집계를 하지 않는 이유: lib/assets.ts 의 investableKrw 는
// 9/8 리팩터(assetSize=AUM) 이후 parties.asset_size 그 자체다. 따로 계산하면 같은 값을
// 다른 경로로 구하는 것이라 어긋날 여지만 생긴다.

// (server-only 패키지는 이 프로젝트에 없다. 서버 전용이라는 사실은 파일 위치와
//  getSupabaseServerClient 의존으로 표시한다 — 클라이언트에서 부르면 키가 없어 null 이다.)

import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { rowToClient } from "@/lib/store";
import { buildCustomerViewSummary } from "@/lib/customerViewSummary";
import {
  isBasicWorkflowApproved,
  isIpsWorkflowApproved,
  isPortfolioWorkflowApproved,
} from "@/lib/advisory/workflowApprovals";
import {
  CLIENT_VIEW_PAYLOAD_VERSION,
  type ClientViewPayload,
} from "./types";

const PARTY_SELECT = "*, individuals(*), corporates!party_id(*)";

export type ClientViewLoadResult =
  | { ok: true; payload: ClientViewPayload }
  | { ok: false; code: "NO_SERVER_DB" | "NOT_FOUND" | "SERVER_ERROR"; error: string };

export async function loadClientViewPayload(
  clientId: string,
  expiresAt: string,
): Promise<ClientViewLoadResult> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false,
      code: "NO_SERVER_DB",
      error:
        "SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다. 고객 공유 링크는 서버 권한으로만 조회합니다.",
    };
  }

  const { data, error } = await supabase
    .from("parties")
    .select(PARTY_SELECT)
    .eq("id", clientId)
    .maybeSingle();

  if (error) return { ok: false, code: "SERVER_ERROR", error: error.message };
  if (!data) return { ok: false, code: "NOT_FOUND", error: "고객을 찾을 수 없습니다." };

  const client = rowToClient(data);

  // draft 를 넘기지 않으므로 hasProposedDiff=false, proposedInstruments=[] 가 된다.
  // 승인 스냅샷만 요약에 들어간다.
  const summary = buildCustomerViewSummary({
    client,
    investableWon: client.assetSize,
    draft: null,
  });

  const taxNote = client.portfolios?.[0]?.taxNote?.trim() || null;
  const comprehensive = client.financialIncomeComprehensiveTax ?? null;

  return {
    ok: true,
    payload: {
      v: CLIENT_VIEW_PAYLOAD_VERSION,
      expiresAt,
      profile: {
        code: client.code,
        name: client.name,
        clientType: client.clientType,
        birthDate: client.birthDate,
      },
      gates: {
        basicReady: isBasicWorkflowApproved(client),
        portfolioReady: isPortfolioWorkflowApproved(client),
        ipsReady: isIpsWorkflowApproved(client),
        factorsApproved: !!client.stages?.factors,
      },
      investableWon: client.assetSize,
      ips: client.ips,
      // 화면이 쓰는 필드만 남긴다 — entity·accountType·category·taxAccountingNote 는
      // PB 의 세무·회계 메모라 고객에게 갈 것이 아니다.
      cashFlows: (client.cashFlows ?? []).map((cf) => ({
        id: cf.id,
        label: cf.label,
        amount: cf.amount,
        date: cf.date,
        recurring: cf.recurring,
      })),
      tax: taxNote || comprehensive != null ? { comprehensive, note: taxNote } : null,
      summary,
    },
  };
}

/**
 * 링크 발급 전 확인 — 그 고객이 정말 이 PB 담당인지 본다.
 *
 * ⚠️ 이것은 완전한 인가가 아니다. pbId 는 서명 없는 localStorage 세션에서 오고,
 *    parties 는 아직 anon 으로 읽히므로(2차 대상) 작정하면 우회할 수 있다.
 *    담당이 아닌 고객의 링크를 실수로 만드는 것을 막는 수준이고, 서버 세션이
 *    들어오면 이 자리가 그대로 진짜 인가 지점이 된다.
 */
export async function assertClientBelongsToPb(
  clientId: string,
  pbId: string,
): Promise<{ ok: true } | { ok: false; code: "NO_SERVER_DB" | "NOT_FOUND" | "FORBIDDEN"; error: string }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return { ok: false, code: "NO_SERVER_DB", error: "SUPABASE_SERVICE_ROLE_KEY 가 없습니다." };
  }
  const { data, error } = await supabase
    .from("parties")
    .select("id, pb_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, code: "NOT_FOUND", error: error?.message ?? "고객을 찾을 수 없습니다." };
  }
  if ((data as any).pb_id !== pbId) {
    return { ok: false, code: "FORBIDDEN", error: "담당 고객이 아닙니다." };
  }
  return { ok: true };
}

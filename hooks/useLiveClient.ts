"use client";

/**
 * 고객 라이브 동기화 훅 — 고객 전환 시 이전 고객 잔상 방지, revision 으로 순서 역전 무시.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Client } from "@/lib/types";
import { getClient, getPortfolioDraft } from "@/lib/store";
import { resolveAssetBreakdown } from "@/lib/assets";
import type { ManualPortfolioDraft } from "@/lib/manualPortfolioDraft";
import {
  isSupabaseConfigured,
} from "@/lib/supabase";
import {
  subscribeClientLiveSync,
  type ClientLiveSyncMessage,
  type ClientLiveSyncMode,
} from "@/lib/clientLiveSync";

export type LiveClientState = {
  client: Client | null;
  investableWon: number | null;
  draft: ManualPortfolioDraft | null;
  status: "loading" | "ready" | "error" | "switching";
  syncMode: ClientLiveSyncMode;
  syncHint: string | null;
  refreshing: boolean;
  lastSyncAt: string | null;
  errorMessage: string | null;
  reload: () => Promise<void>;
};

export function useLiveClient(
  clientId: string | null | undefined,
  opts?: {
    pbId?: string | null;
    /** 부모가 이미 보유한 초기 클라이언트(임베드용). 전환 시 무시 */
    initialClient?: Client | null;
    initialInvestableWon?: number | null;
    enablePolling?: boolean;
    pollMs?: number;
  },
): LiveClientState {
  const [client, setClient] = useState<Client | null>(opts?.initialClient ?? null);
  const [investableWon, setInvestableWon] = useState<number | null>(
    opts?.initialInvestableWon ?? null,
  );
  const [draft, setDraft] = useState<ManualPortfolioDraft | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "switching">(
    opts?.initialClient ? "ready" : "loading",
  );
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncHint, setSyncHint] = useState<string | null>(null);

  const appliedRevision = useRef(0);
  const fetchGen = useRef(0);
  const activeId = useRef(clientId ?? "");

  const syncMode: ClientLiveSyncMode = isSupabaseConfigured ? "realtime" : "polling";

  const fetchAll = useCallback(
    async (reason: string, revision?: number) => {
      const id = clientId;
      if (!id) return;
      if (revision != null && revision < appliedRevision.current) return;

      const gen = ++fetchGen.current;
      const isSwitch = activeId.current !== id;
      if (isSwitch) {
        activeId.current = id;
        setClient(null);
        setInvestableWon(null);
        setDraft(null);
        setStatus("switching");
      } else if (status === "ready") {
        setRefreshing(true);
      } else {
        setStatus("loading");
      }

      try {
        const [c, assets, draftRes] = await Promise.all([
          getClient(id),
          resolveAssetBreakdown(id).catch(() => null),
          getPortfolioDraft(opts?.pbId || "local", id).catch(() => ({
            draft: null,
            source: "local" as const,
            dbReadFailed: true,
          })),
        ]);
        if (fetchGen.current !== gen || activeId.current !== id) return;
        if (revision != null && revision < appliedRevision.current) return;
        if (revision != null) appliedRevision.current = revision;

        if (!c) {
          setErrorMessage("고객 정보를 불러올 수 없습니다.");
          setStatus("error");
          setClient(null);
          return;
        }
        setClient(c);
        setInvestableWon(assets?.investableKrw ?? null);
        setDraft(draftRes.draft);
        setStatus("ready");
        setErrorMessage(null);
        setLastSyncAt(new Date().toISOString());
        setSyncHint(
          reason === "poll"
            ? null
            : reason === "focus"
              ? "화면 복귀 시 갱신됨"
              : reason === "realtime"
                ? "원격 변경 반영"
                : reason === "reconnect"
                  ? "재연결 후 갱신됨"
                  : null,
        );
      } catch (e: any) {
        if (fetchGen.current !== gen || activeId.current !== id) return;
        setErrorMessage(e?.message || "동기화 실패");
        if (status !== "ready") setStatus("error");
      } finally {
        if (fetchGen.current === gen) setRefreshing(false);
      }
    },
    [clientId, opts?.pbId, status],
  );

  const reload = useCallback(async () => {
    await fetchAll("manual", Date.now());
  }, [fetchAll]);

  // 초기·고객 전환
  useEffect(() => {
    if (!clientId) return;
    void fetchAll("manual", Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clientId 변경 시에만 강제 로드
  }, [clientId]);

  // 부모가 넘긴 최신 client 반영(같은 세션 즉시 반영)
  useEffect(() => {
    if (!opts?.initialClient) return;
    if (opts.initialClient.id !== clientId) return;
    setClient(opts.initialClient);
    if (opts.initialInvestableWon !== undefined) {
      setInvestableWon(opts.initialInvestableWon);
    }
    setStatus("ready");
  }, [opts?.initialClient, opts?.initialInvestableWon, clientId]);

  useEffect(() => {
    if (!clientId) return;
    return subscribeClientLiveSync({
      clientId,
      enablePolling: opts?.enablePolling !== false,
      pollMs: opts?.pollMs,
      onMessage: (msg: ClientLiveSyncMessage) => {
        void fetchAll(msg.reason, msg.revision);
      },
    });
  }, [clientId, fetchAll, opts?.enablePolling, opts?.pollMs]);

  return {
    client,
    investableWon,
    draft,
    status,
    syncMode,
    syncHint,
    refreshing,
    lastSyncAt,
    errorMessage,
    reload,
  };
}

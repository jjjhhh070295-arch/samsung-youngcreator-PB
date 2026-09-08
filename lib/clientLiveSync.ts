/**
 * 고객 데이터 라이브 동기화 버스.
 * - 같은 탭: CustomEvent
 * - 같은 브라우저 다른 창: BroadcastChannel (+ storage 백업)
 * - Supabase 가능 시: parties / client_holdings realtime
 * - 폴백: focus 재검증 + 제한 폴링
 *
 * localStorage 단독·CustomEvent 단독은 완전한 실시간으로 취급하지 않는다.
 */

import { supabase, isSupabaseConfigured } from "./supabase";

export const CLIENT_LIVE_SYNC_EVENT = "pb-client-live-sync";
export const CLIENT_LIVE_SYNC_STORAGE_KEY = "pb-client-live-sync-v1";
export const CLIENT_LIVE_SYNC_CHANNEL = "pb-client-live-sync";

/** AppNav 등 기존 리스너 호환 */
export const CLIENT_UPDATED_EVENT = "pb-client-updated";

export type ClientLiveSyncReason =
  | "save"
  | "holdings"
  | "draft"
  | "approval"
  | "assets"
  | "poll"
  | "focus"
  | "realtime"
  | "reconnect"
  | "manual";

export type ClientLiveSyncMessage = {
  v: 1;
  clientId: string;
  /** 단조 증가 시각(ms). 오래된 메시지는 무시한다. */
  revision: number;
  at: string;
  reason: ClientLiveSyncReason;
  source: string;
};

export type ClientLiveSyncMode = "broadcast" | "realtime" | "polling" | "idle";

const POLL_MS = 12_000;
const STORAGE_DEBOUNCE_MS = 80;

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(CLIENT_LIVE_SYNC_CHANNEL);
    } catch {
      channel = null;
    }
  }
  return channel;
}

export function publishClientLiveSync(
  clientId: string,
  reason: ClientLiveSyncReason,
  source = "app",
): ClientLiveSyncMessage | null {
  if (!clientId || typeof window === "undefined") return null;
  const msg: ClientLiveSyncMessage = {
    v: 1,
    clientId,
    revision: Date.now(),
    at: new Date().toISOString(),
    reason,
    source,
  };

  window.dispatchEvent(new CustomEvent(CLIENT_LIVE_SYNC_EVENT, { detail: msg }));
  window.dispatchEvent(new Event(CLIENT_UPDATED_EVENT));
  window.dispatchEvent(new Event("pb-evidence-updated"));

  try {
    getChannel()?.postMessage(msg);
  } catch {
    /* ignore */
  }

  try {
    window.localStorage.setItem(CLIENT_LIVE_SYNC_STORAGE_KEY, JSON.stringify(msg));
  } catch {
    /* ignore */
  }

  return msg;
}

function parseMessage(raw: unknown): ClientLiveSyncMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<ClientLiveSyncMessage>;
  if (m.v !== 1 || typeof m.clientId !== "string" || typeof m.revision !== "number") return null;
  if (!m.clientId.trim()) return null;
  return {
    v: 1,
    clientId: m.clientId,
    revision: m.revision,
    at: typeof m.at === "string" ? m.at : new Date().toISOString(),
    reason: (m.reason as ClientLiveSyncReason) || "manual",
    source: typeof m.source === "string" ? m.source : "unknown",
  };
}

export type SubscribeClientLiveSyncOptions = {
  clientId: string;
  onMessage: (msg: ClientLiveSyncMessage) => void;
  /** false 이면 Supabase realtime 생략 */
  enableRealtime?: boolean;
  /** false 이면 폴링 생략 */
  enablePolling?: boolean;
  pollMs?: number;
};

/**
 * 현재 고객만 구독. 정리 함수 반환.
 * out-of-order 는 호출부가 revision 으로 거른다.
 */
export function subscribeClientLiveSync(opts: SubscribeClientLiveSyncOptions): () => void {
  const { clientId, onMessage } = opts;
  if (typeof window === "undefined" || !clientId) return () => {};

  let lastSeen = 0;
  let storageTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let realtimeChannel: ReturnType<NonNullable<typeof supabase>["channel"]> | null = null;
  let alive = true;

  const deliver = (msg: ClientLiveSyncMessage) => {
    if (!alive) return;
    if (msg.clientId !== clientId) return;
    if (msg.revision <= lastSeen) return;
    lastSeen = msg.revision;
    onMessage(msg);
  };

  const onCustom = (ev: Event) => {
    const detail = (ev as CustomEvent).detail;
    const msg = parseMessage(detail);
    if (msg) deliver(msg);
  };

  const onStorage = (ev: StorageEvent) => {
    if (ev.key !== CLIENT_LIVE_SYNC_STORAGE_KEY || !ev.newValue) return;
    if (storageTimer) clearTimeout(storageTimer);
    storageTimer = setTimeout(() => {
      try {
        const msg = parseMessage(JSON.parse(ev.newValue!));
        if (msg) deliver(msg);
      } catch {
        /* ignore */
      }
    }, STORAGE_DEBOUNCE_MS);
  };

  const onFocus = () => {
    deliver({
      v: 1,
      clientId,
      revision: Date.now(),
      at: new Date().toISOString(),
      reason: "focus",
      source: "window",
    });
  };

  const onOnline = () => {
    deliver({
      v: 1,
      clientId,
      revision: Date.now(),
      at: new Date().toISOString(),
      reason: "reconnect",
      source: "window",
    });
  };

  window.addEventListener(CLIENT_LIVE_SYNC_EVENT, onCustom as EventListener);
  const onLegacyUpdated = () => {
    deliver({
      v: 1,
      clientId,
      revision: Date.now(),
      at: new Date().toISOString(),
      reason: "save",
      source: "legacy-event",
    });
  };
  window.addEventListener(CLIENT_UPDATED_EVENT, onLegacyUpdated);
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onOnline);

  const bc = getChannel();
  const onBc = (ev: MessageEvent) => {
    const msg = parseMessage(ev.data);
    if (msg) deliver(msg);
  };
  bc?.addEventListener("message", onBc);

  if (opts.enablePolling !== false) {
    const ms = opts.pollMs ?? POLL_MS;
    pollTimer = setInterval(() => {
      deliver({
        v: 1,
        clientId,
        revision: Date.now(),
        at: new Date().toISOString(),
        reason: "poll",
        source: "timer",
      });
    }, ms);
  }

  if (opts.enableRealtime !== false && isSupabaseConfigured && supabase) {
    try {
      const name = `client-live:${clientId}:${Math.random().toString(36).slice(2, 8)}`;
      realtimeChannel = supabase
        .channel(name)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "parties", filter: `id=eq.${clientId}` },
          () => {
            deliver({
              v: 1,
              clientId,
              revision: Date.now(),
              at: new Date().toISOString(),
              reason: "realtime",
              source: "parties",
            });
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "client_holdings",
            filter: `client_id=eq.${clientId}`,
          },
          () => {
            deliver({
              v: 1,
              clientId,
              revision: Date.now(),
              at: new Date().toISOString(),
              reason: "realtime",
              source: "client_holdings",
            });
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "portfolio_drafts",
            filter: `client_id=eq.${clientId}`,
          },
          () => {
            deliver({
              v: 1,
              clientId,
              revision: Date.now(),
              at: new Date().toISOString(),
              reason: "realtime",
              source: "portfolio_drafts",
            });
          },
        )
        .subscribe();
    } catch {
      realtimeChannel = null;
    }
  }

  return () => {
    alive = false;
    window.removeEventListener(CLIENT_LIVE_SYNC_EVENT, onCustom as EventListener);
    window.removeEventListener(CLIENT_UPDATED_EVENT, onLegacyUpdated);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onOnline);
    bc?.removeEventListener("message", onBc);
    if (storageTimer) clearTimeout(storageTimer);
    if (pollTimer) clearInterval(pollTimer);
    if (realtimeChannel && supabase) {
      void supabase.removeChannel(realtimeChannel);
    }
  };
}

export function describeSyncMode(input: {
  hasRealtime: boolean;
  polling: boolean;
}): ClientLiveSyncMode {
  if (input.hasRealtime) return "realtime";
  if (input.polling) return "polling";
  return "broadcast";
}

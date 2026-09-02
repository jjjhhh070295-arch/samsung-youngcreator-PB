"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PB, Client } from "@/lib/types";
import {
  listPbs,
  listClients,
  createPb,
  updatePb,
  deletePb,
  usingLocalFallback,
  DEMO_PB_ID,
  DEMO_PB_CREDENTIALS,
} from "@/lib/store";
import { AUTH_SESSION_CHANGED_EVENT, getLoggedInPbId, setLoggedInPbId } from "@/lib/auth";
import PBManageModal from "@/components/PBManageModal";
import { LoadingView, ErrorView } from "@/components/StateViews";
import HomeMarketBoard from "@/components/HomeMarketBoard";

export default function HomePage() {
  const router = useRouter();

  const [pbs, setPbs] = useState<PB[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [pbManageOpen, setPbManageOpen] = useState(false);
  const [loadError, setLoadError] = useState("");

  // 로그인 폼 상태
  const [loginEmpId, setLoginEmpId] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loggedInPbId, setLoggedInPbIdState] = useState<string | null>(null);

  // 시세 상태와 폴링은 components/HomeMarketBoard.tsx 로 옮겼다 — 로그인 뒤에만 마운트된다.

  useEffect(() => {
    const syncSession = () => setLoggedInPbIdState(getLoggedInPbId());
    syncSession();
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, syncSession);
    return () => window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, syncSession);
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const [p, c] = await Promise.all([listPbs(), listClients()]);
      setPbs(p);
      setClients(c);
      setStatus("ready");
    } catch (e: any) {
      console.error(e);
      setLoadError(e?.message ?? String(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clientCount = (pbId: string) => clients.filter((c) => c.assignedPbId === pbId).length;

  const handleLogin = async () => {
    setLoginError("");
    setLoginBusy(true);
    try {
      const employeeId = loginEmpId.trim().toUpperCase();
      const normalizedPassword = password.trim();

      // 최신 PB 목록을 다시 읽어 데모 PB 보장 후 매칭 (stale state / 구 localStorage 대비)
      const latestPbs = await listPbs();
      setPbs(latestPbs);

      const demoLogin =
        employeeId === DEMO_PB_CREDENTIALS.employeeId &&
        normalizedPassword === DEMO_PB_CREDENTIALS.password;

      const found =
        latestPbs.find(
          (pb) =>
            pb.employeeId.trim().toUpperCase() === employeeId && pb.password === normalizedPassword,
        ) ??
        (demoLogin
          ? latestPbs.find((pb) => pb.id === DEMO_PB_ID) ??
            latestPbs.find((pb) => pb.code.trim().toUpperCase() === "PB-001")
          : undefined);

      if (!found) {
        setLoginError("사원번호 또는 비밀번호가 올바르지 않습니다.");
        return;
      }
      setLoggedInPbId(found.id);
      router.push(`/pb/${found.id}`);
    } finally {
      setLoginBusy(false);
    }
  };

  const handleCreatePb = async (data: { name: string; employeeId: string; password: string; email?: string; title?: string; phone?: string }) => {
    const pb = await createPb(data);
    await load();
    return pb;
  };

  const handleUpdatePb = async (id: string, data: { name?: string; employeeId?: string; password?: string; email?: string; title?: string; phone?: string }) => {
    await updatePb(id, data);
    await load();
  };

  const handleDeletePb = async (id: string) => {
    await deletePb(id);
    await load();
  };

  return (
    <div className="px-6 py-6">
      {/* 브랜딩 — 로그인 여부와 무관하게 항상 보인다. 로그인 전에는 이 아래가 바로
          로그인 폼이라, 서비스 식별 요소가 화면에서 사라지지 않게 남겨 둔다. */}
      <div className="mb-6">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-[#1428A0]">
          <span className="h-px w-6 bg-[#1428A0]" />
          SAMSUNG SECURITIES · PRIVATE BANKING
        </p>
        <p className="mt-2 text-sm text-fg-muted">
          삼성증권의 노하우로 <b className="text-fg">고객의 상황에 맞춰 최적의 솔루션</b>을 제공합니다.
        </p>
        <p className="mt-1 text-[11px] text-fg-muted/70">
          ※ 본 도구의 분석·포트폴리오 결과는 참고용이며 투자 권유가 아닙니다.
        </p>
      </div>

      {/* 미니차트·시세 전광판은 로그인 뒤에만. 로그인 전 화면은 로그인 폼 하나로 좁힌다. */}
      {loggedInPbId && <HomeMarketBoard />}

      {/* 로그인 영역 */}
      {status === "loading" && <LoadingView />}
      {status === "error" && (
        <ErrorView
          message={loadError || "불러오기에 실패했습니다."}
          onRetry={load}
        />
      )}

      {status === "ready" && (
        // 로그인 전에는 카드가 로그인 폼 하나뿐이라 2열 그리드를 쓰면 오른쪽이 빈다.
        <div
          className={
            loggedInPbId
              ? "grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1fr]"
              : "mx-auto w-full max-w-md"
          }
        >
          {/* 로그인 상태 / 로그인 폼 */}
          {loggedInPbId ? (
            <div className="rounded-2xl border border-border bg-surface p-8 shadow-card">
              <div className="mb-6">
                <div className="mb-1 flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-black text-white">
                    ✓
                  </span>
                  <span className="text-base font-bold text-fg">PB 로그인 상태</span>
                </div>
                <p className="text-xs text-fg-muted">홈 화면을 둘러보는 동안에도 로그인 상태가 유지됩니다.</p>
              </div>
              <div className="space-y-3">
                <div className="rounded-lg bg-surface-2 px-4 py-4">
                  <p className="text-xs text-fg-muted">현재 로그인</p>
                  <p className="mt-1 text-base font-bold text-fg">
                    {pbs.find((pb) => pb.id === loggedInPbId)?.name ?? "PB 사용자"}
                  </p>
                </div>
                <button
                  className="w-full rounded-lg bg-[#1428A0] py-3 text-sm font-bold text-white transition-colors hover:bg-[#1020c0]"
                  onClick={() => router.push(`/pb/${loggedInPbId}`)}
                >
                  PB 고객관리로 돌아가기
                </button>
              </div>
            </div>
          ) : (
          <div className="rounded-2xl border border-border bg-surface p-8 shadow-card">
            <div className="mb-6">
              <div className="mb-1 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1428A0] text-sm font-black text-white">
                  S
                </span>
                <span className="text-base font-bold text-fg">PB 로그인</span>
              </div>
              <p className="text-xs text-fg-muted">본인의 사원번호와 비밀번호로 로그인하세요.</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="label">사원번호</label>
                <input
                  className="input"
                  value={loginEmpId}
                  placeholder="사원번호 입력 (예: PB-001)"
                  onChange={(e) => { setLoginEmpId(e.target.value); setLoginError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
              </div>
              <div>
                <label className="label">비밀번호</label>
                <input
                  className="input"
                  type="password"
                  value={password}
                  placeholder="비밀번호 입력"
                  onChange={(e) => { setPassword(e.target.value); setLoginError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
              </div>

              {loginError && (
                <p className="text-xs text-red-500">{loginError}</p>
              )}

              <button
                className="w-full rounded-lg bg-[#1428A0] py-3 text-sm font-bold text-white hover:bg-[#1020c0] transition-colors disabled:opacity-50"
                onClick={handleLogin}
                disabled={loginBusy || !loginEmpId.trim() || !password}
              >
                {loginBusy ? "로그인 중…" : "로그인"}
              </button>

              {/* 시연 편의를 위해 계정을 남긴다. DEMO_PB_CREDENTIALS 는 lib/store.ts 에
                  하드코딩돼 클라이언트 번들에도 그대로 들어가므로, 화면에서만 지운다고
                  가려지지 않는다 — 대신 데모 전용임을 명시한다. */}
              <p className="text-center text-[11px] text-fg-muted">
                시연 계정: {DEMO_PB_CREDENTIALS.employeeId} / {DEMO_PB_CREDENTIALS.password}
              </p>
              <p className="text-center text-[10px] text-fg-muted/70">
                데모 전용 계정입니다 — 실제 고객 데이터는 포함되어 있지 않습니다.
              </p>
            </div>
          </div>
          )}

          {/* 관리자 패널 — PB 계정 생성·수정·삭제(비밀번호 변경 포함)가 가능하므로
              로그인 상태에서만 노출한다. 이전에는 로그인 없이도 보였다. */}
          {loggedInPbId && (
            <div className="rounded-2xl border border-border bg-surface p-8 shadow-card">
              <div className="mb-6">
                <p className="text-base font-bold text-fg">관리자</p>
                <p className="text-xs text-fg-muted">PB 계정 등록 및 관리</p>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg bg-surface-2 px-4 py-3">
                  <span className="text-sm text-fg">등록된 PB</span>
                  <span className="text-lg font-black text-[#1428A0]">{pbs.length}명</span>
                </div>
                <button
                  className="w-full rounded-lg border border-[#1428A0] py-3 text-sm font-bold text-[#1428A0] hover:bg-[#1428A0] hover:text-white transition-colors"
                  onClick={() => setPbManageOpen(true)}
                >
                  PB 계정 관리
                </button>
              </div>

              {usingLocalFallback && (
                <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700 border border-amber-200">
                  ⚠️ 로컬 모드 — Supabase 키 없이 브라우저에만 저장됩니다.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 모달도 로그인 상태에서만 마운트한다 — 패널을 숨겨도 pbManageOpen 만 켜지면
          열리는 경로를 함께 막는다. */}
      {loggedInPbId && (
        <PBManageModal
          open={pbManageOpen}
          pbs={pbs}
          clientCountOf={clientCount}
          onCreate={handleCreatePb}
          onUpdate={handleUpdatePb}
          onDelete={handleDeletePb}
          onClose={() => setPbManageOpen(false)}
        />
      )}
    </div>
  );
}

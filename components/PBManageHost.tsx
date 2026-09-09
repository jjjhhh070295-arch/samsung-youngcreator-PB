"use client";

// PB 계정 관리 모달의 전역 호스트. app/layout.tsx 에 한 번만 마운트된다.
//
// 예전에는 홈 화면(app/page.tsx)이 이 모달과 데이터를 들고 있어서, 관리 기능을 쓰려면
// 반드시 홈으로 돌아가야 했다. 모달을 상단 네비에서 열게 되면서 소유자를 옮긴다.
//
// 데이터는 모달을 처음 열 때만 읽는다. 레이아웃에 붙는 컴포넌트라 앱을 켜자마자
// listPbs/listClients 를 부르면 모든 화면의 첫 로딩에 쿼리 두 개가 얹힌다 —
// 관리 기능은 가끔 쓰는 것이라 그 비용을 상시로 낼 이유가 없다.
//
// 로그인 상태에서만 동작한다. 세션이 없으면 이벤트가 와도 무시한다.

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { PB, Client } from "@/lib/types";
import { listPbs, listClients, createPb, updatePb, deletePb } from "@/lib/store";
import { getLoggedInPbId, onSessionChanged } from "@/lib/auth";
import { PB_MANAGE_OPEN_EVENT } from "@/lib/pbManage";
import { isCustomerFacingPath } from "@/lib/customerFacingRoutes";
import PBManageModal from "./PBManageModal";

export default function PBManageHost() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pbs, setPbs] = useState<PB[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const sync = () => setLoggedIn(!!getLoggedInPbId());
    sync();
    return onSessionChanged(sync);
  }, []);

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([listPbs(), listClients()]);
      setPbs(p);
      setClients(c);
    } catch (e) {
      // 목록을 못 읽어도 모달은 연다 — 신규 등록은 목록 없이도 할 수 있고,
      // 여기서 화면을 막으면 사용자는 왜 안 열리는지 알 수 없다.
      console.warn("[PBManageHost] PB 목록 조회 실패:", e);
    }
  }, []);

  useEffect(() => {
    const onOpen = () => {
      if (!getLoggedInPbId()) return; // 로그아웃 상태에서는 열지 않는다
      setOpen(true);
      void load();
    };
    window.addEventListener(PB_MANAGE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(PB_MANAGE_OPEN_EVENT, onOpen);
  }, [load]);

  // 로그아웃하면 열려 있던 모달을 닫는다. 남겨 두면 다음 로그인 화면 위에 뜬다.
  useEffect(() => {
    if (!loggedIn) setOpen(false);
  }, [loggedIn]);

  const clientCountOf = useCallback(
    (pbId: string) => clients.filter((c) => c.assignedPbId === pbId).length,
    [clients],
  );

  const handleCreate = async (data: Parameters<typeof createPb>[0]) => {
    const pb = await createPb(data);
    await load();
    return pb;
  };
  const handleUpdate = async (id: string, data: Parameters<typeof updatePb>[1]) => {
    await updatePb(id, data);
    await load();
  };
  const handleDelete = async (id: string) => {
    await deletePb(id);
    await load();
  };

  // 고객 대면 화면에서는 PB 계정 관리 모달이 뜰 자리가 아니다. 이벤트를 받을 일도
  // 없지만(네비가 없다), 레이아웃에 붙는 컴포넌트라 경로로 한 번 더 끊는다.
  if (isCustomerFacingPath(pathname)) return null;

  if (!open) return null;

  return (
    <PBManageModal
      open={open}
      pbs={pbs}
      clientCountOf={clientCountOf}
      onCreate={handleCreate}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
      onClose={() => setOpen(false)}
    />
  );
}

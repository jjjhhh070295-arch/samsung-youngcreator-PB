"use client";

// 투자정책서(IPS) 문서 — 인쇄/PDF 저장용. 고객 데이터로 자동 생성.

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { Client, PB } from "@/lib/types";
import { getClient, listPbs } from "@/lib/store";
import { resolveAssetBreakdown } from "@/lib/assets";
import { LoadingView, ErrorView } from "@/components/StateViews";
import IpsA4Document from "@/components/ips/IpsA4Document";
import { canIssueClientPdf, loadBundle, pdfBlockReason } from "@/lib/advisory/control";
import type { EvidenceBundle } from "@/lib/advisory/types";
import { advisoryInputHash } from "@/lib/advisory/integrity";
import { isSamePrintAttempt } from "@/lib/advisory/printPermitBinding";
import { stableJsonStringify } from "@/lib/advisory/stableJson";
import { isIpsWorkflowApproved } from "@/lib/advisory/workflowApprovals";
import { syncEvidenceAfterIpsApproval } from "@/lib/advisory/workflowEvidenceSync";

type VerifiedPrintPermit = {
  token: string;
  clientId: string;
  pbId: string;
  evidenceId: string;
  verifiedInputHash: string;
  evidenceDigest: string;
  expiresAt: string;
  mode: "authoritative" | "local-self-consistency";
  clientSnapshot: Client;
  pbSnapshot: Pick<PB, "id" | "name">;
  evidenceSnapshot: EvidenceBundle;
};

function printPermitKey(permit: VerifiedPrintPermit): string {
  return [
    permit.clientId,
    permit.pbId,
    permit.evidenceId,
    permit.token,
    permit.verifiedInputHash,
    permit.evidenceDigest,
    permit.expiresAt,
  ].join("\u0000");
}

function humanizePdfReason(reason: string) {
  return reason
    .replaceAll("Evidence Bundle", "계산·검토 기록")
    .replaceAll("Evidence", "상담 현재본")
    .replaceAll("Judge", "검토")
    .replaceAll("judge", "검토")
    .replaceAll("locked", "확정")
    .replaceAll("blocked", "차단")
    .replaceAll("draft", "초안")
    .replaceAll("inputHash", "입력 확인값")
    .replaceAll("settingsHash", "설정 확인값")
    .replaceAll("resultHash", "계산 확인값")
    .replaceAll("runId", "검토 기록 ID");
}

export default function IPSDocumentPage() {
  const { pbId, clientId } = useParams<{ pbId: string; clientId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDraftPreview = searchParams?.get("mode") === "draft";
  const [client, setClient] = useState<Client | null>(null);
  const [pbs, setPbs] = useState<PB[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [pdfBlocked, setPdfBlocked] = useState(true);
  const [pdfReason, setPdfReason] = useState("최신 상담 내용과 문서 발행 조건을 확인하고 있습니다.");
  const [printPermit, setPrintPermit] = useState<VerifiedPrintPermit | null>(null);
  const [printBusy, setPrintBusy] = useState(false);
  const [evidenceRevision, setEvidenceRevision] = useState(0);
  // 세금 추정 원금용 투자가능자산(부동산 제외). 조회 전/실패 시 null → 총자산 폴백.
  const [investableWon, setInvestableWon] = useState<number | null>(null);
  const routeKey = `${pbId}\u0000${clientId}`;
  const routeKeyRef = useRef(routeKey);
  routeKeyRef.current = routeKey;
  const clientRef = useRef<Client | null>(client);
  clientRef.current = client;
  const pbDisplayRef = useRef("");
  const printPermitRef = useRef<VerifiedPrintPermit | null>(printPermit);
  printPermitRef.current = printPermit;
  const flowEpochRef = useRef(0);
  const loadEpochRef = useRef(0);
  const verifyAbortRef = useRef<AbortController | null>(null);
  const printAbortRef = useRef<AbortController | null>(null);
  const printArmedRef = useRef<{ routeKey: string; permitKey: string } | null>(null);

  const load = useCallback(async () => {
    const requestedRouteKey = routeKey;
    const requestedLoadEpoch = ++loadEpochRef.current;
    setStatus("loading");
    try {
      const [c, allPbs] = await Promise.all([getClient(clientId), listPbs()]);
      if (
        loadEpochRef.current !== requestedLoadEpoch ||
        routeKeyRef.current !== requestedRouteKey
      ) return;
      if (!c) {
        setStatus("error");
        return;
      }
      setClient(c);
      setPbs(allPbs);
      setStatus("ready");
    } catch (e) {
      if (
        loadEpochRef.current !== requestedLoadEpoch ||
        routeKeyRef.current !== requestedRouteKey
      ) return;
      console.error(e);
      setStatus("error");
    }
  }, [clientId, routeKey]);

  useEffect(() => {
    load();
  }, [load]);

  // 투자가능자산(총자산 − 부동산) 조회 — projectTax 원금에 쓴다. 실패해도 문서는 그대로
  // 뜨고 총자산 폴백으로 계산된다.
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    resolveAssetBreakdown(clientId)
      .then((b) => { if (!cancelled) setInvestableWon(b?.investableKrw ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientId]);

  const assignedPb = client ? pbs.find((pb) => pb.id === client.assignedPbId) : undefined;
  const pbDisplay = client ? assignedPb?.name ?? "미지정" : "";
  pbDisplayRef.current = pbDisplay;

  const replacePrintPermit = useCallback((next: VerifiedPrintPermit | null) => {
    printPermitRef.current = next;
    setPrintPermit(next);
  }, []);

  const verifiedEvidenceIsCurrent = useCallback((candidate?: VerifiedPrintPermit | null) => {
    const permit = candidate ?? printPermitRef.current;
    const currentClient = clientRef.current;
    const currentPbDisplay = pbDisplayRef.current;
    const expiresAtMs = permit ? Date.parse(permit.expiresAt) : Number.NaN;
    if (
      !permit ||
      !currentClient ||
      permit.evidenceId === "" ||
      routeKeyRef.current !== `${permit.pbId}\u0000${permit.clientId}` ||
      currentClient.id !== permit.clientId ||
      currentClient.assignedPbId !== permit.pbId ||
      permit.clientSnapshot.id !== permit.clientId ||
      permit.clientSnapshot.assignedPbId !== permit.pbId ||
      permit.pbSnapshot.id !== permit.pbId ||
      !currentPbDisplay ||
      currentPbDisplay !== permit.pbSnapshot.name ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= Date.now()
    ) return false;
    const latest = loadBundle(permit.clientId);
    try {
      return (
        latest.id === permit.evidenceId &&
        canIssueClientPdf(latest) &&
        latest.inputHash === permit.verifiedInputHash &&
        stableJsonStringify(latest) === stableJsonStringify(permit.evidenceSnapshot) &&
        advisoryInputHash(currentClient, { assignedPbDisplay: currentPbDisplay }) === permit.verifiedInputHash &&
        advisoryInputHash(permit.clientSnapshot, {
          assignedPbDisplay: permit.pbSnapshot.name,
        }) === permit.verifiedInputHash
      );
    } catch {
      return false;
    }
  }, []);

  const blockPdfNow = useCallback((reason: string) => {
    document.body.classList.add("pb-pdf-print-blocked");
    flowEpochRef.current += 1;
    verifyAbortRef.current?.abort();
    verifyAbortRef.current = null;
    printAbortRef.current?.abort();
    printAbortRef.current = null;
    printArmedRef.current = null;
    replacePrintPermit(null);
    setPrintBusy(false);
    setPdfBlocked(true);
    setPdfReason(humanizePdfReason(reason));
  }, [replacePrintPermit]);

  useEffect(() => {
    blockPdfNow("고객·담당 PB·최신 상담본을 다시 확인하고 있습니다.");
    return () => {
      loadEpochRef.current += 1;
      flowEpochRef.current += 1;
      verifyAbortRef.current?.abort();
      verifyAbortRef.current = null;
      printAbortRef.current?.abort();
      printAbortRef.current = null;
      printArmedRef.current = null;
      printPermitRef.current = null;
    };
  }, [blockPdfNow, routeKey]);

  useEffect(() => {
    if (!printPermit) return;
    const expiresAtMs = Date.parse(printPermit.expiresAt);
    const delay = expiresAtMs - Date.now();
    if (!Number.isFinite(expiresAtMs) || delay <= 0) {
      blockPdfNow("출력 허가 토큰이 만료되어 고객 문서 본문을 다시 차단했습니다.");
      return;
    }
    const timer = window.setTimeout(() => {
      blockPdfNow("출력 허가 토큰이 만료되어 고객 문서 본문을 다시 차단했습니다.");
    }, delay);
    return () => window.clearTimeout(timer);
  }, [blockPdfNow, printPermit]);

  useEffect(() => {
    if (!client) return;
    const requestedRouteKey = routeKey;
    const requestedEpoch = ++flowEpochRef.current;
    verifyAbortRef.current?.abort();
    const controller = new AbortController();
    verifyAbortRef.current = controller;
    const isCurrentRequest = () =>
      !controller.signal.aborted &&
      flowEpochRef.current === requestedEpoch &&
      routeKeyRef.current === requestedRouteKey &&
      clientRef.current?.id === clientId;
    const failVerification = (reason: string) => {
      if (!isCurrentRequest()) return;
      document.body.classList.add("pb-pdf-print-blocked");
      printArmedRef.current = null;
      replacePrintPermit(null);
      setPrintBusy(false);
      setPdfBlocked(true);
      setPdfReason(reason);
    };

    if (client.id !== clientId || client.assignedPbId !== pbId || assignedPb?.id !== pbId) {
      failVerification("최종 PDF 비활성: 현재 고객과 담당 PB 경로가 일치하지 않습니다.");
      return () => controller.abort();
    }
    const bundle = isIpsWorkflowApproved(client)
      ? (() => {
          const current = loadBundle(clientId);
          if (canIssueClientPdf(current)) return current;
          return syncEvidenceAfterIpsApproval(client);
        })()
      : loadBundle(clientId);
    if (!canIssueClientPdf(bundle)) {
      failVerification(pdfBlockReason(bundle));
      return () => controller.abort();
    }

    document.body.classList.add("pb-pdf-print-blocked");
    printArmedRef.current = null;
    replacePrintPermit(null);
    setPrintBusy(false);
    setPdfBlocked(true);
    setPdfReason("최신 상담 내용과 문서 발행 조건을 확인하고 있습니다.");
    const verify = async () => {
      try {
        const ids = { clientId, pbId, evidenceId: bundle.id };
        const registerRes = await fetch("/api/advisory/local-self-consistency", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...ids,
            bundle,
          }),
          signal: controller.signal,
        });
        const registration = await registerRes.json();
        if (!isCurrentRequest()) return;
        if (!registerRes.ok || !registration.ok || !registration.registered) {
          failVerification(
            `최종 PDF 비활성: ${registration.reasons?.[0] || registration.error || "서버 원본 보존 실패"}`,
          );
          return;
        }

        const res = await fetch("/api/advisory/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(ids),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!isCurrentRequest()) return;
        const snapshotClient = data.clientSnapshot as Client | undefined;
        const snapshotPb = data.pbSnapshot as Pick<PB, "id" | "name"> | undefined;
        const evidenceSnapshot = data.evidenceSnapshot as EvidenceBundle | undefined;
        const verifiedInputHash = typeof data.verifiedInputHash === "string" ? data.verifiedInputHash : "";
        const evidenceDigest = typeof data.evidenceDigest === "string" ? data.evidenceDigest : "";
        if (
          !res.ok ||
          !data.ok ||
          !data.verified ||
          !data.printToken ||
          !data.expiresAt ||
          !verifiedInputHash ||
          !/^[a-f0-9]{64}$/i.test(evidenceDigest) ||
          data.clientId !== clientId ||
          data.pbId !== pbId ||
          data.evidenceId !== bundle.id ||
          !snapshotClient ||
          snapshotClient.id !== clientId ||
          snapshotClient.assignedPbId !== pbId ||
          !snapshotPb ||
          snapshotPb.id !== pbId ||
          !snapshotPb.name ||
          !evidenceSnapshot ||
          evidenceSnapshot.id !== bundle.id ||
          evidenceSnapshot.clientId !== clientId
        ) {
          failVerification(`최종 PDF 비활성: ${data.reasons?.[0] || data.error || "문서 발행 조건 확인 실패"}`);
          return;
        }

        const localInputHash = advisoryInputHash(client, { assignedPbDisplay: pbDisplay });
        const snapshotInputHash = advisoryInputHash(snapshotClient, {
          assignedPbDisplay: snapshotPb.name,
        });
        if (
          bundle.inputHash !== verifiedInputHash ||
          evidenceSnapshot.inputHash !== verifiedInputHash ||
          stableJsonStringify(bundle) !== stableJsonStringify(evidenceSnapshot) ||
          localInputHash !== verifiedInputHash ||
          snapshotInputHash !== verifiedInputHash ||
          pbDisplay !== snapshotPb.name
        ) {
          failVerification("최종 PDF 비활성: 화면 고객·담당 PB와 서버 검증 스냅샷이 일치하지 않습니다.");
          return;
        }

        const nextPermit: VerifiedPrintPermit = {
          token: data.printToken,
          clientId,
          pbId,
          evidenceId: bundle.id,
          verifiedInputHash,
          evidenceDigest,
          expiresAt: data.expiresAt,
          mode: data.mode === "authoritative" ? "authoritative" : "local-self-consistency",
          clientSnapshot: snapshotClient,
          pbSnapshot: snapshotPb,
          evidenceSnapshot,
        };
        replacePrintPermit(nextPermit);
        if (!isCurrentRequest() || !verifiedEvidenceIsCurrent(nextPermit)) {
          failVerification("최종 PDF 비활성: 검증 직후 고객·상담 현재본이 변경되었습니다.");
          return;
        }
        setPdfBlocked(false);
        setPdfReason("");
      } catch (error) {
        if (controller.signal.aborted || !isCurrentRequest()) return;
        failVerification(
          error instanceof Error && error.name === "AbortError"
            ? "최종 PDF 비활성: 검증 요청이 취소되었습니다."
            : "최종 PDF 비활성: 문서 발행 조건 확인 서비스에 연결할 수 없습니다.",
        );
      }
    };
    void verify();
    return () => {
      controller.abort();
      if (verifyAbortRef.current === controller) verifyAbortRef.current = null;
    };
  }, [
    assignedPb?.id,
    client,
    clientId,
    evidenceRevision,
    pbDisplay,
    pbId,
    replacePrintPermit,
    routeKey,
    verifiedEvidenceIsCurrent,
  ]);

  useEffect(() => {
    const currentEvidenceStorageKey = `pb-advisory-evidence-current-v2:${encodeURIComponent(clientId)}`;
    const invalidateEvidence = () => {
      blockPdfNow("상담 현재본이 변경되어 고객 문서를 즉시 차단하고 다시 확인합니다.");
      setEvidenceRevision((revision) => revision + 1);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null) {
        blockPdfNow("로컬 원본 저장소가 변경되어 고객 문서를 즉시 차단하고 다시 검증합니다.");
        void load().finally(() => setEvidenceRevision((revision) => revision + 1));
        return;
      }
      if (
        event.key === "pb-advisory-evidence-v1" ||
        event.key === currentEvidenceStorageKey
      ) {
        invalidateEvidence();
        return;
      }
      if (event.key === "pb-app-local-db") {
        blockPdfNow("고객 또는 담당 PB 원본이 변경되어 고객 문서를 즉시 차단하고 다시 검증합니다.");
        void load().finally(() => setEvidenceRevision((revision) => revision + 1));
      }
    };

    window.addEventListener("pb-evidence-updated", invalidateEvidence);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("pb-evidence-updated", invalidateEvidence);
      window.removeEventListener("storage", handleStorage);
    };
  }, [blockPdfNow, clientId, load]);

  useEffect(() => {
    const className = "pb-pdf-print-blocked";
    if (pdfBlocked) document.body.classList.add(className);
    else document.body.classList.remove(className);
    return () => {
      document.body.classList.remove(className);
    };
  }, [pdfBlocked]);

  useEffect(() => {
    const blockStalePrint = () => {
      blockPdfNow("상담 현재본 확인이 유효하지 않아 고객 문서 인쇄를 차단했습니다.");
    };
    const preventPrintShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "p") return;
      const armed = printArmedRef.current;
      const permit = printPermitRef.current;
      if (
        armed &&
        permit &&
        armed.routeKey === routeKeyRef.current &&
        armed.permitKey === printPermitKey(permit) &&
        verifiedEvidenceIsCurrent(permit)
      ) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      blockPdfNow("출력 허가 토큰은 ‘인쇄 / PDF로 저장’ 버튼에서만 1회 사용할 수 있습니다.");
    };
    const guardBrowserPrint = () => {
      const armed = printArmedRef.current;
      const permit = printPermitRef.current;
      if (
        !armed ||
        !permit ||
        armed.routeKey !== routeKeyRef.current ||
        armed.permitKey !== printPermitKey(permit) ||
        !verifiedEvidenceIsCurrent(permit)
      ) blockStalePrint();
    };
    const finishPrint = () => {
      const armed = printArmedRef.current;
      if (!armed) return;
      if (armed.routeKey !== routeKeyRef.current) {
        printArmedRef.current = null;
        return;
      }
      blockPdfNow("1회용 출력 허가 토큰을 사용했습니다. 다시 검증한 뒤 출력할 수 있습니다.");
      setEvidenceRevision((revision) => revision + 1);
    };

    window.addEventListener("keydown", preventPrintShortcut, true);
    window.addEventListener("beforeprint", guardBrowserPrint);
    window.addEventListener("afterprint", finishPrint);
    return () => {
      window.removeEventListener("keydown", preventPrintShortcut, true);
      window.removeEventListener("beforeprint", guardBrowserPrint);
      window.removeEventListener("afterprint", finishPrint);
    };
  }, [blockPdfNow, verifiedEvidenceIsCurrent]);

  const printWithOneUsePermit = useCallback(async () => {
    if (printAbortRef.current) return;
    const permit = printPermitRef.current;
    const requestedRouteKey = routeKeyRef.current;
    const requestedEpoch = flowEpochRef.current;
    const requestedPermitKey = permit ? printPermitKey(permit) : "";
    const latest = permit ? loadBundle(permit.clientId) : null;
    if (
      !permit ||
      !latest ||
      latest.id !== permit.evidenceId ||
      !verifiedEvidenceIsCurrent(permit)
    ) {
      blockPdfNow("출력 허가 토큰이 만료되었거나 상담 현재본과 일치하지 않습니다.");
      setEvidenceRevision((revision) => revision + 1);
      return;
    }

    const controller = new AbortController();
    printAbortRef.current = controller;
    setPrintBusy(true);
    const isCurrentAttempt = () => {
      const currentPermit = printPermitRef.current;
      return (
        !controller.signal.aborted &&
        isSamePrintAttempt(
          {
            epoch: requestedEpoch,
            routeKey: requestedRouteKey,
            permitKey: requestedPermitKey,
          },
          {
            epoch: flowEpochRef.current,
            routeKey: routeKeyRef.current,
            permitKey: currentPermit ? printPermitKey(currentPermit) : "",
          },
        )
      );
    };
    try {
      const res = await fetch("/api/advisory/verify", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId: permit.clientId,
          pbId: permit.pbId,
          evidenceId: permit.evidenceId,
          printToken: permit.token,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!isCurrentAttempt()) return;
      if (
        !res.ok ||
        !data.ok ||
        !data.permitted ||
        data.clientId !== permit.clientId ||
        data.pbId !== permit.pbId ||
        data.evidenceId !== permit.evidenceId ||
        data.verifiedInputHash !== permit.verifiedInputHash ||
        data.evidenceDigest !== permit.evidenceDigest
      ) {
        blockPdfNow(
          `출력 차단: ${data.reasons?.[0] || data.error || "1회용 출력 허가 토큰 검증에 실패했습니다."}`,
        );
        setEvidenceRevision((revision) => revision + 1);
        return;
      }
      if (!isCurrentAttempt() || !verifiedEvidenceIsCurrent(permit)) {
        blockPdfNow("출력 차단: 토큰 소비 중 고객·담당 PB·상담 현재본이 변경되었습니다.");
        setEvidenceRevision((revision) => revision + 1);
        return;
      }

      printArmedRef.current = {
        routeKey: requestedRouteKey,
        permitKey: requestedPermitKey,
      };
      try {
        if (!isCurrentAttempt() || !verifiedEvidenceIsCurrent(permit)) {
          printArmedRef.current = null;
          blockPdfNow("출력 차단: 인쇄 직전 고객·담당 PB·상담 현재본이 변경되었습니다.");
          setEvidenceRevision((revision) => revision + 1);
          return;
        }
        // 글꼴·차트 렌더가 끝난 뒤 인쇄 (잘림·빈 차트 방지)
        try {
          if (typeof document !== "undefined" && document.fonts?.ready) {
            await document.fonts.ready;
          }
        } catch {
          /* ignore */
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (!isCurrentAttempt() || !verifiedEvidenceIsCurrent(permit)) {
          printArmedRef.current = null;
          blockPdfNow("출력 차단: 인쇄 직전 고객·담당 PB·상담 현재본이 변경되었습니다.");
          setEvidenceRevision((revision) => revision + 1);
          return;
        }
        window.print();
      } finally {
        const armed = printArmedRef.current;
        if (
          armed &&
          armed.routeKey === requestedRouteKey &&
          armed.permitKey === requestedPermitKey &&
          routeKeyRef.current === requestedRouteKey
        ) {
          blockPdfNow("1회용 출력 허가 토큰을 사용했습니다. 다시 검증한 뒤 출력할 수 있습니다.");
          setEvidenceRevision((revision) => revision + 1);
        } else if (armed?.permitKey === requestedPermitKey) {
          printArmedRef.current = null;
        }
      }
    } catch (error) {
      if (controller.signal.aborted || !isCurrentAttempt()) return;
      blockPdfNow("출력 차단: 1회용 출력 허가 토큰 서비스에 연결할 수 없습니다.");
      setEvidenceRevision((revision) => revision + 1);
    } finally {
      const ownsController = printAbortRef.current === controller;
      if (ownsController) printAbortRef.current = null;
      if (ownsController && routeKeyRef.current === requestedRouteKey) setPrintBusy(false);
    }
  }, [blockPdfNow, verifiedEvidenceIsCurrent]);

  if (status === "loading") return <LoadingView />;
  if (status === "error" || !client)
    return <ErrorView message="고객 정보를 불러올 수 없습니다." onRetry={load} />;

  const canShowFinalDocument =
    !isDraftPreview &&
    !pdfBlocked &&
    !!printPermit &&
    client.id === clientId &&
    verifiedEvidenceIsCurrent(printPermit);

  if (!isDraftPreview && !canShowFinalDocument) {
    return (
      <div className="pdf-output-gate mx-auto max-w-3xl">
        <div className="mb-4 print:hidden">
          <button
            type="button"
            className="btn-outline text-sm"
            onClick={() => router.push(`/pb/${pbId}/${clientId}?view=analysis&tab=ips`)}
          >
            ← IPS 탭으로
          </button>
        </div>
        <section
          className="rounded-xl border-2 border-red-300 bg-white p-5 shadow-card sm:p-8"
          role="alert"
          aria-labelledby="pdf-output-gate-title"
        >
          <span className="inline-flex rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">
            고객 문서 출력 차단
          </span>
          <h1 id="pdf-output-gate-title" className="mt-4 text-xl font-bold text-fg">
            검증 전에는 PDF 본문을 표시하지 않습니다
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">{pdfReason}</p>
          <p className="mt-3 rounded-lg bg-[#F0F3FA] p-3 text-xs leading-relaxed text-fg">
            최종 고객용 PDF 발행 화면입니다. 초안 검토는 IPS 탭의 「IPS 초안 미리보기」를 이용해 주세요.
          </p>
          <button
            type="button"
            className="btn-outline mt-4 text-sm"
            onClick={() => router.push(`/pb/${pbId}/${clientId}/ips?mode=draft`)}
          >
            IPS 초안 미리보기로 이동
          </button>
        </section>
      </div>
    );
  }

  const documentClient = isDraftPreview ? client : printPermit!.clientSnapshot;
  const documentPbDisplay = isDraftPreview ? pbDisplay : printPermit!.pbSnapshot.name;
  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;

  return (
    <div className="mx-auto max-w-3xl print:max-w-none">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <button
          className="btn-outline text-sm"
          onClick={() => router.push(`/pb/${pbId}/${clientId}?view=analysis&tab=ips`)}
        >
          ← IPS 탭으로
        </button>
        <button
          className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isDraftPreview || pdfBlocked || printBusy}
          onClick={() => void printWithOneUsePermit()}
          aria-busy={printBusy}
        >
          {isDraftPreview
            ? "초안 — 인쇄 비활성"
            : pdfBlocked
              ? "최종 PDF 비활성"
              : printBusy
                ? "출력 허가 확인 중…"
                : "🖨️ 인쇄 / PDF로 저장"}
        </button>
      </div>
      {isDraftPreview && (
        <div className="mb-3 rounded-lg border border-[#DCE4F5] bg-[#F0F3FA] px-4 py-3 print:hidden">
          <p className="text-sm font-bold text-[#1428A0]">IPS 초안 미리보기</p>
          <p className="mt-0.5 text-xs text-fg-muted">최종 PDF 발행 전 검토용 화면입니다.</p>
        </div>
      )}
      {!isDraftPreview && printPermit?.mode === "local-self-consistency" && (
        <p className="mb-3 rounded-lg border border-[#DCE4F5] bg-[#F0F3FA] px-3 py-2 text-xs font-semibold text-[#1428A0] print:hidden">
          로컬 자기일치 데모 · 운영 서버 검증이 아닙니다. 출력할 때 30초짜리 1회용 허가를 다시 확인합니다.
        </p>
      )}
      {!isDraftPreview && pdfBlocked && (
        <p className="mb-3 text-xs font-semibold text-red-600 print:hidden">{pdfReason}</p>
      )}

      <IpsA4Document
        documentClient={documentClient}
        documentPbDisplay={documentPbDisplay}
        investableWon={investableWon}
        dateStr={dateStr}
      />
    </div>
  );
}

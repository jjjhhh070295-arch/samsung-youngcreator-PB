"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import readXlsxFile from "read-excel-file/browser";
import {
  ACCOUNT_SEPARATION_LABEL,
  CASH_FLOW_ENTITY_LABEL,
  CLIENT_TYPE_LABEL,
  type AccountSeparation,
  type CashFlow,
  type CashFlowEntity,
  type ClientType,
} from "@/lib/types";
import { cellToText, parseCashflowRows, parseCsvRows, type CashflowUploadResult } from "@/lib/cashflowUpload";
import { isPeriodCashFlow } from "@/lib/periodCashflow";
import { formatKRW, formatKRWShort, parseNumber } from "@/lib/format";
import { EmptyView } from "./StateViews";
import TaxReadinessRubricButton from "./TaxReadinessRubricButton";
import PeriodCashflowAppendix from "./PeriodCashflowAppendix";
import QuickScrollButtons from "./QuickScrollButtons";

interface Props {
  cashFlows: CashFlow[];
  clientType?: ClientType;
  accountSeparation?: AccountSeparation | null;
  linkedClientName?: string | null;
  onSave: (flows: CashFlow[]) => Promise<void> | void;
}

function uid() {
  return "cf-" + Math.random().toString(36).slice(2, 9);
}

const ENTITY_OPTIONS: CashFlowEntity[] = ["personal", "corporate", "sole_business", "mixed"];

const CASHFLOW_TEMPLATE_LINKS = [
  { type: "individual" as const, label: "개인 XLSX", href: "/templates/cashflow/vvip-cashflow-individual.xlsx" },
  { type: "corporate" as const, label: "법인 XLSX", href: "/templates/cashflow/vvip-cashflow-corporate.xlsx" },
  { type: "sole_proprietor" as const, label: "개인사업자 XLSX", href: "/templates/cashflow/vvip-cashflow-sole-proprietor.xlsx" },
  { type: "corporate" as const, label: "법인-대표 연동 XLSX", href: "/templates/cashflow/vvip-cashflow-linked-corporate-rep.xlsx" },
];

const XLSX_UPLOAD_SHEET_ALIASES = ["업로드용_키값", "upload", "keyvalue", "업로드", "키값", "현금흐름표", "기간별현금흐름"];

const normalizeSheetName = (value: string) => value.toLowerCase().replace(/[\s_\-]/g, "");

const DEFAULT_ENTITY: Record<ClientType, CashFlowEntity> = {
  individual: "personal",
  corporate: "corporate",
  sole_proprietor: "sole_business",
};

const CASHFLOW_GUIDES: Record<
  ClientType,
  {
    title: string;
    hint: string;
    warning?: string;
    presets: Array<Pick<CashFlow, "label" | "amount" | "recurring" | "entity" | "accountType" | "category" | "taxAccountingNote">>;
  }
> = {
  individual: {
    title: "개인 현금흐름",
    hint: "급여·생활비·학자금·양도세·개인 배당처럼 가족/생활 이벤트와 세후 현금화 일정을 분리합니다.",
    presets: [
      { label: "급여", amount: 0, recurring: true, entity: "personal", accountType: "개인통장", category: "급여" },
      { label: "생활비", amount: 0, recurring: true, entity: "personal", accountType: "개인통장", category: "생활비" },
      { label: "자녀학자금", amount: 0, recurring: false, entity: "personal", accountType: "CMA", category: "교육비" },
      { label: "양도세 납부 예비", amount: 0, recurring: false, entity: "personal", accountType: "CMA", category: "양도세", taxAccountingNote: "상담용 추정치이며 세무 전문가 확인 필요" },
      { label: "배당(개인)", amount: 0, recurring: false, entity: "personal", accountType: "개인통장", category: "배당" },
    ],
  },
  corporate: {
    title: "법인 현금흐름",
    hint: "운영자금, 법인세, 배당 지급, 급여 지급, CAPEX를 법인 계좌 기준으로 분리합니다.",
    warning: "법인 자금 운용은 내부 승인·회계처리·세무 검토가 필요합니다. 앱의 분류는 상담용 추정입니다.",
    presets: [
      { label: "매출입금", amount: 0, recurring: true, entity: "corporate", accountType: "법인통장", category: "매출" },
      { label: "법인세", amount: 0, recurring: false, entity: "corporate", accountType: "법인 MMF", category: "법인세", taxAccountingNote: "세무 전문가 확인 필요" },
      { label: "배당지급", amount: 0, recurring: false, entity: "corporate", accountType: "법인통장", category: "배당지급" },
      { label: "급여지급", amount: 0, recurring: true, entity: "corporate", accountType: "법인통장", category: "인건비" },
      { label: "운영비", amount: 0, recurring: true, entity: "corporate", accountType: "법인통장", category: "운영비" },
    ],
  },
  sole_proprietor: {
    title: "개인사업자 현금흐름",
    hint: "사업 매출·사업비용·개인 인출·통장 혼용 지출을 나눠 실제 투자 가능 현금을 보수적으로 확인합니다.",
    warning: "사업자통장/개인통장 혼용 시 매출 전체를 가처분 현금으로 보면 안 됩니다.",
    presets: [
      { label: "사업매출", amount: 0, recurring: true, entity: "sole_business", accountType: "사업자통장", category: "사업매출" },
      { label: "사업비용", amount: 0, recurring: true, entity: "sole_business", accountType: "사업자통장", category: "사업비용" },
      { label: "개인인출", amount: 0, recurring: true, entity: "mixed", accountType: "사업자통장", category: "개인인출" },
      { label: "통장혼용지출", amount: 0, recurring: true, entity: "mixed", accountType: "혼용계좌", category: "생활비/사업비 혼용", taxAccountingNote: "비용처리 확정 아님. 세무 전문가 확인 필요" },
      { label: "부가세/종합소득세 예비", amount: 0, recurring: false, entity: "sole_business", accountType: "세금 예치 CMA", category: "세금", taxAccountingNote: "상담용 추정치이며 세무 전문가 확인 필요" },
    ],
  },
};

// 현금흐름 입력 (포트폴리오 산출 입력값). 추가/수정/삭제 후 [저장].
export default function CashFlowEditor({
  cashFlows,
  clientType = "individual",
  accountSeparation,
  linkedClientName,
  onSave,
}: Props) {
  const [rows, setRows] = useState<CashFlow[]>(cashFlows);
  const [uploadResult, setUploadResult] = useState<CashflowUploadResult | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const guide = CASHFLOW_GUIDES[clientType];
  const defaultEntity = DEFAULT_ENTITY[clientType];
  const hasMixedAccountRisk = clientType === "sole_proprietor" && accountSeparation !== "separated";
  const hasLinkedWarning = Boolean(linkedClientName);
  const cashflowTopRef = useRef<HTMLDivElement | null>(null);
  const cashflowBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setRows(cashFlows);
    setDirty(false);
  }, [cashFlows]);

  const mutate = (next: CashFlow[]) => {
    setRows(next);
    setDirty(true);
  };

  const blankRow = (patch: Partial<CashFlow> = {}): CashFlow => ({
    id: uid(),
    label: "",
    amount: 0,
    date: "",
    recurring: false,
    entity: defaultEntity,
    accountType: "",
    category: "",
    taxAccountingNote: "",
    ...patch,
  });

  const add = () =>
    mutate([
      ...rows,
      blankRow(),
    ]);

  const addPreset = (preset: (typeof guide.presets)[number]) =>
    mutate([
      ...rows,
      blankRow({
        ...preset,
        amount:
          preset.amount === 0 && /비용|지출|세|생활비|운영비|인건비|배당지급|인출/i.test(preset.label)
            ? 0
            : preset.amount,
        date: new Date().toISOString().slice(0, 7),
      }),
    ]);

  const update = (id: string, patch: Partial<CashFlow>) =>
    mutate(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (id: string) => mutate(rows.filter((r) => r.id !== id));

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadError("");

    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let parsedRows: string[][];

      if (ext === "csv" || ext === "tsv") {
        parsedRows = parseCsvRows(await file.text());
      } else if (ext === "xlsx") {
        const sheets = await readXlsxFile(file);
        const availableSheets = sheets.map((sheet) => sheet.sheet).join(", ");
        const aliasSet = XLSX_UPLOAD_SHEET_ALIASES.map(normalizeSheetName);
        const prioritizedSheets = [
          ...sheets.filter((sheet) => aliasSet.some((alias) => normalizeSheetName(sheet.sheet).includes(alias))),
          ...sheets.filter((sheet) => !aliasSet.some((alias) => normalizeSheetName(sheet.sheet).includes(alias))),
        ];

        const parsedSheets = prioritizedSheets.map((sheet) => {
          const candidateRows = sheet.data.map((row) => row.map(cellToText));
          const candidate = parseCashflowRows(candidateRows, `${file.name} · ${sheet.sheet}`);
          return { sheetName: sheet.sheet, parsed: candidate };
        });
        const primary = parsedSheets.find(
          (item) => item.parsed.summary.matchedRows > 0 && !normalizeSheetName(item.sheetName).includes("기간별"),
        );
        const periodFlows = parsedSheets.flatMap((item) =>
          item.parsed.cashFlows.filter((flow) => isPeriodCashFlow(flow)),
        );

        let parsed: CashflowUploadResult | null = null;
        if (primary) {
          const existingPeriodIds = new Set(primary.parsed.cashFlows.filter(isPeriodCashFlow).map((flow) => flow.id));
          const additionalPeriodFlows = periodFlows.filter((flow) => !existingPeriodIds.has(flow.id));
          parsed = {
            ...primary.parsed,
            summary: {
              ...primary.parsed.summary,
              matchedRows: primary.parsed.summary.matchedRows + additionalPeriodFlows.length,
            },
            cashFlows: [...primary.parsed.cashFlows, ...additionalPeriodFlows],
          };
        } else if (periodFlows.length > 0) {
          parsed = {
            summary: {
              fileName: `${file.name} · 부록_기간별현금흐름`,
              matchedRows: periodFlows.length,
              monthlyIncomeWon: 0,
              monthlyOutflowWon: 0,
              annualTaxWon: 0,
              currentCashWon: 0,
              nextTaxNeedWon: 0,
              liquidityCoveragePct: 999,
            },
            cashFlows: periodFlows,
            taxEvents: [],
            unmatchedLabels: [],
          };
        }

        if (!parsed) {
          throw new Error(
            `업로드 가능한 표를 찾지 못했습니다. 사용 가능한 시트: ${availableSheets || "없음"}. ` +
              "권장 시트명은 '업로드용_키값' 또는 '부록_기간별현금흐름'입니다.",
          );
        }

        const parsedWithSheet = parsed;
        setRows(
          parsedWithSheet.cashFlows.map((flow) => ({
            ...flow,
            entity: flow.entity ?? defaultEntity,
          })),
        );
        setUploadResult(parsedWithSheet);
        setDirty(true);
        return;
      } else {
        throw new Error("CSV 또는 XLSX 파일만 업로드할 수 있습니다.");
      }

      const parsed = parseCashflowRows(parsedRows, file.name);
      if (parsed.summary.matchedRows === 0) {
        throw new Error("항목/금액 구조를 찾지 못했습니다. 업로드용 표의 헤더를 확인해주세요.");
      }

      setRows(
        parsed.cashFlows.map((flow) => ({
          ...flow,
          entity: flow.entity ?? defaultEntity,
        })),
      );
      setUploadResult(parsed);
      setDirty(true);
    } catch (error) {
      setUploadResult(null);
      setUploadError(error instanceof Error ? error.message : "파일을 읽는 중 문제가 발생했습니다.");
    } finally {
      setUploading(false);
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = "";
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(rows);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const entityTotals = useMemo(
    () =>
      rows.reduce<Record<string, number>>((acc, row) => {
        const key = row.entity ?? defaultEntity;
        acc[key] = (acc[key] ?? 0) + (row.amount || 0);
        return acc;
      }, {}),
    [defaultEntity, rows],
  );
  const scrollToCashflowTop = () => cashflowTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const scrollToCashflowBottom = () => cashflowBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });

  return (
    <div>
      <QuickScrollButtons topRef={cashflowTopRef} bottomRef={cashflowBottomRef} />

      <div ref={cashflowTopRef} className="mb-3 flex justify-center">
        <button
          type="button"
          className="btn-outline text-sm"
          aria-label="현금흐름표 맨 아래로 이동"
          onClick={scrollToCashflowBottom}
        >
          현금흐름표 맨 아래로 이동 ↓
        </button>
      </div>

      <div className="mb-4 rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-fg">
              {CLIENT_TYPE_LABEL[clientType]} · {guide.title}
            </p>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-fg-muted">{guide.hint}</p>
            {(guide.warning || hasMixedAccountRisk || hasLinkedWarning) && (
              <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-gold-700 dark:text-gold-200">
                {guide.warning && <p>• {guide.warning}</p>}
                {hasMixedAccountRisk && (
                  <p>
                    • 통장 분리 상태가 {ACCOUNT_SEPARATION_LABEL[accountSeparation ?? "unknown"]}입니다.
                    사업자금과 개인 생활비를 분리 확인하기 전까지 투자 가능 현금은 보수적으로 봅니다.
                  </p>
                )}
                {hasLinkedWarning && (
                  <p>
                    • 연동 고객 {linkedClientName}의 현금흐름과 중복 입력될 수 있습니다. “법인 배당 지급”과
                    “개인 배당 유입”은 메모에 같은 기준월을 남겨 중복 반영을 점검하세요.
                  </p>
                )}
              </div>
            )}
          </div>
          {rows.length > 0 && (
            <div className="min-w-[180px] rounded-lg bg-surface-2 p-3 text-xs text-fg-muted">
              <p className="font-semibold text-fg">자금주체별 순합계</p>
              {Object.entries(entityTotals).map(([entity, amount]) => (
                <p key={entity} className="mt-1 flex justify-between gap-3">
                  <span>{CASH_FLOW_ENTITY_LABEL[entity as CashFlowEntity] ?? entity}</span>
                  <b className={amount < 0 ? "text-red-500" : "text-gold-600 dark:text-gold-300"}>
                    {formatKRWShort(amount)}
                  </b>
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {guide.presets.map((preset) => (
            <button
              key={`${preset.label}-${preset.entity}`}
              className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-fg-muted transition-colors hover:border-gold-400 hover:text-gold-700"
              onClick={() => addPreset(preset)}
            >
              + {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card mb-4 overflow-hidden">
        <div className="grid grid-cols-1 gap-0 lg:grid-cols-[320px_1fr]">
          <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
            <p className="text-sm font-bold text-fg">현금흐름표 업로드</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">
              엑셀/CSV의 <b>항목 · 값(만원) · 납부일 · 분류</b> 표를 읽어 현금흐름과
              세금 납부 일정을 자동 생성합니다.
            </p>
            <label className="btn-gold mt-3 w-full cursor-pointer text-sm">
              {uploading ? "파일 읽는 중…" : "CSV/XLSX 파일 선택"}
              <input
                type="file"
                accept=".csv,.tsv,.xlsx"
                className="sr-only"
                onChange={onFileChange}
                disabled={uploading}
              />
            </label>
            <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-[11px] font-bold text-fg">Google Sheets용 XLSX 양식</p>
              <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                내려받은 XLSX를 Google Sheets에서 열어 작성하세요. 앱은 <b>업로드용_키값</b>과{" "}
                <b>부록_기간별현금흐름</b> 시트를 함께 읽어 세금 일정과 월별 추이를 만듭니다.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CASHFLOW_TEMPLATE_LINKS.map((template) => {
                  const highlighted =
                    template.type === clientType ||
                    (template.label.includes("연동") && Boolean(linkedClientName));
                  return (
                    <a
                      key={template.href}
                      href={template.href}
                      download
                      className={`rounded-md border px-2 py-1 text-[10px] font-bold transition-colors ${
                        highlighted
                          ? "border-gold-300 bg-gold-50 text-gold-800 dark:bg-gold-900/20 dark:text-gold-200"
                          : "border-border bg-surface text-fg-muted hover:border-gold-300 hover:text-gold-700"
                      }`}
                    >
                      {template.label}
                    </a>
                  );
                })}
              </div>
            </div>
            {uploadResult && (
              <p className="mt-2 text-[11px] text-fg-muted">
                {uploadResult.summary.fileName} · {uploadResult.summary.matchedRows}개 항목 매칭
              </p>
            )}
            {uploadError && (
              <p className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-200">
                {uploadError}
              </p>
            )}
          </div>

          <div className="p-4">
            {uploadResult ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <UploadMetric label="월 소득" value={formatKRWShort(uploadResult.summary.monthlyIncomeWon)} />
                  <UploadMetric label="월 유출" value={formatKRWShort(uploadResult.summary.monthlyOutflowWon)} danger />
                  <UploadMetric label="현재 현금" value={formatKRWShort(uploadResult.summary.currentCashWon)} />
                  <UploadMetric
                    label="세금 커버"
                    value={`${uploadResult.summary.liquidityCoveragePct}%`}
                    danger={uploadResult.summary.liquidityCoveragePct < 100}
                  />
                </div>
                <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-muted">
                  {uploadResult.summary.nearestEvent ? (
                    <>
                      다음 현금화:{" "}
                      <b className="text-fg">
                        {uploadResult.summary.nearestEvent.cashReadyDate} ·{" "}
                        {uploadResult.summary.nearestEvent.label}{" "}
                        {formatKRWShort(uploadResult.summary.nearestEvent.amountWon)}
                      </b>
                    </>
                  ) : (
                    "예정 세금 이벤트가 없어요."
                  )}
                </div>
                {uploadResult.taxEvents.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold text-fg">세금 납부 준비상태</p>
                      <TaxReadinessRubricButton label="준비상태 기준표" />
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {uploadResult.taxEvents.slice(0, 4).map((event) => (
                        <div key={event.id} className="rounded-lg border border-border bg-surface-2 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-semibold text-fg">{event.label}</p>
                              <p className="mt-0.5 text-[11px] text-fg-muted">
                                현금화 {event.cashReadyDate} · 납부 {event.dueDate}
                              </p>
                            </div>
                            <span
                              className={`badge ${
                                event.status === "covered"
                                  ? "bg-green-100 text-green-700"
                                  : event.status === "watch"
                                    ? "bg-gold-100 text-gold-800"
                                    : "bg-red-100 text-red-700"
                              }`}
                            >
                              {event.readiness.label}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-bold text-gold-600 dark:text-gold-300">
                            {formatKRW(event.amountWon)}
                          </p>
                          <p className="mt-1 text-[11px] font-medium text-fg">{event.readiness.reason}</p>
                          <p className="mt-1 text-[11px] text-fg-muted">{event.rule}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full min-h-[150px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-2 p-6 text-center">
                <p className="text-sm font-semibold text-fg">엑셀만 넣으면 자동 생성</p>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-fg-muted">
                  고액자산가 세금 납부일, 증여세·상속세·양도세 현금화 목표일을 계산해
                  포트폴리오 입력값으로 변환합니다.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyView
          title="등록된 현금흐름이 없어요"
          hint="급여·주택구입·학자금 등 예상 유입/유출을 추가하세요. 포트폴리오 산출 입력값입니다."
          action={
            <button className="btn-gold text-sm" onClick={add}>
              + 현금흐름 추가
            </button>
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2 text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2 text-left">자금주체</th>
                <th className="px-3 py-2 text-left">항목 / 카테고리</th>
                <th className="px-3 py-2 text-left">계좌유형</th>
                <th className="px-3 py-2 text-right">금액 (원, 유출은 음수)</th>
                <th className="px-3 py-2 text-left">시점</th>
                <th className="px-3 py-2 text-center">정기</th>
                <th className="px-3 py-2 text-left">세무·회계 메모</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="min-w-[120px] px-3 py-2">
                    <select
                      className="input"
                      value={r.entity ?? defaultEntity}
                      onChange={(e) => update(r.id, { entity: e.target.value as CashFlowEntity })}
                    >
                      {ENTITY_OPTIONS.map((entity) => (
                        <option key={entity} value={entity}>
                          {CASH_FLOW_ENTITY_LABEL[entity]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="input"
                      value={r.label}
                      placeholder="예: 급여"
                      onChange={(e) => update(r.id, { label: e.target.value })}
                    />
                    <input
                      className="input mt-1"
                      value={r.category ?? ""}
                      placeholder="예: 법인세, 생활비, 사업비용"
                      onChange={(e) => update(r.id, { category: e.target.value })}
                    />
                  </td>
                  <td className="min-w-[140px] px-3 py-2">
                    <input
                      className="input"
                      value={r.accountType ?? ""}
                      placeholder="예: CMA, 법인 MMF"
                      onChange={(e) => update(r.id, { accountType: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="input text-right"
                      inputMode="numeric"
                      value={r.amount || ""}
                      placeholder="0"
                      onChange={(e) => update(r.id, { amount: parseNumber(e.target.value) })}
                    />
                    <p
                      className={`mt-0.5 text-right text-[11px] ${
                        r.amount < 0 ? "text-red-500" : "text-gold-600 dark:text-gold-300"
                      }`}
                    >
                      {r.amount ? formatKRW(r.amount) : "—"}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="month"
                      className="input"
                      value={r.date}
                      onChange={(e) => update(r.id, { date: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      className="accent-gold-500"
                      checked={r.recurring}
                      onChange={(e) => update(r.id, { recurring: e.target.checked })}
                    />
                  </td>
                  <td className="min-w-[180px] px-3 py-2">
                    <textarea
                      className="input min-h-[68px]"
                      value={r.taxAccountingNote ?? ""}
                      placeholder="상담용 추정, 전문가 확인 필요 등"
                      onChange={(e) => update(r.id, { taxAccountingNote: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      className="btn-ghost h-7 px-2 text-xs text-red-500"
                      onClick={() => remove(r.id)}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PeriodCashflowAppendix cashFlows={rows} />

      {rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button className="btn-outline text-sm" onClick={add}>
            + 현금흐름 추가
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-fg-muted">
              순합계 <b className="text-fg">{formatKRW(total)}</b>
            </span>
            <button className="btn-gold text-sm" onClick={save} disabled={!dirty || saving}>
              {saving ? "저장 중…" : dirty ? "현금흐름 저장" : "저장됨"}
            </button>
          </div>
        </div>
      )}

      <div ref={cashflowBottomRef} className="mt-3 flex justify-center">
        <button
          type="button"
          className="btn-outline text-sm"
          aria-label="현금흐름표 맨 위로 이동"
          onClick={scrollToCashflowTop}
        >
          현금흐름표 맨 위로 이동 ↑
        </button>
      </div>
    </div>
  );
}

function UploadMetric({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <p className="text-[11px] text-fg-muted">{label}</p>
      <p className={`mt-1 text-sm font-bold ${danger ? "text-red-500" : "text-fg"}`}>{value}</p>
    </div>
  );
}

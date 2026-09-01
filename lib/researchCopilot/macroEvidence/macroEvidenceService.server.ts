import { createHash } from "node:crypto";
import {
  calculateKoreaCpiYearOverYear,
  calculateKoreaCreditSpread,
  calculateKoreaRealGdpGrowth,
} from "./koreaCalculations";
import {
  fetchKoreaMacroSeries,
  preserveKoreaMacroRawCapture,
  type FetchKoreaMacroSeriesInput,
  type FetchKoreaMacroSeriesResult,
  type KoreaMacroRawCapture,
} from "./koreaConnector.server";
import {
  KOREA_MACRO_ALLOWLIST,
  type KoreaMacroFrequency,
  type KoreaMacroSeriesId,
} from "./koreaRegistry";
import {
  fetchNyFedRatesEvidence,
  type NyFedConnectorOptions,
  type NyFedConnectorResult,
} from "./nyFedConnector.server";
import { toPublicMacroCaptureManifest } from "./rawCapture.server";
import { MACRO_CONSUMER_POLICY, rightsReviewPlaceholders } from "./sourceRegistry";
import {
  fetchTreasuryYieldEvidence,
  type TreasuryConnectorOptions,
  type TreasuryConnectorResult,
} from "./treasuryConnector.server";
import type {
  MacroDashboardResult,
  MacroDerivedSeriesEvidence,
  MacroObservation,
  MacroSeriesBlocked,
  MacroSeriesEvidence,
  MacroSeriesResult,
  RawMacroCapture,
} from "./types";

type KoreaFetcher = (input: FetchKoreaMacroSeriesInput) => Promise<FetchKoreaMacroSeriesResult>;
type TreasuryFetcher = (options?: TreasuryConnectorOptions) => Promise<TreasuryConnectorResult>;
type NyFedFetcher = (options?: NyFedConnectorOptions) => Promise<NyFedConnectorResult>;

export interface MacroEvidenceServiceOptions {
  ecosCredential: string | undefined;
  now?: () => Date;
  fetchKorea?: KoreaFetcher;
  fetchTreasury?: TreasuryFetcher;
  fetchNyFed?: NyFedFetcher;
}

const KOREA_SERIES_IDS = Object.freeze(Object.keys(KOREA_MACRO_ALLOWLIST) as KoreaMacroSeriesId[]);
const KOREA_SOURCE_URL = "https://ecos.bok.or.kr/api/";

let koreaArchive: readonly KoreaMacroRawCapture[] = [];
let treasuryArchive: readonly RawMacroCapture[] = [];
let nyFedArchive: readonly RawMacroCapture[] = [];

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function ym(date: Date): string {
  return date.toISOString().slice(0, 7).replace("-", "");
}

function quarter(date: Date): string {
  return `${date.getUTCFullYear()}Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

export function koreaRequestWindow(frequency: KoreaMacroFrequency, now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("INVALID_NOW");
  if (frequency === "D") {
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 400);
    return { startPeriod: ymd(start), endPeriod: ymd(now) };
  }
  if (frequency === "M") {
    const start = new Date(Date.UTC(now.getUTCFullYear() - 2, now.getUTCMonth(), 1));
    return { startPeriod: ym(start), endPeriod: ym(now) };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear() - 3, 0, 1));
  return { startPeriod: quarter(start), endPeriod: quarter(now) };
}

function publicCapture(capture: KoreaMacroRawCapture | RawMacroCapture | null | undefined) {
  if (!capture) return null;
  return toPublicMacroCaptureManifest("raw" in capture ? capture.raw : capture);
}

function evidenceById(results: MacroSeriesResult[], seriesId: string): MacroSeriesEvidence | null {
  const result = results.find((candidate) => candidate.seriesId === seriesId);
  return result?.status === "ready" && result.mode === "official-live" ? result : null;
}

function evidenceAt(source: MacroSeriesEvidence, observation: MacroObservation | undefined) {
  if (!observation) return null;
  return { ...source, observations: [observation], latestObservation: observation };
}

function derivedHash(input: Omit<MacroDerivedSeriesEvidence, "contentHash">): string {
  return createHash("sha256").update(JSON.stringify({
    seriesId: input.seriesId,
    formula: input.formula,
    inputSeriesIds: input.inputSeriesIds,
    inputContentHashes: input.inputContentHashes,
    observation: input.latestObservation,
  })).digest("hex");
}

function derivedEvidence(
  input: Omit<MacroDerivedSeriesEvidence, "contentHash">,
): MacroDerivedSeriesEvidence {
  return { ...input, contentHash: derivedHash(input) };
}

function derivedObservation(observationDate: string, observationDateRaw: string, value: number): MacroObservation {
  const rounded = Number(value.toFixed(6));
  return {
    observationDate,
    observationDateRaw,
    valueRaw: String(rounded),
    releaseDate: null,
    vintageDate: null,
    preliminaryFinal: null,
    revisionStatus: null,
    availability: {
      releaseDate: "source_not_provided",
      vintageDate: "source_not_provided",
      preliminaryFinal: "source_not_provided",
      revisionStatus: "source_not_provided",
    },
  };
}

function derivedBlocked(
  seriesId: string,
  title: string,
  message: string,
): MacroSeriesBlocked {
  return {
    status: "blocked",
    seriesId,
    sectionId: seriesId.includes("spread") ? "credit-volatility" : "korea-macro",
    title,
    code: "DATA_MISSING",
    message,
    sourceUrl: KOREA_SOURCE_URL,
    rightsStatus: "pb-internal-use-approved",
  };
}

function koreaDerivedResults(koreaResults: MacroSeriesResult[], nowIso: string): MacroSeriesResult[] {
  const derived: MacroSeriesResult[] = [];
  const benchmark = evidenceById(koreaResults, "ktb-3y");
  for (const creditId of ["corp-aa-minus-3y", "corp-bbb-minus-3y"] as const) {
    const credit = evidenceById(koreaResults, creditId);
    const outputId = `${creditId}-spread` as MacroDerivedSeriesEvidence["seriesId"];
    const title = creditId === "corp-aa-minus-3y"
      ? "회사채 AA- 3년 - 국고채 3년 스프레드"
      : "회사채 BBB- 3년 - 국고채 3년 스프레드";
    if (!credit || !benchmark) {
      derived.push(derivedBlocked(outputId, title, "동일 관측일의 두 공식 금리 중 하나가 차단되어 스프레드를 표시하지 않습니다."));
      continue;
    }
    const calculated = calculateKoreaCreditSpread(credit, benchmark, nowIso);
    if (calculated.status !== "ready") {
      derived.push(derivedBlocked(outputId, title, calculated.issues.map((issue) => issue.message).join(" ")));
      continue;
    }
    const observation = derivedObservation(
      calculated.observationDate,
      calculated.observationDate.replaceAll("-", ""),
      calculated.basisPoints,
    );
    derived.push(derivedEvidence({
      status: "ready",
      mode: "deterministic-derived",
      seriesId: outputId,
      sectionId: "credit-volatility",
      providerId: "ecos",
      provider: "한국은행 경제통계시스템(ECOS) · 결정론 계산",
      title,
      frequency: "D",
      unit: "bp",
      definitionVersion: `${credit.definitionVersion}:minus:${benchmark.definitionVersion}:v1`,
      formula: calculated.formula,
      inputSeriesIds: [credit.seriesId, benchmark.seriesId],
      inputContentHashes: [credit.contentHash, benchmark.contentHash],
      observations: [observation],
      latestObservation: observation,
      sourceUrl: KOREA_SOURCE_URL,
      retrievedAt: credit.retrievedAt,
      rightsStatus: "pb-internal-use-approved",
      isEducationalFixture: false,
    }));
  }

  const gdp = evidenceById(koreaResults, "real-gdp-sa");
  if (gdp) {
    const current = gdp.observations.at(-1);
    const priorQuarter = gdp.observations.at(-2);
    const yearAgo = gdp.observations.at(-5);
    const currentEvidence = evidenceAt(gdp, current);
    const priorEvidence = evidenceAt(gdp, priorQuarter);
    const yearAgoEvidence = evidenceAt(gdp, yearAgo);
    if (currentEvidence && priorEvidence && yearAgoEvidence) {
      const calculated = calculateKoreaRealGdpGrowth(currentEvidence, priorEvidence, yearAgoEvidence, nowIso);
      if (calculated.status === "ready") {
        for (const variant of [
          { seriesId: "real-gdp-sa-qoq" as const, title: "실질 GDP 전분기 대비", value: calculated.qoqPercent },
          { seriesId: "real-gdp-sa-yoy" as const, title: "실질 GDP 전년 동기 대비", value: calculated.yoyPercent },
        ]) {
          const observation = derivedObservation(current!.observationDate, current!.observationDateRaw, variant.value);
          derived.push(derivedEvidence({
            status: "ready",
            mode: "deterministic-derived",
            seriesId: variant.seriesId,
            sectionId: "korea-macro",
            providerId: "ecos",
            provider: "한국은행 경제통계시스템(ECOS) · 결정론 계산",
            title: variant.title,
            frequency: "Q",
            unit: "%",
            definitionVersion: `${gdp.definitionVersion}:${variant.seriesId}:v1`,
            formula: calculated.formula,
            inputSeriesIds: [gdp.seriesId],
            inputContentHashes: [gdp.contentHash],
            observations: [observation],
            latestObservation: observation,
            sourceUrl: KOREA_SOURCE_URL,
            retrievedAt: gdp.retrievedAt,
            rightsStatus: "pb-internal-use-approved",
            isEducationalFixture: false,
          }));
        }
      }
    }
  }

  for (const cpiId of ["cpi-headline", "cpi-core-food-energy-excluded"] as const) {
    const cpi = evidenceById(koreaResults, cpiId);
    if (!cpi) continue;
    const current = cpi.observations.at(-1);
    const yearAgo = cpi.observations.find((observation) => {
      if (!current) return false;
      return observation.observationDate.slice(5, 7) === current.observationDate.slice(5, 7)
        && Number(observation.observationDate.slice(0, 4)) === Number(current.observationDate.slice(0, 4)) - 1;
    });
    const currentEvidence = evidenceAt(cpi, current);
    const yearAgoEvidence = evidenceAt(cpi, yearAgo);
    if (!currentEvidence || !yearAgoEvidence) continue;
    const calculated = calculateKoreaCpiYearOverYear(currentEvidence, yearAgoEvidence, nowIso);
    if (calculated.status !== "ready") continue;
    const seriesId = cpiId === "cpi-headline"
      ? "cpi-headline-yoy"
      : "cpi-core-food-energy-excluded-yoy";
    const observation = derivedObservation(current!.observationDate, current!.observationDateRaw, calculated.yoyPercent);
    derived.push(derivedEvidence({
      status: "ready",
      mode: "deterministic-derived",
      seriesId,
      sectionId: "korea-macro",
      providerId: "ecos",
      provider: "한국은행 경제통계시스템(ECOS) · 결정론 계산",
      title: cpiId === "cpi-headline" ? "소비자물가 전년 동월 대비" : "근원 소비자물가 전년 동월 대비",
      frequency: "M",
      unit: "%",
      definitionVersion: `${cpi.definitionVersion}:yoy:v1`,
      formula: calculated.formula,
      inputSeriesIds: [cpi.seriesId],
      inputContentHashes: [cpi.contentHash],
      observations: [observation],
      latestObservation: observation,
      sourceUrl: KOREA_SOURCE_URL,
      retrievedAt: cpi.retrievedAt,
      rightsStatus: "pb-internal-use-approved",
      isEducationalFixture: false,
    }));
  }
  return derived;
}

export async function loadMacroEvidenceDashboard(
  options: MacroEvidenceServiceOptions,
): Promise<MacroDashboardResult> {
  const now = options.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("INVALID_NOW");
  const retrievedAt = now.toISOString();
  const fetchKorea = options.fetchKorea ?? fetchKoreaMacroSeries;
  const koreaResults: MacroSeriesResult[] = [];
  const currentKoreaCaptures: KoreaMacroRawCapture[] = [];

  for (const seriesId of KOREA_SERIES_IDS) {
    const definition = KOREA_MACRO_ALLOWLIST[seriesId];
    const window = koreaRequestWindow(definition.frequency, now);
    const fetched = await fetchKorea({
      seriesId,
      requestedStartPeriod: window.startPeriod,
      requestedEndPeriod: window.endPeriod,
      credential: options.ecosCredential ?? "",
      retrievedAt,
      nowIso: retrievedAt,
    });
    koreaResults.push(fetched.result);
    if (fetched.capture) {
      const preserved = preserveKoreaMacroRawCapture(koreaArchive, fetched.capture);
      koreaArchive = preserved.archive;
      currentKoreaCaptures.push(preserved.entry);
    }
  }

  const treasury = await (options.fetchTreasury ?? fetchTreasuryYieldEvidence)({ now: () => now, archive: treasuryArchive });
  treasuryArchive = treasury.archive;
  const nyFed = await (options.fetchNyFed ?? fetchNyFedRatesEvidence)({ now: () => now, archive: nyFedArchive });
  nyFedArchive = nyFed.archive;
  const calculated = koreaDerivedResults(koreaResults, retrievedAt);

  const captures = [
    ...currentKoreaCaptures.map(publicCapture),
    publicCapture(treasury.capture),
    publicCapture(nyFed.capture),
  ].filter((capture): capture is NonNullable<typeof capture> => capture !== null);

  return {
    ok: true,
    mode: "official-live-with-blocked-rights-placeholders",
    retrievedAt,
    sections: {
      "korea-macro": [...koreaResults, ...calculated.filter((item) => item.sectionId === "korea-macro")],
      "us-rates": [...treasury.results, ...nyFed.results],
      "credit-volatility": [
        ...calculated.filter((item) => item.sectionId === "credit-volatility"),
        ...rightsReviewPlaceholders(),
      ],
    },
    consumerPolicy: MACRO_CONSUMER_POLICY,
    captures,
  };
}

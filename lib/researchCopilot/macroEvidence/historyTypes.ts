import type {
  MacroConsumerPolicy,
  MacroFailureCode,
  MacroFieldAvailability,
  MacroProviderId,
  MacroRightsStatus,
  MacroSectionId,
  PublicMacroCaptureManifest,
} from "./types";

export const MACRO_TREND_RANGES = [
  "1D",
  "1W",
  "1M",
  "3M",
  "6M",
  "1Y",
  "3Y",
  "5Y",
  "10Y",
  "20Y",
  "30Y",
] as const;

export type MacroTrendRange = (typeof MACRO_TREND_RANGES)[number];

export type MacroTrendDisplayMode = "latest" | "table" | "line";

export interface MacroTrendObservation {
  observationDate: string;
  observationDateRaw: string;
  /** 원문 숫자 문자열입니다. 빈 문자열은 결측이며 0으로 대체하지 않습니다. */
  valueRaw: string;
  releaseDate: string | null;
  vintageDate: string | null;
  preliminaryFinal: string | null;
  revisionStatus: string | null;
  availability: MacroFieldAvailability;
}

export interface MacroTrendCoverage {
  startDate: string;
  endDate: string;
  calendarDaySpan: number;
}

/** 관측 누락을 단정하지 않고, 인접 관측일 사이의 달력상 간격만 보존합니다. */
export interface MacroTrendCalendarGap {
  afterObservationDate: string;
  beforeObservationDate: string;
  calendarDaysBetween: number;
}

export interface MacroTrendReady {
  status: "ready";
  seriesId: string;
  title: string;
  sectionId: MacroSectionId;
  providerId: MacroProviderId;
  provider: string;
  frequency: "D" | "M" | "Q";
  unit: string;
  definitionVersion: string;
  range: MacroTrendRange;
  /** 기간 계산의 기준이 되는 원천 데이터의 최신 관측일입니다. */
  anchorObservationDate: string;
  requestedStartDate: string;
  requestedEndDate: string;
  /** 화면에 반환할 관측치입니다. 480개를 넘지 않으며 합성·보간하지 않습니다. */
  observations: MacroTrendObservation[];
  originalObservationCount: number;
  normalizedObservationCount: number;
  inRangeObservationCount: number;
  validObservationCount: number;
  missingObservationCount: number;
  returnedObservationCount: number;
  displayMode: MacroTrendDisplayMode;
  actualCoverage: MacroTrendCoverage;
  gaps: MacroTrendCalendarGap[];
  sourceUrl: string;
  retrievedAt: string;
  datasetContentHash: string;
  rightsStatus: "pb-internal-use-approved";
  isEducationalFixture: false;
  captures: PublicMacroCaptureManifest[];
}

export type MacroTrendBlockCode =
  | MacroFailureCode
  | "DATA_RIGHTS_REVIEW_REQUIRED"
  | "INVALID_RANGE"
  | "CLIENT_FORBIDDEN"
  | "DEFINITION_MISMATCH"
  | "DATE_MISMATCH";

export interface MacroTrendBlocked {
  status: "blocked";
  seriesId: string;
  title: string;
  sectionId: MacroSectionId;
  range: MacroTrendRange;
  code: MacroTrendBlockCode;
  message: string;
  sourceUrl: string;
  rightsStatus: MacroRightsStatus;
}

export type MacroTrendResult = MacroTrendReady | MacroTrendBlocked;

export interface MacroTrendResponse {
  ok: true;
  pbId: string;
  clientId: string;
  range: MacroTrendRange;
  result: MacroTrendResult;
  consumerPolicy: MacroConsumerPolicy;
}

export interface MacroTrendPreparationReady {
  status: "ready";
  range: MacroTrendRange;
  anchorObservationDate: string;
  requestedStartDate: string;
  requestedEndDate: string;
  normalizedObservations: MacroTrendObservation[];
  inRangeObservations: MacroTrendObservation[];
  observations: MacroTrendObservation[];
  originalObservationCount: number;
  normalizedObservationCount: number;
  inRangeObservationCount: number;
  validObservationCount: number;
  missingObservationCount: number;
  returnedObservationCount: number;
  displayMode: MacroTrendDisplayMode;
  actualCoverage: MacroTrendCoverage;
  gaps: MacroTrendCalendarGap[];
}

export interface MacroTrendPreparationBlocked {
  status: "blocked";
  range: MacroTrendRange;
  code: Extract<
    MacroTrendBlockCode,
    "DATA_MISSING" | "DATA_CONFLICT" | "RESPONSE_INVALID" | "RESPONSE_TOO_LARGE"
  >;
  message: string;
  originalObservationCount: number;
}

export type MacroTrendPreparationResult = MacroTrendPreparationReady | MacroTrendPreparationBlocked;

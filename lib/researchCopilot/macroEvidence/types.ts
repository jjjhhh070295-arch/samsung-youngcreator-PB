export type MacroSectionId = "korea-macro" | "us-rates" | "credit-volatility";

export type MacroProviderId = "ecos" | "us-treasury" | "ny-fed";

export type MacroRightsStatus =
  | "pb-internal-use-approved"
  | "official-source-rights-review-required"
  | "licensed-data-required";

export type SourceAvailability = "provided" | "source_not_provided";

export type MacroFailureCode =
  | "KEY_MISSING"
  | "SERIES_NOT_ALLOWED"
  | "UPSTREAM_UNAVAILABLE"
  | "RESPONSE_INVALID"
  | "RESPONSE_TOO_LARGE"
  | "METADATA_MISMATCH"
  | "DATA_MISSING"
  | "DATA_CONFLICT"
  | "UNIT_MISMATCH"
  | "STALE"
  | "RIGHTS_BLOCKED"
  | "RAW_CONFLICT";

export interface MacroFieldAvailability {
  releaseDate: SourceAvailability;
  vintageDate: SourceAvailability;
  preliminaryFinal: SourceAvailability;
  revisionStatus: SourceAvailability;
}

export interface MacroObservation {
  observationDate: string;
  observationDateRaw: string;
  valueRaw: string;
  releaseDate: string | null;
  vintageDate: string | null;
  preliminaryFinal: string | null;
  revisionStatus: string | null;
  availability: MacroFieldAvailability;
}

export interface MacroSeriesEvidence {
  status: "ready";
  mode: "official-live";
  seriesId: string;
  sectionId: MacroSectionId;
  providerId: MacroProviderId;
  provider: string;
  title: string;
  frequency: "D" | "M" | "Q";
  unit: string;
  definitionVersion: string;
  observations: MacroObservation[];
  latestObservation: MacroObservation;
  sourceUrl: string;
  retrievedAt: string;
  contentHash: string;
  rightsStatus: "pb-internal-use-approved";
  isEducationalFixture: false;
}

export interface MacroDerivedSeriesEvidence {
  status: "ready";
  mode: "deterministic-derived";
  seriesId:
    | "corp-aa-minus-3y-spread"
    | "corp-bbb-minus-3y-spread"
    | "real-gdp-sa-qoq"
    | "real-gdp-sa-yoy"
    | "cpi-headline-yoy"
    | "cpi-core-food-energy-excluded-yoy";
  sectionId: MacroSectionId;
  providerId: "ecos";
  provider: "한국은행 경제통계시스템(ECOS) · 결정론 계산";
  title: string;
  frequency: "D" | "M" | "Q";
  unit: "bp" | "%";
  definitionVersion: string;
  formula: string;
  inputSeriesIds: string[];
  inputContentHashes: string[];
  observations: MacroObservation[];
  latestObservation: MacroObservation;
  sourceUrl: string;
  retrievedAt: string;
  contentHash: string;
  rightsStatus: "pb-internal-use-approved";
  isEducationalFixture: false;
}

export interface MacroSeriesBlocked {
  status: "blocked";
  seriesId: string;
  sectionId: MacroSectionId;
  title: string;
  code: MacroFailureCode | "DATA_RIGHTS_REVIEW_REQUIRED";
  message: string;
  sourceUrl: string;
  rightsStatus: MacroRightsStatus;
}

export type MacroSeriesResult = MacroSeriesEvidence | MacroDerivedSeriesEvidence | MacroSeriesBlocked;

/**
 * 서버 내부 수집 계약입니다. 실제 URL과 인증정보를 넣을 수 없도록 URL/key 필드를
 * 의도적으로 제공하지 않습니다.
 */
export interface SanitizedMacroRequest {
  providerId: MacroProviderId;
  operation: string;
  seriesIds: string[];
  frequency?: "D" | "M" | "Q";
  startDate?: string;
  endDate?: string;
}

export interface RawMacroCapture {
  captureId: string;
  providerId: MacroProviderId;
  /** 수신 바이트의 서버 내부 전용 base64 사본. 공개 응답에는 포함하지 않습니다. */
  rawBase64: string;
  contentHash: string;
  bodyByteLength: number;
  retrievedAt: string;
  responseStatus: number;
  contentType: string;
  sanitizedRequest: SanitizedMacroRequest;
}

export interface PublicMacroCaptureManifest {
  captureId: string;
  providerId: MacroProviderId;
  contentHash: string;
  bodyByteLength: number;
  retrievedAt: string;
  responseStatus: number;
  contentType: string;
  sanitizedRequest: SanitizedMacroRequest;
}

export interface MacroConsumerPolicy {
  pbInternalResearchDisplay: true;
  portfolio: false;
  productRecommendation: false;
  customerOutput: false;
  aiNumericGeneration: false;
}

export interface MacroDashboardResult {
  ok: true;
  mode: "official-live-with-blocked-rights-placeholders";
  retrievedAt: string;
  sections: Record<MacroSectionId, MacroSeriesResult[]>;
  consumerPolicy: MacroConsumerPolicy;
  captures: PublicMacroCaptureManifest[];
}

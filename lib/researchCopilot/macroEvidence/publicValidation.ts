import type {
  MacroDashboardResult,
  MacroDerivedSeriesEvidence,
  MacroObservation,
  MacroSeriesEvidence,
  MacroSeriesResult,
  PublicMacroCaptureManifest,
} from "./types";
import { KOREA_MACRO_ALLOWLIST } from "./koreaRegistry";
import { US_MACRO_ALLOWLIST } from "./usRegistry";

const SECTIONS = ["korea-macro", "us-rates", "credit-volatility"] as const;
const RIGHTS = [
  "pb-internal-use-approved",
  "official-source-rights-review-required",
  "licensed-data-required",
] as const;

const DERIVED_DEFINITIONS: Record<MacroDerivedSeriesEvidence["seriesId"], {
  sectionId: string;
  unit: "bp" | "%";
  frequency: "D" | "M" | "Q";
  formula: string;
  inputSeriesIds: string[];
}> = {
  "corp-aa-minus-3y-spread": {
    sectionId: "credit-volatility",
    unit: "bp",
    frequency: "D",
    formula: "(credit yield - KTB 3Y yield) * 100",
    inputSeriesIds: ["corp-aa-minus-3y", "ktb-3y"],
  },
  "corp-bbb-minus-3y-spread": {
    sectionId: "credit-volatility",
    unit: "bp",
    frequency: "D",
    formula: "(credit yield - KTB 3Y yield) * 100",
    inputSeriesIds: ["corp-bbb-minus-3y", "ktb-3y"],
  },
  "real-gdp-sa-qoq": {
    sectionId: "korea-macro",
    unit: "%",
    frequency: "Q",
    formula: "(current / comparison - 1) * 100",
    inputSeriesIds: ["real-gdp-sa"],
  },
  "real-gdp-sa-yoy": {
    sectionId: "korea-macro",
    unit: "%",
    frequency: "Q",
    formula: "(current / comparison - 1) * 100",
    inputSeriesIds: ["real-gdp-sa"],
  },
  "cpi-headline-yoy": {
    sectionId: "korea-macro",
    unit: "%",
    frequency: "M",
    formula: "(current / previous-year - 1) * 100",
    inputSeriesIds: ["cpi-headline"],
  },
  "cpi-core-food-energy-excluded-yoy": {
    sectionId: "korea-macro",
    unit: "%",
    frequency: "M",
    formula: "(current / previous-year - 1) * 100",
    inputSeriesIds: ["cpi-core-food-energy-excluded"],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isAvailability(value: unknown) {
  if (!isRecord(value)) return false;
  return ["releaseDate", "vintageDate", "preliminaryFinal", "revisionStatus"]
    .every((field) => value[field] === "provided" || value[field] === "source_not_provided");
}

function isObservation(value: unknown): value is MacroObservation {
  if (!isRecord(value)) return false;
  return validDate(value.observationDate)
    && nonEmpty(value.observationDateRaw)
    && typeof value.valueRaw === "string"
    && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.valueRaw)
    && (value.releaseDate === null || validDate(value.releaseDate))
    && (value.vintageDate === null || validDate(value.vintageDate))
    && (value.preliminaryFinal === null || nonEmpty(value.preliminaryFinal))
    && (value.revisionStatus === null || nonEmpty(value.revisionStatus))
    && isAvailability(value.availability);
}

function isCapture(value: unknown): value is PublicMacroCaptureManifest {
  if (!isRecord(value) || "rawBase64" in value) return false;
  if (!isRecord(value.sanitizedRequest) || "apiKey" in value.sanitizedRequest || "url" in value.sanitizedRequest) return false;
  return nonEmpty(value.captureId)
    && ["ecos", "us-treasury", "ny-fed"].includes(String(value.providerId))
    && nonEmpty(value.contentHash)
    && typeof value.bodyByteLength === "number"
    && value.bodyByteLength >= 0
    && validIso(value.retrievedAt)
    && typeof value.responseStatus === "number"
    && nonEmpty(value.contentType)
    && nonEmpty(value.sanitizedRequest.operation)
    && Array.isArray(value.sanitizedRequest.seriesIds)
    && value.sanitizedRequest.seriesIds.every(nonEmpty);
}

function isBlocked(value: Record<string, unknown>, sectionId: string) {
  return value.status === "blocked"
    && value.sectionId === sectionId
    && nonEmpty(value.seriesId)
    && nonEmpty(value.title)
    && nonEmpty(value.code)
    && nonEmpty(value.message)
    && nonEmpty(value.sourceUrl)
    && RIGHTS.includes(value.rightsStatus as (typeof RIGHTS)[number])
    && !("observations" in value)
    && !("latestObservation" in value);
}

function isReady(
  value: Record<string, unknown>,
  sectionId: string,
  captures: PublicMacroCaptureManifest[],
): boolean {
  if (value.status !== "ready" || value.sectionId !== sectionId) return false;
  if (!Array.isArray(value.observations) || value.observations.length === 0 || !value.observations.every(isObservation)) return false;
  if (!isObservation(value.latestObservation)) return false;
  const latest = value.latestObservation;
  const last = value.observations.at(-1);
  if (!last || JSON.stringify(latest) !== JSON.stringify(last)) return false;
  const observationDates = value.observations.map((item) => item.observationDate);
  if (new Set(observationDates).size !== observationDates.length) return false;
  if (observationDates.some((date, index) => index > 0 && date <= observationDates[index - 1])) return false;
  if (value.mode === "deterministic-derived") {
    const definition = DERIVED_DEFINITIONS[String(value.seriesId) as MacroDerivedSeriesEvidence["seriesId"]];
    if (!definition || !Array.isArray(value.inputSeriesIds) || !Array.isArray(value.inputContentHashes)) return false;
    const inputSeriesIds = value.inputSeriesIds;
    const inputContentHashes = value.inputContentHashes;
    const inputsMatch = JSON.stringify(inputSeriesIds) === JSON.stringify(definition.inputSeriesIds)
      && inputContentHashes.length === definition.inputSeriesIds.length
      && inputContentHashes.every(nonEmpty)
      && definition.inputSeriesIds.every((inputSeriesId, index) => captures.some((capture) =>
        capture.providerId === "ecos"
        && capture.contentHash === inputContentHashes[index]
        && capture.sanitizedRequest.seriesIds.includes(inputSeriesId)
      ));
    return value.providerId === "ecos"
      && value.provider === "한국은행 경제통계시스템(ECOS) · 결정론 계산"
      && value.sectionId === definition.sectionId
      && value.frequency === definition.frequency
      && value.unit === definition.unit
      && value.formula === definition.formula
      && nonEmpty(value.title)
      && nonEmpty(value.definitionVersion)
      && nonEmpty(value.sourceUrl)
      && validIso(value.retrievedAt)
      && nonEmpty(value.contentHash)
      && value.rightsStatus === "pb-internal-use-approved"
      && value.isEducationalFixture === false
      && inputsMatch;
  }
  if (value.mode !== "official-live") return false;
  const sourceMatchesCapture = captures.some((capture) =>
    capture.providerId === value.providerId
    && capture.contentHash === value.contentHash
    && capture.sanitizedRequest.seriesIds.includes(String(value.seriesId))
  );
  const koreaDefinition = String(value.seriesId) in KOREA_MACRO_ALLOWLIST
    ? KOREA_MACRO_ALLOWLIST[String(value.seriesId) as keyof typeof KOREA_MACRO_ALLOWLIST]
    : null;
  const usDefinition = String(value.seriesId) in US_MACRO_ALLOWLIST
    ? US_MACRO_ALLOWLIST[String(value.seriesId) as keyof typeof US_MACRO_ALLOWLIST]
    : null;
  const definitionMatches = koreaDefinition
    ? value.providerId === "ecos"
      && value.provider === koreaDefinition.sourceInstitution
      && value.title === koreaDefinition.label
      && value.frequency === koreaDefinition.frequency
      && value.unit === koreaDefinition.unit
      && value.definitionVersion === koreaDefinition.definitionId
      && value.sourceUrl === koreaDefinition.sourceUrl
    : usDefinition
      ? value.providerId === usDefinition.providerId
        && usDefinition.rightsStatus === "pb-internal-use-approved"
        && value.title === usDefinition.title
        && value.frequency === usDefinition.frequency
        && value.unit === usDefinition.unit
        && value.definitionVersion === usDefinition.definitionVersion
        && (value.sourceUrl === usDefinition.sourceUrl || value.sourceUrl === usDefinition.dataUrlTemplate
          || (usDefinition.providerId === "us-treasury" && typeof value.sourceUrl === "string"
            && value.sourceUrl.startsWith(usDefinition.dataUrlTemplate.split("{YEAR}", 1)[0])))
      : false;
  return value.isEducationalFixture === false
    && nonEmpty(value.seriesId)
    && ["ecos", "us-treasury", "ny-fed"].includes(String(value.providerId))
    && nonEmpty(value.provider)
    && nonEmpty(value.title)
    && ["D", "M", "Q"].includes(String(value.frequency))
    && nonEmpty(value.unit)
    && nonEmpty(value.definitionVersion)
    && nonEmpty(value.sourceUrl)
    && validIso(value.retrievedAt)
    && nonEmpty(value.contentHash)
    && value.rightsStatus === "pb-internal-use-approved"
    && definitionMatches
    && sourceMatchesCapture;
}

export function isMacroDashboardResult(value: unknown): value is MacroDashboardResult {
  if (!isRecord(value) || value.ok !== true) return false;
  if (value.mode !== "official-live-with-blocked-rights-placeholders" || !validIso(value.retrievedAt)) return false;
  if (!Array.isArray(value.captures) || !value.captures.every(isCapture)) return false;
  if (!isRecord(value.consumerPolicy)
    || value.consumerPolicy.pbInternalResearchDisplay !== true
    || value.consumerPolicy.portfolio !== false
    || value.consumerPolicy.productRecommendation !== false
    || value.consumerPolicy.customerOutput !== false
    || value.consumerPolicy.aiNumericGeneration !== false) return false;
  if (!isRecord(value.sections)) return false;
  const sections = value.sections;
  const captures = value.captures as PublicMacroCaptureManifest[];
  return SECTIONS.every((sectionId) => {
    const items = sections[sectionId];
    return Array.isArray(items)
      && items.every((item) => isRecord(item)
        && (isBlocked(item, sectionId) || isReady(item, sectionId, captures)));
  });
}

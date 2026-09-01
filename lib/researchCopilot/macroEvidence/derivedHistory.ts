import type { MacroTrendObservation } from "./historyTypes";
import { macroTrendNumericValue, normalizeMacroTrendObservations } from "./historyValidation";

export interface MacroTrendDerivedInputSeries {
  seriesId: string;
  unit: string;
  definitionVersion: string;
  observations: readonly MacroTrendObservation[];
}
export interface MacroSpreadHistoryDefinition {
  outputSeriesId: string;
  outputUnit: string;
  formula: string;
  leftSeriesId: string;
  rightSeriesId: string;
  leftDefinitionVersion: string;
  rightDefinitionVersion: string;
  inputUnit: string;
  /** 예: %p 차이를 bp로 표시할 때 100 */
  multiplier: number;
}

export interface MacroSpreadHistoryReady {
  status: "ready";
  seriesId: string;
  unit: string;
  formula: string;
  inputSeriesIds: [string, string];
  inputDefinitionVersions: [string, string];
  observations: MacroTrendObservation[];
}

export interface MacroSpreadHistoryBlocked {
  status: "blocked";
  code:
    | "DATA_MISSING"
    | "DATA_CONFLICT"
    | "RESPONSE_INVALID"
    | "UNIT_MISMATCH"
    | "DEFINITION_MISMATCH"
    | "DATE_MISMATCH";
  message: string;
}

export type MacroSpreadHistoryResult = MacroSpreadHistoryReady | MacroSpreadHistoryBlocked;

export interface DeriveMacroSpreadHistoryInput {
  left: MacroTrendDerivedInputSeries;
  right: MacroTrendDerivedInputSeries;
  definition: MacroSpreadHistoryDefinition;
}

function derivedObservation(date: string, value: number): MacroTrendObservation {
  const rounded = Number(value.toFixed(12));
  return {
    observationDate: date,
    observationDateRaw: date,
    valueRaw: String(Object.is(rounded, -0) ? 0 : rounded),
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

/**
 * 양쪽 입력의 날짜 집합·단위·승인된 정의가 정확히 같을 때만 같은 날짜끼리 계산합니다.
 */
export function deriveMacroSpreadHistory(
  input: DeriveMacroSpreadHistoryInput,
): MacroSpreadHistoryResult {
  const { left, right, definition } = input;
  if (left.seriesId !== definition.leftSeriesId || right.seriesId !== definition.rightSeriesId
    || left.definitionVersion !== definition.leftDefinitionVersion
    || right.definitionVersion !== definition.rightDefinitionVersion) {
    return {
      status: "blocked",
      code: "DEFINITION_MISMATCH",
      message: "승인된 입력 계열 또는 계열 정의와 일치하지 않아 파생 계산을 차단했습니다.",
    };
  }
  if (left.unit !== right.unit || left.unit !== definition.inputUnit) {
    return {
      status: "blocked",
      code: "UNIT_MISMATCH",
      message: "입력 계열의 단위가 동일하지 않아 파생 계산을 차단했습니다.",
    };
  }
  if (!Number.isFinite(definition.multiplier) || definition.multiplier === 0) {
    return {
      status: "blocked",
      code: "RESPONSE_INVALID",
      message: "승인된 파생 계산 배율을 확인할 수 없습니다.",
    };
  }

  const normalizedLeft = normalizeMacroTrendObservations(left.observations);
  const normalizedRight = normalizeMacroTrendObservations(right.observations);
  if (!normalizedLeft.ok) {
    return { status: "blocked", code: normalizedLeft.code, message: normalizedLeft.message };
  }
  if (!normalizedRight.ok) {
    return { status: "blocked", code: normalizedRight.code, message: normalizedRight.message };
  }
  if (normalizedLeft.observations.length !== normalizedRight.observations.length
    || normalizedLeft.observations.some((observation, index) =>
      observation.observationDate !== normalizedRight.observations[index]?.observationDate
    )) {
    return {
      status: "blocked",
      code: "DATE_MISMATCH",
      message: "두 입력 계열의 관측일 집합이 동일하지 않아 파생 계산을 차단했습니다.",
    };
  }

  const observations: MacroTrendObservation[] = [];
  for (let index = 0; index < normalizedLeft.observations.length; index += 1) {
    const leftObservation = normalizedLeft.observations[index];
    const rightObservation = normalizedRight.observations[index];
    const leftValue = macroTrendNumericValue(leftObservation.valueRaw);
    const rightValue = macroTrendNumericValue(rightObservation.valueRaw);
    if (leftValue === null || rightValue === null) {
      return {
        status: "blocked",
        code: "DATA_MISSING",
        message: `관측일 ${leftObservation.observationDate}의 입력값이 결측이라 파생 계산을 차단했습니다.`,
      };
    }
    observations.push(derivedObservation(
      leftObservation.observationDate,
      (leftValue - rightValue) * definition.multiplier,
    ));
  }

  return {
    status: "ready",
    seriesId: definition.outputSeriesId,
    unit: definition.outputUnit,
    formula: definition.formula,
    inputSeriesIds: [left.seriesId, right.seriesId],
    inputDefinitionVersions: [left.definitionVersion, right.definitionVersion],
    observations,
  };
}

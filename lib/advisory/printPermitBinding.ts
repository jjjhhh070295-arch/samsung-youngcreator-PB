export interface PrintAttemptIdentity {
  epoch: number;
  routeKey: string;
  permitKey: string;
}

/** 비동기 토큰 소비 전후에 고객 경로·검증 세대·허가 토큰이 모두 같은지 확인한다. */
export function isSamePrintAttempt(
  expected: PrintAttemptIdentity,
  current: PrintAttemptIdentity,
): boolean {
  return (
    expected.epoch === current.epoch &&
    expected.routeKey === current.routeKey &&
    expected.permitKey !== "" &&
    expected.permitKey === current.permitKey
  );
}

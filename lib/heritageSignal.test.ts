import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  shouldShowHeritageSignal,
  HERITAGE_SIGNAL_MIN_AGE,
  HERITAGE_SIGNAL_MIN_AUM_WON,
} from "../components/HeritageSignalBadge";

// 판정 시점을 고정한다 — 나이 경계 테스트가 실행 날짜에 따라 흔들리면 안 된다.
const ASOF = new Date("2026-09-09T00:00:00Z");

function client(over: Partial<Parameters<typeof shouldShowHeritageSignal>[0]> = {}) {
  return {
    clientType: "individual" as const,
    birthDate: "1960-01-01", // 만 66세
    assetSize: 20_000_000_000, // 200억
    ...over,
  };
}

describe("heritage signal badge 표시 조건", () => {
  test("기준값 확인 — 만 55세 / AUM 100억", () => {
    assert.equal(HERITAGE_SIGNAL_MIN_AGE, 55);
    assert.equal(HERITAGE_SIGNAL_MIN_AUM_WON, 10_000_000_000);
  });

  test("개인 · 55세 이상 · AUM 100억 이상이면 표시", () => {
    assert.equal(shouldShowHeritageSignal(client(), ASOF), true);
  });

  test("법인은 자산·나이와 무관하게 미표시", () => {
    assert.equal(
      shouldShowHeritageSignal(client({ clientType: "corporate" }), ASOF),
      false,
    );
  });

  test("개인사업자도 individual 이 아니므로 미표시", () => {
    assert.equal(
      shouldShowHeritageSignal(client({ clientType: "sole_proprietor" }), ASOF),
      false,
    );
  });

  test("AUM 경계 — 100억 정확히는 표시, 1원 모자라면 미표시", () => {
    assert.equal(shouldShowHeritageSignal(client({ assetSize: 10_000_000_000 }), ASOF), true);
    assert.equal(shouldShowHeritageSignal(client({ assetSize: 9_999_999_999 }), ASOF), false);
  });

  test("나이 경계 — 만 55세 생일 당일은 표시, 하루 전은 미표시", () => {
    assert.equal(shouldShowHeritageSignal(client({ birthDate: "1971-09-09" }), ASOF), true);
    assert.equal(shouldShowHeritageSignal(client({ birthDate: "1971-09-10" }), ASOF), false);
  });

  test("생년월일이 없으면 미표시 — 나이를 모르면 단정하지 않는다", () => {
    assert.equal(shouldShowHeritageSignal(client({ birthDate: "" }), ASOF), false);
  });

  test("생년월일이 파싱 불가여도 미표시", () => {
    assert.equal(shouldShowHeritageSignal(client({ birthDate: "몰라요" }), ASOF), false);
  });

  test("나이만 되고 자산이 모자라면 미표시", () => {
    assert.equal(
      shouldShowHeritageSignal(client({ birthDate: "1940-01-01", assetSize: 5_000_000_000 }), ASOF),
      false,
    );
  });

  test("자산만 크고 나이가 모자라면 미표시", () => {
    assert.equal(
      shouldShowHeritageSignal(
        client({ birthDate: "1990-01-01", assetSize: 1_000_000_000_000 }),
        ASOF,
      ),
      false,
    );
  });
});

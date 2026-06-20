-- ================================================================
-- daily_signal_snapshots: scoring_version 컬럼 추가 마이그레이션
-- Supabase SQL Editor에서 실행
-- ================================================================
--
-- 목적: 스냅샷 점수 계산 알고리즘이 바뀔 때마다 버전을 기록해
--       백테스트 시 같은 버전끼리만 비교할 수 있게 한다.
--
-- 버전 이력:
--   v1-legacy              position-based recency weight, 소스 캡 없음 (최초 구현)
--   v2-normalized-capfactor MAX_SOURCE_WEIGHT=0.25 캡 + pre-cap 절댓값 가중평균 정규화
--                           × SIGNAL_SCALE=10 (2026-06-21 도입)

-- 1. 컬럼 추가
--    DEFAULT 'v1-legacy' → 기존 행 전체가 v1-legacy로 자동 백필됨
ALTER TABLE daily_signal_snapshots
  ADD COLUMN IF NOT EXISTS scoring_version text NOT NULL DEFAULT 'v1-legacy';

-- 2. 결과 확인
SELECT
  scoring_version,
  count(*)            AS 행수,
  min(snapshot_date)  AS 가장_오래된_날짜,
  max(snapshot_date)  AS 가장_최근_날짜
FROM daily_signal_snapshots
GROUP BY scoring_version
ORDER BY scoring_version;

-- 상담 건별 PB 개인 메모.
-- 실행: Supabase SQL Editor. 파괴적 변경 없음. 컬럼 하나만 추가한다.
--
-- notes 와 다른 필드다. notes 는 상담 전문(고객 발화 그대로)이고 AI 요인 분석의 입력으로
-- 쓰였다. 새 흐름에서는 전문 텍스트를 받지 않으므로 notes 는 비워 두고, PB 가 상담을
-- 종료하며 남기는 메모를 여기에 적는다. 둘을 한 컬럼에 섞으면 과거 15건(전문)과 앞으로의
-- 기록(메모)이 구분되지 않는다.
--
-- 기존 행은 NULL 로 남는다 — 그때는 이 필드가 없었다는 사실이 그대로 보이는 편이 맞다.
--
-- ── 진행 중인 상담을 어떻게 식별하는가 ─────────────────────────────────────
-- 별도 상태 컬럼을 두지 않는다. ended_at IS NULL 인 행이 곧 "진행 중"이다.
-- "상담 시작"은 ended_at 없이 행을 만들고, "상담 종료"가 그 행에 ended_at·duration·
-- pb_memo·확정 IPS 를 채운다. 진행 상태를 localStorage 나 React state 에 들지 않는
-- 이유는 그것들이 기기·새로고침을 넘지 못하기 때문이다 — 시작과 종료 사이에 화면이
-- 바뀌는 흐름이라 그 방식으로는 연결이 끊긴다.

alter table public.consultations
  add column if not exists pb_memo text;

comment on column public.consultations.pb_memo is
  'PB 개인 메모(상담 종료 시 입력). notes(상담 전문)와 다른 필드다.';

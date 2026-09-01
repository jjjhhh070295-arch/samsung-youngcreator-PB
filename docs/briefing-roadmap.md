# 모닝 브리핑 — 현황 진단과 고객 발송 로드맵

조사 기준: `main` = `acf97ff` (2026-09-01) · 조사일 2026-09-01
조사 범위: 코드 읽기 + Supabase REST 스키마 확인 + dev 서버 실행 검증 1회
**이 문서 작성 외에 코드·DB는 일절 수정하지 않았다.**

---

## 0. 세 줄 요약

- 브리핑은 **생성까지는 완성**돼 있으나, 프로덕션 DB에 `daily_reports` 테이블이 없어 **한 번도 생성된 적이 없다.**
- 이메일 **인프라(컬럼·타입·store·폼 UI)는 이미 다 깔려 있다.** 빠진 것은 발송 그 자체뿐이다.
- 고객 발송까지 남은 실질 작업은 **① 마이그레이션 실행 ② cron 등록 ③ 승인 게이트 ④ 발송 어댑터 ⑤ 수신거부 링크** 5개다.

---

## 1. 현재 구조 (Phase 1)

### 1.1 화면 — `/pb/[pbId]/briefing`

진입점은 PB 대시보드의 「모닝 브리핑」 버튼 하나다 (`app/pb/[pbId]/page.tsx:135`). 사이드바 메뉴에는 없다.

레이아웃은 12칼럼 그리드다.

| 영역 | 내용 |
|---|---|
| 헤더 | ← PB 대시보드 링크, 제목, "고객 개인정보는 사용되지 않습니다" 고지 |
| 헤더 우측 | **개발 환경**: 「오늘 리포트 생성」 버튼 / **프로덕션**: "리포트는 매일 새벽 자동 생성됩니다" 안내 문구만 |
| 좌측 3칼럼 | 지난 리포트 목록 (날짜 + headline, 최신순 최대 60건) |
| 우측 9칼럼 | 지표 바(모델·입력토큰·출력토큰·검색횟수·비용·소요시간) + 생성시각/상태 + `<iframe srcDoc>` 미리보기 (`sandbox="allow-popups"`, 높이 80vh) |
| 배너 | `NO_TABLE`, `ALREADY_EXISTS`(→덮어쓰기 버튼), 일반 에러, `tableMissing` 4종 |

사용자 흐름: **PB 대시보드 → 모닝 브리핑 → (개발 환경에서만) 생성 → 좌측 목록에서 선택 → 우측 미리보기.** 여기서 끝난다. 고객에게 보내는 동선은 존재하지 않는다.

### 1.2 API

#### `POST /api/briefing/generate`

| 항목 | 내용 |
|---|---|
| 입력 | `{ overwrite?: boolean }` — 이게 전부. 고객 식별자를 받지 않는다 |
| 인증 | `isAuthorizedCronRequest()` (`lib/cronAuth.ts`) — **fail-closed** |
| 데이터 소스 | Anthropic Claude + `web_search` 서버 툴 (외부 웹) |
| 저장 | `daily_reports` upsert (`onConflict: report_date`) |
| 출력(성공) | `{ ok: true, report: <daily_reports 행> }` |
| 출력(실패) | `{ ok: false, code, error }` — HTTP는 **항상 200** (401 제외) |
| 에러 코드 | `NO_DB` · `NO_KEY` · `NO_TABLE` · `ALREADY_EXISTS` · `PARSE_FAILED` · `GENERATION_FAILED` · `SERVER_ERROR` |
| 런타임 | `nodejs`, `maxDuration = 300` (Vercel Hobby 최대치) |

인증 로직이 중요하다:

```
CRON_SECRET 있음 → Authorization: Bearer {secret} 일치해야 통과
CRON_SECRET 없음 → NODE_ENV === "development" 일 때만 통과, 프로덕션은 거부
```

`lib/cronAuth.ts` 주석에 설계 의도가 명시돼 있다 — 예전 `/api/research/snapshot`은 시크릿이 없으면 통과시켰는데, "누구나 전 고객에게 메일을 트리거할 수 있는 구멍"이 되므로 기본값을 뒤집었다. **발송을 염두에 두고 미리 만든 헬퍼**다.

#### `GET /api/briefing/list`

| 항목 | 내용 |
|---|---|
| 입력 | 없음 |
| **인증** | **없음** ⚠️ 주석은 "PB 화면(로그인 뒤)에서만 호출된다"고 하지만 코드상 가드가 없다 |
| 출력 | `{ ok: true, reports: [...] }` 최대 60건, `report_date` 내림차순 |
| 테이블 없을 때 | `{ ok: true, reports: [], tableMissing: true }` — 에러가 아니라 정상 응답으로 처리 |

### 1.3 리포트 본문 생성 방식

| 항목 | 값 |
|---|---|
| 모델 | `claude-sonnet-5` — ✅ 유효한 모델 ID |
| 단가 상수 | 입력 $2/MTok, 출력 $10/MTok — ✅ Sonnet 5 실제 단가와 **일치** |
| `max_tokens` | 8,000 |
| 서버 툴 | `web_search_20250305`, `max_uses: 10` |
| 프롬프트 위치 | `lib/briefing/prompt.ts` — `buildBriefingSystemPrompt(todayLabel)` |
| 프롬프트 크기 | **2,605 input tokens** (실측, count_tokens API) / 2,732자 |
| 섹터 정의 | `lib/briefing/sectors.ts` — 4개 하드코딩 |
| 출력 계약 | JSON 1개 객체 `{ headline, html_body, text_body, sources[] }`, 실패 시 `{ error }` |
| 파싱 | 마지막 text 블록에서 첫 `{` ~ 마지막 `}` 슬라이스 후 `JSON.parse` |

**대상 섹터 4개:** 반도체/HBM · 전력기기·데이터센터 전력 · 방산·안보SW · 원전·우라늄

**고정 섹션 7개:** ①헤더+오늘의 한 줄 → ②🎯오늘 꼭 볼 포인트 → ③💵금리·환율·원자재 → ④🏭섹터 브리핑(Top Pick 표) → ⑤⚠️리스크·일정 → ⑥📰출처 → ⑦고지 문구

프롬프트 품질은 높다. 주목할 안전장치:
- 수치를 **CONFIRMED / PARTIAL / NOT_FOUND 3단계**로 판정, "NOT_FOUND를 추정치로 채우는 것" 절대 금지, "빈칸이 틀린 숫자보다 낫다"
- 매수/매도 권유, 비중·진입가·손절가 제시 금지
- 필수 고지 문구를 리터럴로 고정
- HTML은 인라인 CSS만, 외부 CSS/JS/폰트 태그 전면 금지 (메일 클라이언트 대비로 보인다)
- 상승 빨강 `#c0392b` / 하락 파랑 `#1f6fb2` (한국 관례)

### 1.4 저장처 — ⚠️ 테이블 없음

Supabase REST로 직접 확인했다.

| 대상 | 상태 |
|---|---|
| `daily_reports` | ❌ **없음** — `PGRST205 Could not find the table 'public.daily_reports'` |
| `parties.email` | ✅ 존재 |
| `parties.email_opt_in` | ✅ 존재 |
| `parties.email_opt_out_at` | ✅ 존재 |
| `pbs.email` / `pbs.title` / `pbs.phone` | ✅ 존재 |

즉 **`supabase-migration-party-email.sql`과 `supabase-migration-morning-briefing.sql`은 이미 실행됐고, `supabase-migration-daily-reports.sql`만 실행되지 않았다.**

`daily_reports` 스키마(마이그레이션 파일 기준):
```
id uuid PK · report_date date NOT NULL UNIQUE(하루 1건) · headline text
html_body text · text_body text · sources jsonb · model text
input_tokens int · output_tokens int · web_search_count int
cost_usd numeric · duration_sec numeric · generated_at timestamptz
status text DEFAULT 'draft'   -- draft | approved
```
RLS 활성 + `for all using(true) with check(true)` — 다른 테이블과 동일한 전면 허용.

### 1.5 개인화 여부 — **없음. 전사 공통 1일 1건.**

`report_date`가 UNIQUE라 스키마 차원에서 하루 한 건만 가능하다. 라우트는 고객 ID를 입력으로 받지 않고, 프롬프트에도 고객 데이터가 들어가지 않는다. 파일 상단 주석이 이를 명시한다:

> 고객 개인정보는 이 라우트에 절대 들어오지 않는다 — 요청 바디는 overwrite 플래그뿐이고, LLM에는 시장 공통 프롬프트만 전달한다. 개인화(고객별 발송)는 여기서 다루지 않는다.

의도적 설계 결정이다. 개인화는 별도 레이어로 얹어야 한다.

---

## 2. 미완성 흔적 (Phase 2)

### 2.1 TODO/FIXME — 0건

브리핑 관련 6개 파일에 `TODO`·`FIXME`·`XXX`·`HACK`은 하나도 없다. 대신 **단계 표기**가 일관되게 쓰인다:

| 표기 | 범위 | 상태 |
|---|---|---|
| 모닝 브리핑 **1단계** | `parties.email/email_opt_in/email_opt_out_at`, `pbs.email/title/phone` | 코드 ✅ / DB ✅ |
| 모닝 브리핑 **2단계** | `daily_reports` 테이블 + 생성 라우트 | 코드 ✅ / DB ❌ |
| **3단계** (발송) | — | 코드 ❌ / 파일 자체가 없음 |

`lib/store.ts:671` 주석이 명시적이다: *"발송 코드는 아직 없다(2단계). 이건 '누구에게 보내도 되는지'만 고정 쿼리 1번으로 낸다."*

### 2.2 더미 데이터 — 없음

`BRIEFING_SECTORS` 4개는 더미가 아니라 의도된 설정값이다(주석: "나중에 늘릴 때 이 배열만 수정하면 된다"). 고정 문자열 응답이나 목업 리포트는 존재하지 않는다.

### 2.3 정의만 되고 미사용

| 심볼 | 위치 | 상태 |
|---|---|---|
| `listEmailBriefingTargets()` | `lib/store.ts:684` | **호출처 0건.** 발송 대상 조회 로직이 완성돼 있으나 아무도 안 쓴다 |
| `EmailBriefingTarget` | `lib/store.ts:675` | 위 함수 반환 타입, 외부 참조 0건 |
| `daily_reports.status` | 스키마 | `'draft'`만 기록된다. `'approved'`를 쓰는 코드가 **없다** |
| `Client.emailOptOutAt` | `lib/types.ts:258` | 읽기·쓰기 매핑은 있으나 값을 세팅하는 UI/API가 없다 |

`listEmailBriefingTargets()`는 그대로 쓸 수 있는 완성품이다 — `email` 있음 + `email_opt_in=true` + `email_opt_out_at IS NULL`을 **전부 DB에서** 거르고, 마이그레이션 미실행 시 예외 대신 빈 배열을 반환한다(fail-safe).

### 2.4 UI에 있지만 동작하지 않는 것

| 요소 | 문제 |
|---|---|
| 「오늘 리포트 생성」 버튼 | `NODE_ENV === "production"`이면 **렌더되지 않는다.** 프로덕션에서 수동 생성 불가 |
| "리포트는 매일 새벽 자동 생성됩니다" | ⚠️ **사실이 아니다.** cron이 등록돼 있지 않다 (§2.5) |
| 상태 표시 (`status: draft`) | 표시만 되고 승인으로 바꾸는 버튼이 없다 |
| 미리보기 iframe | 정상. 단 `sandbox="allow-popups"`라 `allow-same-origin`이 없어 srcDoc 내부 스크립트는 차단된다(의도된 안전 설정) |

**결과: 프로덕션에서 브리핑을 생성할 방법이 현재 전혀 없다.** 버튼은 숨겨져 있고 cron은 없다.

### 2.5 cron 등록 — 없음

```json
// vercel.json (2026-06-21 이후 변경 없음)
{ "crons": [ { "path": "/api/research/snapshot", "schedule": "30 6 * * 1-5" } ] }
```

브리핑은 등록돼 있지 않다. 참고로 기존 cron `30 6 * * 1-5`(UTC) = **평일 KST 15:30**이다. 모닝 브리핑이라면 KST 07:00 전후가 맞으므로 `0 22 * * 0-4`(UTC) 같은 별도 스케줄이 필요하다. **Vercel Hobby 플랜은 cron 1개·1일 1회 제한**이 있어 기존 스냅샷 cron과 충돌할 수 있다 — 플랜 확인이 선행돼야 한다.

### 2.6 발송 코드 — **전무하다**

명시적으로 확인했다. 다음 중 어느 것도 코드·의존성에 없다:

> Resend · SendGrid · Nodemailer · Mailgun · Postmark · AWS SES · SMTP · 알림톡/카카오 · Solapi · CoolSMS · Twilio · 웹훅 발송

`package.json` 의존성 9개(`@anthropic-ai/sdk`, `@supabase/supabase-js`, `fast-xml-parser`, `next`, `react`, `react-dom`, `read-excel-file`, `recharts`, `unpdf`)에 메일 관련 라이브러리는 없다.

### 2.7 에러 처리 공백

| 상황 | 현재 동작 | 평가 |
|---|---|---|
| Supabase 미설정 | `NO_DB` 200 반환 | 적절 |
| API 키 없음 | `NO_KEY` 200 반환 | 적절 |
| 테이블 없음 | `42P01`/`PGRST205` 감지 → `NO_TABLE` | 잘 처리됨 |
| JSON 파싱 실패 | `PARSE_FAILED` — **재시도 없음** | ⚠️ 8,000토큰 생성분이 통째로 버려진다. 비용은 이미 나갔는데 저장은 안 된다 |
| LLM이 `{error}` 반환 | `GENERATION_FAILED` | 적절 |
| 웹 검색 실패 | 프롬프트가 `{error}` 반환하도록 지시 | 서버 툴 에러는 **예외를 던지지 않고** `web_search_tool_result.content`에 에러 객체로 담긴다. 코드가 이를 직접 검사하지 않아 LLM 판단에 전적으로 의존 |
| Anthropic API 예외 | `catch (e: any)` 하나로 뭉뚱그림 | ⚠️ `RateLimitError`(429)·`APIConnectionError`·`BadRequestError`가 구분되지 않아 재시도 가능/불가 판단 불가 |
| 타임아웃 | `maxDuration 300` | 비스트리밍 호출 + 웹검색 10회 → 5분 초과 위험. SDK 기본 타임아웃 10분과도 어긋남 |
| upsert 실패 | throw → `SERVER_ERROR` | 생성 비용 손실 (파싱 실패와 동일 문제) |

---

## 3. 실제 동작 검증 (Phase 3)

### 3.1 실행 결과 — 생성 실패

`npm run dev` 기동 후 `POST /api/briefing/generate`를 **1회** 호출했다.

**1차 (헤더 없음):**
```
{"ok":false,"error":"Unauthorized"}
--- HTTP 401 | 16.14s ---
```
`.env.local`의 `CRON_SECRET`이 Vercel `env pull` 자리표시자(11자)로 채워져 있어 truthy → 시크릿 분기를 타고 `NODE_ENV=development` 예외가 적용되지 않았다.

**2차 (Bearer 헤더 포함):**
```
{"ok":false,"code":"NO_TABLE","error":"daily_reports 테이블이 아직 없습니다. supabase-migration-daily-reports.sql 을 Supabase SQL Editor에서 먼저 실행하세요."}
--- HTTP 200 | 0.67s ---
```

라우트가 **LLM 호출 전에** 테이블 존재를 확인하고 단락(short-circuit)했다. → **Anthropic API 호출 0회, 비용 $0.**

부수 확인: `GET /api/briefing/list` → `{"ok":true,"reports":[],"tableMissing":true}`, 브리핑 페이지 → HTTP 200 (정상 렌더, 안내 배너 표시).

### 3.2 리포트 본문 — **확인 불가**

`daily_reports` 테이블이 없어 생성 자체가 불가능하다. 테이블 생성은 이번 작업 범위(수정 금지)를 벗어나므로 실행하지 않았다.

**본문을 보려면:** Supabase SQL Editor에서 `supabase-migration-daily-reports.sql` 실행 → dev 서버에서 「오늘 리포트 생성」. 프롬프트 계약상 예상 산출물은 `headline`(한 문장), `html_body`(인라인 CSS, 7섹션, Top Pick `<table>`), `text_body`(플레인텍스트), `sources`(5~8건).

### 3.3 응답 시간·토큰·비용 추정

실측 불가이므로 **추정치**다. 실제 값은 첫 생성 후 화면 지표 바에서 바로 확인된다(코드가 `input_tokens`/`output_tokens`/`web_search_count`/`cost_usd`/`duration_sec`를 전부 저장한다).

| 항목 | 값 | 근거 |
|---|---|---|
| 시스템 프롬프트 | **2,605 tok** | count_tokens 실측 |
| 웹 검색 결과 누적 입력 | 30,000~150,000 tok | 검색 10회 × 결과 본문. **가장 큰 변동 요인** |
| 출력 | ≤ 8,000 tok | `max_tokens` |
| 소요 시간 | 90~240초 | 검색 8~10회 순차 수행 |
| **1건당 비용** | **약 $0.20 ~ $0.55** | 입력 $2/MTok + 출력 $10/MTok + 검색 $0.01/건(코드 상수) × 10 |
| 월 비용 (평일 22일) | **약 $4 ~ $12** | |

> ⚠️ 검색 1건당 $0.01은 코드의 `PRICE_PER_WEB_SEARCH` 상수이며 이번 조사에서 공식 단가표로 교차검증하지 못했다. 모델 단가($2/$10)는 검증 완료.

비용은 무시해도 좋은 수준이다. 리스크는 비용이 아니라 **실패 시 재시도 부재**(§2.7)다.

---

## 4. 기능 현황 3단계 (16)

| 기능 | 상태 | 근거 |
|---|---|---|
| 브리핑 생성 라우트 | 🟡 **부분 동작** | 코드 완성. `daily_reports` 없어 실행 불가 |
| 프롬프트·섹터 정의 | 🟢 **동작함** | 2,605 tok, 4섹터, 7섹션 계약 완비 |
| 리포트 저장 | 🔴 **미구현** | 테이블 미생성 |
| 리포트 목록 조회 | 🟢 **동작함** | `tableMissing` 폴백 포함 정상 응답 확인 |
| 리포트 미리보기 | 🟢 **동작함** | iframe srcDoc, 렌더 확인 |
| 비용·토큰 계측 | 🟢 **동작함** | 6개 지표 저장·표시 |
| cron 인증 헬퍼 | 🟢 **동작함** | fail-closed 검증 완료 (401 실측) |
| 수동 생성 (개발) | 🟢 **동작함** | 버튼 존재 |
| 수동 생성 (프로덕션) | 🔴 **미구현** | 버튼이 렌더되지 않음 |
| 자동 생성 (cron) | 🔴 **미구현** | `vercel.json` 미등록. UI 문구는 된다고 표시 중 |
| PB 이메일/직함/연락처 | 🟢 **동작함** | 컬럼·타입·store·PBManageModal UI 완비 |
| 고객 이메일 입력 | 🟢 **동작함** | `parties.email` + ClientForm 필드 + 형식 검증 |
| 고객 수신 동의(opt-in) | 🟢 **동작함** | `email_opt_in` + 체크박스(이메일 없으면 disabled) |
| 발송 대상 조회 | 🟡 **부분 동작** | `listEmailBriefingTargets()` 완성, **호출처 0건** |
| 수신거부(opt-out) | 🟡 **부분 동작** | 컬럼·타입 존재, 값을 쓰는 코드 없음 |
| 리포트 승인 | 🔴 **미구현** | `status` 컬럼만 존재, `'approved'` 기록 코드 없음 |
| **이메일 발송** | 🔴 **미구현** | 코드·의존성 전무 |
| 고객별 개인화 | 🔴 **미구현** | 설계상 배제 (전사 공통 1건) |
| 발송 이력·감사 로그 | 🔴 **미구현** | 테이블 없음 |

**🟢 8 / 🟡 4 / 🔴 7**

---

## 5. 고객 발송에 필요한 것 (17)

| # | 필요한 것 | 분류 | 상세 |
|---|---|---|---|
| 1 | 고객 이메일 주소 | ✅ **이미 있음** | `parties.email` + ClientForm 입력·검증 |
| 2 | 수신 동의 | ✅ **이미 있음** | `parties.email_opt_in`, 기본 false, 이메일 없으면 체크 불가 |
| 3 | 발송 대상 조회 | ✅ **이미 있음** | `listEmailBriefingTargets()` — 호출만 하면 됨 |
| 4 | PB 회신 주소·서명 | ✅ **이미 있음** | `pbs.email/title/phone` + PBManageModal |
| 5 | 메일 본문 HTML | ✅ **이미 있음** | `html_body` — 인라인 CSS 전용 규칙이 이미 메일 호환 |
| 6 | 플레인텍스트 대체본 | ✅ **이미 있음** | `text_body` (멀티파트 메일의 text/plain 파트) |
| 7 | 발송 트리거 인증 | ✅ **이미 있음** | `isAuthorizedCronRequest()` fail-closed |
| 8 | 리포트 저장소 | 🔧 **확장하면 됨** | SQL 파일 존재 → **실행만** 하면 됨 |
| 9 | 리포트 승인 상태 | 🔧 **확장하면 됨** | `status` 컬럼 존재 → `'approved'` 전이 API + 버튼 추가 |
| 10 | 자동 생성 스케줄 | 🔧 **확장하면 됨** | `vercel.json`에 cron 1줄 추가 (플랜 확인 선행) |
| 11 | 프로덕션 수동 생성 | 🔧 **확장하면 됨** | 버튼 숨김 조건 제거 + `CRON_SECRET` 전달 경로 |
| 12 | 수신거부 처리 | 🔧 **확장하면 됨** | `email_opt_out_at` 컬럼 존재 → 공개 unsubscribe 라우트 + 토큰 |
| 13 | **이메일 발송 어댑터** | 🆕 **새로 만들어야 함** | `lib/mailer/` — 공급자 SDK/HTTP 호출 |
| 14 | **발송 라우트** | 🆕 **새로 만들어야 함** | `POST /api/briefing/send` |
| 15 | **발송 이력 테이블** | 🆕 **새로 만들어야 함** | `briefing_sends` — 재발송 방지·감사 |
| 16 | **(광고) 표기·수신거부 푸터** | 🆕 **새로 만들어야 함** | 법정 필수 (§8) |
| 17 | **발송 실패 재시도·바운스 처리** | 🆕 **새로 만들어야 함** | 하드바운스 시 자동 opt-out |
| 18 | **환경변수** | 🆕 **새로 만들어야 함** | 공급자 API 키, 발신 도메인 |

**이미 있음 7 / 확장 5 / 새로 6.** 기반이 예상보다 훨씬 많이 깔려 있다.

---

## 6. 개인화에 필요한 데이터 (18)

전사 공통 리포트에 고객별 섹션을 얹는 경우다. **기존 store 함수만으로 대부분 해결된다.**

| 개인화 요소 | 필요 데이터 | 조달 방법 | 새 쿼리? |
|---|---|---|---|
| 호칭·인사말 | `Client.name`, `clientType` | `listClients()` / `getClient()` | ❌ 불필요 |
| 담당 PB 서명 | `PB.name/title/phone/email` | `listPbs()` | ❌ 불필요 |
| 보유 종목 연관 섹터 강조 | 보유종목 | `listBookHoldings(clientIds)` (`lib/advisory/holdingsStore.ts`) — **벌크 지원** | ❌ 불필요 |
| 포트폴리오 비중 대비 코멘트 | `Client.portfolios` | `listClients()`에 포함 | ❌ 불필요 |
| 투자성향 톤 조절 | `Client.ips` (RRTTLLU) | `listClients()`에 포함 | ❌ 불필요 |
| 상속·증여 시그널 | 헤리티지 판정 | `listOwnershipRelationshipsBulk` / `listFamilyRelationshipsBulk` / `listRealEstateWithDebtBulk` / `listGiftEventsBulk` + `resolveHeritageInputsBulk` + `assessHeritage` — **전부 벌크, N+1 없음** | ❌ 불필요 |
| 현금흐름 임박 이벤트 | `Client.cashFlows` | `listClients()`에 포함 | ❌ 불필요 |
| 세금 이슈 | `lib/taxProjection.ts` 계열 | 기존 함수 | ❌ 불필요 |
| **발송 이력(중복 방지)** | 오늘 이미 보냈는지 | — | ✅ **새 테이블 필요** |
| **개인화 본문 저장** | 고객별 렌더 결과 | — | ✅ **새 테이블 필요** (감사·재발송용) |

핵심: **`listClients()` 한 번 + 벌크 함수 4~5개면 전 고객 개인화 입력이 모인다.** 고객 수가 늘어도 쿼리 수가 늘지 않는 구조가 이미 갖춰져 있다(`lib/heritage/resolveBulk.ts`가 그 패턴의 레퍼런스).

**개인화 방식은 LLM 재호출 없이 템플릿 조립을 권한다.** 고객 N명마다 LLM을 부르면 비용이 N배가 되고, 무엇보다 **고객 개인정보가 LLM에 들어간다.** 현재 코드는 그것을 명시적으로 피하고 있고(`generate/route.ts` 상단 주석), 그 원칙을 유지하는 편이 안전하다. 공통 `html_body` 앞뒤에 결정론적으로 생성한 개인화 블록을 끼워 넣는 방식이면 개인정보가 외부로 나가지 않는다.

---

## 7. 발송 수단 비교 (19)

| 수단 | 필요 환경변수 | 개략 비용 | 국내 도달률 | 규제 고려 |
|---|---|---|---|---|
| **Resend** | `RESEND_API_KEY`, 발신 도메인(DKIM/SPF) | 무료 3,000통/월, 이후 $20/월 50,000통 | 중 — 네이버/다음 스팸 분류 가능 | 일반 이메일 규제 |
| **AWS SES** | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, 발신 도메인 | $0.10/1,000통 (최저) | 중 — 평판 직접 관리 필요, 샌드박스 해제 절차 | 일반 이메일 규제 |
| **SendGrid** | `SENDGRID_API_KEY`, 발신 도메인 | 무료 100통/일, 이후 $20/월~ | 중 | 일반 이메일 규제 |
| **카카오 알림톡** | 대행사 키(Solapi/NHN Cloud 등), 발신프로필 | 건당 약 6.5~9원 + 실패 시 SMS 대체 비용 | **상 — 국내 최고** | ⚠️ **템플릿 사전 승인 필수**, 정보성만 허용 |
| **카카오 친구톡** | 위와 동일 + 채널 친구 | 건당 약 12~20원 | 상 (친구만) | 광고성 허용, (광고) 표기 필수 |

### 권장: **이메일 우선, Resend 또는 SES**

이유 세 가지.
1. `html_body`/`text_body`가 **이미 이메일용으로 설계**돼 있다(인라인 CSS 전용, 외부 리소스 금지). 알림톡은 텍스트 1,000자 제한이라 리포트를 담을 수 없다.
2. 알림톡은 **템플릿 사전 승인**이 필요한데, 매일 내용이 바뀌는 리포트는 변수 치환 한도를 넘겨 승인이 어렵다. 현실적으로 "브리핑이 도착했습니다 + 링크" 알림 용도로만 가능하다.
3. Resend는 도입 비용이 가장 낮고, SES는 규모가 커졌을 때 가장 싸다. **시작은 Resend, 물량이 늘면 SES로 전환**이 무난하다.

알림톡을 쓴다면 **이메일 본문 + 알림톡 도착 알림 링크** 조합이 맞다.

### ⚠️ 국내 규제 (정보통신망법 · 자본시장법)

| 항목 | 요구사항 | 현재 대응 |
|---|---|---|
| 사전 동의(opt-in) | 영리목적 광고성 정보는 **명시적 사전 동의** 필수 | ✅ `email_opt_in` 기본 false |
| 제목 `(광고)` 표기 | 광고성이면 제목 앞에 **(광고)** | 🔴 미구현 |
| 수신거부 방법 | 본문에 **명확히** 표시, 무료 수단 | 🔴 미구현 |
| 수신거부 처리 | 즉시 반영 | 🟡 컬럼만 존재 |
| 야간 전송 제한 | 광고성은 **21시~익일 08시 금지** | ⚠️ 모닝 브리핑은 07시 발송이 자연스러운데 **08시 이전이면 위반 소지**. 08시 이후 발송 권장 |
| 수신동의 재확인 | **2년마다** 동의 여부 확인 | 🔴 미구현 |
| 투자권유 규제 | 유사투자자문·투자권유 해당 여부 | ✅ 프롬프트가 매수/매도 권유·목표비중 금지 + 고지문구 강제 |
| 개인정보 수집·이용 동의 | 이메일 수집 목적 고지 | 🔴 별도 확인 필요 |

**"모닝 브리핑"이 광고성인지 정보성인지 법률 판단이 선행돼야 한다.** 금융상품 관련 콘텐츠는 광고성으로 보는 것이 안전하며, 그렇다면 (광고) 표기 + 08시 이후 발송 + 수신거부 링크가 **전부 필수**다. 이 판단은 개발이 아니라 컴플라이언스 확인 사항이다.

---

## 8. `canIssueClientPdf` 게이트 연동 (20)

### 현재 게이트 구조

```ts
// lib/advisory/control.ts:117
export function canIssueClientPdf(bundle: EvidenceBundle): boolean {
  return bundle.status === PDF_ALLOWED_STATUS && canLock(bundle);
}
```

`EvidenceBundle`은 **고객(clientId) 단위**이고 상태는 `draft → review → locked / blocked`로 전이한다. `pdfBlockReason()`이 상태별 한국어 사유를 낸다. 즉 **"이 고객에게 산출물을 내보내도 되는가"를 이미 판정하는 장치가 존재한다.**

### 문제: 축이 다르다

| | 대상 | 승인 단위 |
|---|---|---|
| `canIssueClientPdf` | **고객별** | 고객 상담 근거 번들 |
| 모닝 브리핑 | **전사 공통** | 리포트 1건 (`daily_reports.status`) |

브리핑에 `canIssueClientPdf`를 그대로 쓰면 "시장 리포트를 보내려면 그 고객의 상담 근거가 locked여야 한다"가 되어 의미가 맞지 않는다.

### 권장: **2단 게이트**

```
[1단] 리포트 승인 (전사 1회)
      daily_reports.status: draft → approved
      · 담당자가 브리핑 화면에서 내용 확인 후 「승인」
      · approved 아니면 발송 라우트가 거부

[2단] 고객별 발송 자격 (고객 N명 각각)
      listEmailBriefingTargets()  ← email + opt_in + not opt_out
      · 개인화 블록이 없으면 여기서 끝
      · 개인화 블록(보유종목·헤리티지 등)이 있으면 추가로
        canIssueClientPdf(loadBundle(clientId)) 통과 요구
```

**핵심 원칙: 공통 시장 콘텐츠에는 Evidence 게이트를 요구하지 않고, 고객 데이터가 섞이는 순간부터 요구한다.** 이러면 기존 게이트의 취지(고객 대면 산출물은 PB 승인 필수)를 지키면서, 시장 리포트 발송이 상담 진행 상태에 발목 잡히지 않는다.

`pdfBlockReason()`을 그대로 재사용해 "이 고객은 왜 개인화 블록이 빠졌는지"를 PB에게 보여줄 수 있다.

⚠️ `lib/advisory/control.ts`는 **박상혁·Yestar1127 소유 파일**이다(§10). 이 파일을 수정하지 말고 **읽기 전용으로 호출만** 하는 설계가 안전하다.

---

## 9. `parties.email` 전제 (21)

**전제가 이미 충족돼 있다.** 2026-08-30 조사 시점에는 컬럼이 없었으나, 2026-09-01 현재 Supabase REST로 확인한 결과 다음이 모두 존재한다:

- `parties.email` ✅
- `parties.email_opt_in` ✅
- `parties.email_opt_out_at` ✅
- `pbs.email` / `pbs.title` / `pbs.phone` ✅

`supabase-migration-party-email.sql`과 `supabase-migration-morning-briefing.sql`이 이미 실행된 상태다. 코드 쪽도 `lib/types.ts`, `lib/store.ts`, `components/ClientForm.tsx`, `components/PBManageModal.tsx`에 전부 반영돼 있다.

### 여전히 유효한 방어 로직

`lib/store.ts:178` `withMissingColumnFallback()`이 컬럼 부재를 감지하면 해당 키를 빼고 재시도한다. 에러 코드를 두 갈래로 잡는 이유가 주석에 정확히 기록돼 있다:

- SELECT 필터의 없는 컬럼 → Postgres 원본 `42703`
- INSERT/UPDATE payload의 없는 컬럼 → PostgREST 스키마 캐시가 먼저 걸러 `PGRST204`

**미실행 환경(로컬 사본, 새 Supabase 프로젝트)에서도 앱이 깨지지 않는다.** 다만 그 상태에서는 이메일·동의가 저장되지 않고 `listEmailBriefingTargets()`가 빈 배열을 반환해 **발송 대상 0명**이 된다 — 조용히 아무도 못 받는 상태이므로, 발송 라우트는 대상 0명일 때 성공이 아니라 **경고를 남기도록** 만들어야 한다.

### 남은 스키마 작업

`parties.email` 자체는 끝났고, 새로 필요한 것은 발송 이력 테이블뿐이다:

```sql
-- (제안) supabase-migration-briefing-sends.sql
create table if not exists briefing_sends (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references daily_reports(id) on delete cascade,
  client_id uuid not null references parties(id) on delete cascade,
  email text not null,                       -- 발송 시점 주소 스냅샷
  status text not null default 'queued',     -- queued | sent | failed | bounced
  provider_message_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz default now(),
  unique (report_id, client_id)              -- 같은 리포트 중복 발송 차단
);
```
`unique (report_id, client_id)`가 재실행 안전성의 핵심이다 — cron이 두 번 돌아도 같은 사람에게 두 번 가지 않는다.

---

## 10. 구현 순서 · 작업량 · 팀원 파일 (22, 23)

작업량은 **작업 시간이 아니라 변경 규모**로 표기한다(S=한 파일 몇 줄, M=한두 파일 신규, L=여러 파일·설계 결정 포함).

팀원 판정 기준: 최근 2주(2026-08-18~09-01) 내 박상혁·조예빈(ybinyv)·luaroy·Yestar1127 커밋 유무.

| # | 단계 | 규모 | 건드리는 파일 | 팀원 소유? |
|---|---|---|---|---|
| **1** | `supabase-migration-daily-reports.sql` 실행 | **S** | (DB만, 코드 변경 없음) | — |
| **2** | 생성 1회 실행 → 본문·비용 실측 | **S** | 없음 | — |
| **3** | `vercel.json`에 브리핑 cron 등록 | **S** | `vercel.json` | ✅ 안전 (6/21 이후 무변경) |
| **4** | 프로덕션 수동 생성 버튼 복구 | **S** | `app/pb/[pbId]/briefing/page.tsx` | ✅ 안전 (본인 단독) |
| **5** | 리포트 승인 API + 버튼 (`draft→approved`) | **M** | `app/api/briefing/approve/route.ts`(신규), `briefing/page.tsx` | ✅ 안전 |
| **6** | 에러 처리 보강 (파싱 실패 1회 재시도, Anthropic 예외 분기) | **M** | `app/api/briefing/generate/route.ts` | ✅ 안전 (본인 단독) |
| **7** | 발송 이력 테이블 마이그레이션 | **S** | `supabase-migration-briefing-sends.sql`(신규) | — |
| **8** | 메일 어댑터 | **M** | `lib/mailer/`(신규), `package.json` | ⚠️ **package.json — 박상혁 최근 수정** |
| **9** | 발송 라우트 `POST /api/briefing/send` | **L** | `app/api/briefing/send/route.ts`(신규) | ✅ 안전 (신규) |
| **10** | 수신거부 라우트 + 토큰 | **M** | `app/api/briefing/unsubscribe/route.ts`(신규), `lib/store.ts` | ⚠️ **store.ts — 박상혁·Yestar1127** |
| **11** | (광고) 표기·수신거부 푸터·법정 고지 | **S** | `lib/briefing/emailTemplate.ts`(신규) | ✅ 안전 (신규) |
| **12** | 발송 cron 등록 (생성과 분리) | **S** | `vercel.json` | ✅ 안전 |
| **13** | 발송 결과 화면 (성공/실패/바운스) | **M** | `briefing/page.tsx` | ✅ 안전 |
| **14** | 개인화 블록 (선택) | **L** | `lib/briefing/personalize.ts`(신규) + `control.ts` **읽기만** | ⚠️ **control.ts 호출만, 수정 금지** |
| **15** | 바운스 웹훅 → 자동 opt-out | **M** | `app/api/briefing/bounce/route.ts`(신규), `lib/store.ts` | ⚠️ **store.ts** |

### 마일스톤

| 단계 | 포함 | 도달 상태 |
|---|---|---|
| **M1 — 생성 정상화** | 1, 2, 3, 4 | 매일 자동으로 리포트가 만들어지고 PB가 화면에서 본다. **발송은 없음** |
| **M2 — 승인·견고성** | 5, 6 | 사람이 승인한 리포트만 다음 단계로 넘어간다 |
| **M3 — 발송 최소 구현** | 7, 8, 9, 11, 12 | opt-in 고객에게 공통 리포트가 메일로 나간다 |
| **M4 — 규제·운영** | 10, 13, 15 | 수신거부·바운스·발송 결과 추적 |
| **M5 — 개인화** | 14 | 고객별 블록. Evidence 게이트 연동 |

**M1은 오늘 바로 가능하다** — SQL 실행 + `vercel.json` 한 줄 + 버튼 조건 제거가 전부다.

### 팀원 파일 주의 요약

| 파일 | 최근 2주 관여 | 권고 |
|---|---|---|
| `lib/store.ts` | **박상혁**, Yestar1127, 본인 | 함수 **추가만** 하고 기존 함수 수정 금지. 파일 하단에 새 섹션으로 |
| `lib/advisory/control.ts` | **박상혁**, Yestar1127 | **읽기 전용.** `canIssueClientPdf`/`pdfBlockReason` 호출만 |
| `lib/advisory/types.ts` | **박상혁**, luaroy, Yestar1127, 본인 | 수정 불필요 |
| `package.json` | **박상혁**, 본인 | 의존성 추가 시 lock 충돌 주의. 별도 커밋 권장 |
| `app/pb/[pbId]/page.tsx` | **조예빈**, 본인 | 브리핑 진입점만 있음. 수정 불필요 |
| 브리핑 6개 파일 전부 | 본인 단독 | ✅ 자유롭게 수정 가능 |

---

## 11. 즉시 처리 권고 3건

1. **UI 문구가 사실과 다르다.** 프로덕션 브리핑 화면이 "리포트는 매일 새벽 자동 생성됩니다"라고 표시하지만 cron이 없다. cron을 등록하거나 문구를 고쳐야 한다. 현재는 PB가 매일 빈 화면을 보게 된다.
2. **`GET /api/briefing/list`에 인증이 없다.** 주석은 "PB 화면에서만 호출된다"고 하지만 코드 가드가 없어 URL만 알면 누구나 전체 리포트를 읽을 수 있다. 고객 데이터는 없지만 유료 생성물이다.
3. **`CRON_SECRET`이 로컬에서 자리표시자다.** Vercel `env pull`이 넣은 11자 마스킹 값이라, 로컬에서 브리핑·스냅샷 생성이 401로 막힌다. 값을 채우거나 그 줄을 지워야(→ dev 예외 적용) 한다. 같은 이유로 `KIS_BASE_URL`·`MOLIT_APT_TRADE_ENDPOINT`도 자리표시자가 기본값 폴백을 막고 있다(`ERR_INVALID_URL` 실측).

---

## 부록 A. 조사 방법

- 코드: `git ls-files` + `grep` 전수, 브리핑 관련 6파일 591줄 전문 통독
- DB: Supabase REST(`/rest/v1/...`) 로 테이블·컬럼 존재 여부 직접 확인
- 실행: `npm run dev` → `POST /api/briefing/generate` **1회** (401 → Bearer 재시도 → `NO_TABLE`)
- 토큰: Anthropic `messages.count_tokens` (무료, 생성 아님) — 서버 툴 제외하고 측정
- 모델·단가: `claude-api` 레퍼런스로 `claude-sonnet-5` ID·단가 교차검증

## 부록 B. 확인 불가 항목

| 항목 | 사유 |
|---|---|
| 리포트 본문 전문 | `daily_reports` 미생성. 테이블 생성은 이번 작업 범위 밖 |
| 실제 응답 시간·토큰·비용 | 동일 |
| 웹 검색 1건당 실제 단가 | 코드 상수($0.01)를 공식 단가표로 교차검증하지 못함 |
| Vercel 플랜(Hobby/Pro) | 대시보드 접근 필요. cron 개수·빈도 제한에 영향 |
| 브랜치 보호 규칙 | `gh` CLI 미설치 |

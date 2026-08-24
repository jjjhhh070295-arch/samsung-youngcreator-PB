# PB 상담 지원 웹앱

PB(Private Banker)의 고객 상담을 **RRTTLLU 7요인**으로 구조화해 IPS(투자정책서)로 정리하고,
상담 타이머·이력·성향 변화 그래프·PB 대시보드를 제공하는 상담 지원 도구입니다.

> ⚠️ **참고용 · 투자권유 아님.** 포트폴리오/스트레스 테스트 결과는 PB 검토를 전제로 한 보조도구이며,
> 실서비스 전 법적 검토가 필요합니다.

---

## 기술 스택

- **Next.js 14 (App Router) + TypeScript**
- **Tailwind CSS** (딥블루 + 골드 디자인 시스템, 다크/화이트 토글)
- **Recharts** (레이더·시계열·파이·막대 차트)
- **Supabase** (Postgres, 팀 공유 DB)
- **Anthropic API** (전문 텍스트 → 7요인 AI 분석, 서버 라우트 전용)
- **네이버 CLOVA Speech / OpenAI Whisper** (음성 → 텍스트, 서버 라우트 전용)

---

## 빠른 시작 (팀원 셋업 가이드)

```bash
# 1) 코드 받기
git pull            # (또는 압축 해제)

# 2) 의존성 설치
npm install

# 3) 환경 변수 설정
#    .env.local.example 을 복사해 .env.local 로 만들고 키를 채웁니다.
#    (키를 비워도 앱은 동작합니다 — 해당 기능 호출 시 안내만 표시)

# 4) 개발 서버 실행
npm run dev         # http://localhost:3000
```

### Supabase 키 넣는 위치 — `.env.local`

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...           # 서버 전용 (NEXT_PUBLIC 금지)
CLOVA_SPEECH_INVOKE_URL=...            # 서버 전용
CLOVA_SPEECH_SECRET=...                # 서버 전용
OPENAI_API_KEY=sk-...                  # (선택) Whisper 대체용, 서버 전용
```

> **키가 없으면?** Supabase 키가 비면 데이터가 **브라우저 로컬(localStorage)** 에만 저장되는
> 폴백 모드로 동작합니다(팀원 공유 안 됨). AI/STT 키가 비면 해당 기능 호출 시 안내 메시지가 뜨고
> 나머지는 정상 동작합니다.

### Supabase 사전 설정

1. [supabase.com](https://supabase.com) 가입 → 프로젝트 생성
2. **Settings → API** 에서 `URL` / `anon key` 복사 → `.env.local`
3. **SQL Editor** 에서 저장소의 [`supabase.sql`](./supabase.sql) 전체 실행 (테이블 + RLS)

### 데이터 입력

홈 화면에서 **PB를 추가**하고, PB 페이지에서 **고객을 추가**한 뒤, 고객 상세에서 상담을 진행하면
모든 데이터가 Supabase에 저장됩니다.

---

## 비용 안전장치 (중요)

- **AI(Anthropic) · STT(CLOVA/Whisper) 는 사용량 과금**입니다.
  각 콘솔에서 **사용 한도 설정 + 자동충전 OFF** 를 꼭 켜두세요.
- 음성 업로드는 **최대 25MB / 약 10분** 으로 제한됩니다. 짧은 테스트 음성만 사용하세요.
- **실제 고객정보·실제 녹음 사용 금지** — 프로토타입은 가짜 데이터로만 테스트하세요.

---

## 화면 구성

| 경로 | 설명 |
|---|---|
| `/` | 홈 — PB 폴더 / 고객 전체 표 (보기 전환) |
| `/pb/[pbId]` | PB 대시보드(고객수·AUM·개인법인비율·평균상담시간) + 담당 고객 표 |
| `/pb/[pbId]/[clientId]` | 고객 상세 — 타이머·입력(전문/직접/음성)·7요인 폼·레이더·추세·이력·현금흐름 |
| `/pb/[pbId]/[clientId]/portfolio` | 포트폴리오 & 스트레스 — 7요인·현금흐름·리서치 기반 추천 |
| `/client/[clientId]` | 고객용 화면 — 쉬운 요약 + 레이더 |

---

## 신뢰성 설계 (AI 오류·과대계상 방지)

각 요인을 3단계로 분류합니다.

- **explicit (직접 근거)**: 상담에 명시적 근거가 있을 때만 점수(1~5) + 원문 인용(evidence)
- **inferred (추론 단서)**: 단서만 있을 때 → **점수 비움**, 단서(inferenceHint)만 참고 제시
- **empty (미언급)**: 근거·단서 모두 없음 → 완전 공백 (임의값 금지)

모든 AI 결과는 `reviewed:false`(draft)로 시작하며, **PB가 [검토 확정]** 해야 추세 그래프에 반영됩니다.
저장은 자동저장이 아니라 **[저장 확정] → 잠금 → [수정]** 흐름이며, 미저장 이탈 시 경고합니다.

---

## 포트폴리오 산출 구조

포트폴리오는 고정된 안정형/균형형/성장형 비중을 먼저 놓고 사후 보정하지 않습니다.
`lib/portfolio.ts`는 아래 순서로 입력을 학습해 추천안을 산출합니다.

1. RRTTLLU 7요인 점수와 근거 확인
2. 현금흐름·세금 납부·단기 현금화 압력 분석
3. 최신 리포트/리서치 신호 점수화
4. 고객 고유 요구조건과 제약 반영
5. 자산군 점수 정규화로 3개 추천안 산출

스트레스 테스트는 `lib/stresstest.ts`와 `lib/stress/*`의 시나리오 모델을 통해 별도 검정합니다.

### 확장 아이디어 (핵심 완성 후)

1. IPS 문서 PDF 내보내기 ⭐ (데이터 구조가 이미 준비됨)
2. 고객 이름·식별코드 검색
3. 고객 화면 링크/QR 공유
4. 자동 임시저장
5. AI 분석 근거 하이라이트
6. 로그인·권한(PB 계정) + RLS 강화

---

## 주의사항

- `.env.local` 은 **절대 커밋 금지** (`.gitignore` 포함됨). 서버 키에 `NEXT_PUBLIC` 금지.
- RLS 정책은 프로토타입용 — 운영 전 반드시 강화.
- 점수(score)는 그래프용 보조 지표이며, 실제 판단은 값·메모와 함께 봅니다.

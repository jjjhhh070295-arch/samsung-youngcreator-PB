# VVIP Liquidity & Tax Shield

Samsung Securities Young Creator PB Insight 과제용 1차 MVP입니다.

## 목적

PB가 VVIP 고객 상담 메모를 입력하면 단기 유동성, 세금 납부 일정, 고객 행동편향, 포트폴리오 리스크를 한 화면에서 판단하고 PDF 제안서까지 출력하는 업무형 대시보드입니다.

## 현재 MVP 범위

- 단일 `index.html` 정적 웹앱
- 외부 API 없이 데모 데이터로 즉시 실행
- 고객 메모 기반 RRTTLLU 분석
- 현재안 / 제안 A / 제안 B 3개 포트폴리오 비교
- 세후수익률, 변동성, 샤프 지수, MDD, 예상 세금, 유동성 커버리지 계산
- 금리 +100bp, 원/달러 +200원, 원자재 인플레 스트레스 테스트
- 세금 납부 전 현금화 타임라인
- 행동재무 Guardrail
- 브라우저 인쇄 기능을 통한 PDF 저장

## 실제 API 연동 확장안

1. 시장 데이터
   - `yfinance`, KRX Open API, 한국투자증권 Open API로 ETF/주식/채권 가격 시계열 수집
   - 현재 JS 내부의 `assetClass` 기대수익률, 변동성, MDD 값을 실제 수익률 기반 계산값으로 대체

2. 거시 데이터
   - 한국은행 ECOS, FRED API로 금리, 환율, CPI, 원자재 지표 수집
   - `stress` 민감도 테이블을 과거 위기 구간 수익률 또는 회귀 베타로 보정

3. AI 분석
   - 상담 메모를 LLM Structured Output으로 변환
   - 출력 스키마: `return`, `risk`, `timeHorizon`, `tax`, `liquidity`, `legal`, `unique`, `events`

4. PDF 생성
   - 현재는 `window.print()` 기반
   - 실서비스에서는 `react-pdf`, `pdfmake`, 또는 서버 사이드 HTML-to-PDF로 제안서 템플릿 고정

5. 데이터 저장
   - Supabase 또는 사내 DB에 상담 케이스, 입력값, 포트폴리오 선택안 저장
   - 고객 식별정보는 가명처리 후 저장

## 발표 포인트

이 MVP의 차별점은 수익률 중심 추천이 아니라 `세금 납부 전 현금화`와 `행동편향 방지`를 PB 상담 흐름에 넣은 점입니다. VVIP 고객은 단순히 높은 수익률보다 증여, 상속, 세금, 법인 자금, 가족 이벤트를 안전하게 통과하는 의사결정 구조가 중요하다는 메시지를 강조하면 좋습니다.

## 실행 방법

`index.html`을 브라우저에서 열면 바로 실행됩니다. 별도 설치나 서버가 필요 없습니다.

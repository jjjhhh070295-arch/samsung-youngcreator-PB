# 국내·미국 투자등급 회사채 ETF 구현 기록

작성일: 2026-09-09  
저장소: `samsung-youngcreator-PB`  
범위: ACE `0099L0`, LQD, 만기매칭 KODEX `0007F0`, 국채 ETF 코드 정정

## 1. 재현된 근본 원인

| 이슈 | 원인 | 조치 |
|------|------|------|
| `273130`을 단기채로 표기 | 카탈로그·샘플·추천이 KODEX 단기채권으로 오라벨 | 단기채=`153130`, 종합채권=`273130` 명칭 정정(코드·원가 유지) |
| `BOND-KEPCO` / `BOND-GOOGL` | 시세 없는 OTC 대표 심볼이 신규 선택에 노출 | 신규 UI에서 제거, ACE/LQD로 대체, 초안 재선택 헬퍼 제공 |
| 직접채권 → EPS | `selectionToHoldings`가 ETF가 아니면 `stock` | 직접채권은 `other`+`bond`, ETF는 `etf`+`bond` |
| 채권 ETF → `bond_face` | `inferQuotationKind`가 자산군만 보고 액면 처리 | ETF/ETN은 항상 `share` |
| 영문 포함 종목코드 | `validate-holdings`가 `/^\d{6}$/`만 허용 | `[0-9A-Z]{6}` 문자열 보존 |
| YTM≈CAGR 혼동 | 국내 ETF 펀더멘털 공란 → CAGR 폴백 | 시나리오 모듈에서 YTM/분배/CAGR을 분리 라벨 |
| 세금 이중가산 | `totalReturnPct`+`couponPct` 합산 | 채권 ETF/직접은 coupon을 총수익 내 인컴으로 분해 |

## 2. 상품·데이터 지원 상태

| 상품 | 코드 | 시세 경로 | 펀드지표(YTM·듀레이션·분배) | 비고 |
|------|------|-----------|------------------------------|------|
| ACE 우량회사채(AA-이상)액티브 | `0099L0` | KIS 국내 주식/ETF(기존) | 자동 수집 미완 — PB 확인 입력·공시 근거 필요 | 실시간 호가 ≠ 월간 공시 asOf |
| iShares LQD | `LQD` | KIS 해외(계정·거래소 매핑 확인 필요) / 기존 USD 경로 | iShares 공시·다운로드 — 라이선스·DOM 빈 화면 시 날조 금지 | USD 상장 |
| KODEX 27-12 회사채(AA-이상)액티브 | `0007F0` | KIS 국내 ETF | 만기매칭·청산은 공시 확인, 원금 보장 모델 미적용 | 상시형과 별도 카테고리 |

공식 확인 링크(구현 시점 참고, 가격·수익률은 하드코딩하지 않음):

- ACE: https://www.aceetf.co.kr/info/report/1214 , https://www.aceetf.co.kr/fund/K55101EN6525
- LQD: https://www.ishares.com/us/products/239566/ishares-iboxx-investment-grade-corporate-bond-etf
- KODEX 만기매칭: https://m.samsungfund.com/sheet/20250204/2ETFP7_20250131.pdf
- KODEX 종목 목록: https://www.samsungfund.com/etf/lounge/notice-view.do?no=71913

## 3. 모델·가정

1년 총수익 근사(명시적 라벨):

`≈ YTM 캐리/롤 − (YTM에 미반영 보수) − duration×Δ금리 − spreadDuration×Δ스프레드`

- 기본: 금리·스프레드 유지(Δ=0)
- 분배수익률을 YTM 총수익에 재가산하지 않음
- 분배 근거 없으면 총수익만 유지하고 가격/분배/관련 세금은 미확정
- 미실현 주가손익 ≠ 실현 매매손익
- ETF에는 액면×쿠폰·미수이자 미적용
- 결측 종목 수익률을 0%로 두거나 비중 재정규화하지 않음

세금: 국내 상장 채권 ETF vs 해외 상장 LQD 경로를 `legalKind=bond_etf` + listing으로 구분. 개별 채권 이자 과세·국내 개별주식 규칙을 그대로 재사용하지 않음. 세율·공제는 법령/국세청/투자설명서 재검증 전 임의 고정하지 않음.

## 4. 마이그레이션

- 실보유·체결·승인 IPS: ETF로 자동 이관하지 않음
- 미승인 초안의 `BOND-KEPCO`/`BOND-GOOGL`: UI에서 비중 유지·ETF 재선택(수량 미복사)
- `273130` 명칭만 잘못된 경우: 코드·원가 유지, 라벨 정정

## 5. 향후 작업(범위 외)

- 개별 한전채·Alphabet 회차 검색, OTC 호가, YTM/YTW 엔진, TRACE
- 발행사 공시 DOM/API 자동 수집(라이선스·인증 필요 시 PB 확인 입력 유지)
- 만기매칭 청산 후 자동 차기 ETF 매수 제안

## 6. 검증

단위 테스트: 카탈로그 정체성, 시나리오 2.9% 픽스처, 손익 50,000원 픽스처, 가중 6.6%, selection 라우팅, 레거시 재선택.  
브라우저·인쇄·Vercel 라이브 시세는 환경·계정에 따라 부분 검증(아래 최종 보고서 참고).

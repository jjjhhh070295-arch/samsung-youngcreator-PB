# 세전·세후 / 예·적금 / 종합과세 규칙 메모

조회일: 2026-09-09. 귀속연도·시행일을 재확인한 뒤 사용하세요.

## 공식 출처

- S1 [근로소득 계산](https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7873&mi=6594)
- S2 [소득세법 제62조 비교과세](https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029623903)
- S3 [2026 주식 양도소득 안내](https://webtv.nts.go.kr/nts/na/ntt/selectNttInfo.do?mi=2201&nttSn=1353905)
- S4 [주식 양도소득 계산](https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=8800&mi=12274)
- S5 [양도소득세율](https://g.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7711&mi=2312)
- S6 [2026 고배당 분리과세](https://nts.go.kr/nts/na/ntt/selectNttInfo.do?mi=2201&nttSn=1349597)

## 구현 위치

- `lib/tax/koreanResidentTax2026.ts` — 세율·한도·제62조·해외양도 기본공제
- `lib/tax/depositInterest.ts` — 예·적금 이자·원천징수
- `lib/tax/portfolioPreviewTax.ts` — Portfolio preview 기준 세전·세후

## 핵심 가정 (상담용)

- 금융소득 종합과세: **2천만 원 초과** 시 검토. 정확히 2천만 원은 미초과.
- 예·적금 이자 원천징수 참고치: 국세 14% + 지방세 1.4% = 15.4% (원천징수 ≠ 최종세).
- 일반 거주자·비상장대주주 아닌 국내 상장 장내 매도: 주식 양도소득세 **0**.
- 해외주식 양도 시뮬레이션: 연 250만 원 기본공제 1회, 일반 외국법인 주식 22%(국세 20+지방 2).
- 배당이 포함된 총수익에 배당을 다시 더하지 않음.
- 법인·비거주·특수계좌는 개인 규칙을 강제하지 않고 세무사 확인으로 보냄.

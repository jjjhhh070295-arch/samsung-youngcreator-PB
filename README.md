# KIS Regime Trader

독립 트레이딩 앱 — 삼성증권 PB Insight와 분리됨.

## 국면 규칙

| 국면 | 동작 |
|------|------|
| 상승장 | 기존 3양봉 · 최대 3종목 · 수량 100% |
| 횡보장 | 최대 1종목 · 과열 제외 · 수량 50% |
| 하락장 | 신규매수 중단 · 현금 대기 |

매수 미리보기(`/api/trading/kis/preview`)와 실주문(`/api/trading/kis/orders`)에 **강제 게이트**가 걸려 있습니다.
런타임 국면은 `GET /api/regime` (Yahoo KOSPI `^KS11` 완료 일봉).

## 로컬

```bash
cp .env.local.example .env.local
npm install
npm run dev
```

http://localhost:3000

기본 `KIS_LIVE_TRADING_ENABLED=false` (fail-closed). 테스트는 KIS 네트워크를 mock합니다.

## PB Insight 백업

이전 PB 앱은 GitHub 브랜치 `pb-insight-backup`에 보관되어 있습니다.

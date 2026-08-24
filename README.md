# KIS Regime Trader — 자동매매

스크리닝 → 국면 게이트 → 3양봉 진입 / 2음봉 청산 루프.

## 자동매매 사용

1. http://localhost:3000 상단 **Auto Trader**
2. **dry-run 무장 + 자동틱** → 주기적으로 사이클 실행 (실주문 없음)
3. **지금 1회 실행** → 즉시 1사이클
4. 실주문: `.env.local`에 `KIS_LIVE_TRADING_ENABLED=true` + **LIVE 무장**

| 국면 | 동작 |
|------|------|
| 상승장 | 3양봉 · 최대 3 · 수량 100% |
| 횡보장 | 최대 1 · 과열 제외 · 수량 50% |
| 하락장 | 신규매수 중단 |

API: `POST /api/strategy/auto/run`, `GET|POST /api/strategy/auto/status`

## 로컬

```bash
cp .env.local.example .env.local
npm install
npm run dev
```

PB Insight 백업: `pb-insight-backup`

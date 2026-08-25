# kis-regime-trader

한투 API 국내주식 자동매매 (PB Insight와 **완전 분리**).

## 실행

```bash
npm run dev          # 웹 UI
npm run worker:dev   # 독립 Worker (브라우저 없이도 동작)
```

관리자: http://localhost:3000/admin  
사용 방법: 화면 오른쪽 위 버튼

## 실매매 기본값

- `KIS_LIVE_TRADING_ENABLED=false`
- `STRATEGY_SCHEDULER_ENABLED=false`
- `TRADING_EXCHANGE_MODE=SOR`

## Docker

```bash
docker compose up -d --build
```

PB Insight Vercel에는 배포하지 마세요.

자세한 운영: `docs/OPERATIONS_GUIDE_KO.md`

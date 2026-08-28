# KIS Signal Trader

한투 API 국내주식 자동매매 (PB Insight와 **완전 분리**).

## 현재 매매 규칙

- 시장 상승장·횡보장·하락장 판정 없음
- 선별 종목이 3일 이상 연속 양봉이면 종가 기준 지정가 매수
- 매수 직전에 한투 `미수 없는 매수가능수량`을 조회해 주문가능현금 전액 사용
- 자동매매 포지션이 2일 이상 연속 음봉이면 한투 `주문가능수량` 전량 매도
- 계좌에 별도로 보유한 수동 종목은 자동매매가 임의로 매도하지 않음

## 실행

```bash
npm run dev          # 웹 UI
npm run worker:dev   # 독립 Worker (브라우저 없이도 동작)
```

관리자: http://localhost:3000/admin  
사용 방법: 화면 오른쪽 위 버튼

웹과 Worker는 별도 터미널에서 함께 실행해야 합니다. 웹 브라우저를 닫아도 Worker가 살아 있으면 검사는 계속됩니다.

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

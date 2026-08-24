# KIS Regime Trader

국장 스크리닝 + 3양봉 전략 + 시장 국면 강제 게이트 + KIS 실전주문( fail-closed ).

## 플로우

1. 상승률 상위 70 (KIS 조건검색 / 데모 유니버스)
2. 시총 2조 · 완료일봉 기술필터 · 테마
3. 시총 상위 최대 3종목 체크 → **후보 확정**
4. 런타임 KOSPI 국면 게이트 후 미리보기/실주문

| 국면 | 동작 |
|------|------|
| 상승장 | 3양봉 · 최대 3 · 수량 100% |
| 횡보장 | 최대 1 · 과열 제외 · 수량 50% |
| 하락장 | 신규매수 중단 |

## 로컬

```bash
cp .env.local.example .env.local
npm install
npm run dev
```

http://localhost:3000

- `TRADING_DEMO_MODE=true` (또는 KIS 키 없음) → 데모 유니버스로 전체 UI 동작
- 실전: `KIS_APP_KEY/SECRET`, `KIS_CONDITION_SEQ`, `KIS_LIVE_TRADING_ENABLED=true` (기본 false)

PB Insight 백업: 브랜치 `pb-insight-backup`

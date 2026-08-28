# 매매 프로그램 운영 가이드 (초보자용)

## 이 프로그램은 뭔가요?
한투 API로 국내주식을 조건에 따라 자동으로 사고파는 **별도 서비스**입니다.
PB Insight(삼성증권 자문 사이트)와는 다른 프로그램입니다.

## 꼭 알아야 할 것
1. 브라우저를 닫아도 **Worker**가 서버에서 켜져 있으면 자동매매 검사는 계속됩니다.
2. Worker가 꺼져 있으면 주문이 나가지 않습니다.
3. 기본은 실매매 OFF 입니다.
4. 주문 접수 ≠ 체결 완료 입니다.
5. 시장 국면 조건은 사용하지 않습니다.
6. 3양봉 매수는 미수 없는 주문가능현금을 전부 사용하고, 2음봉 매도는 해당 자동매매 종목의 주문가능수량을 전부 팝니다.

## 로컬에서 켜는 방법
```bash
cd kis-regime-trader
cp .env.local.example .env.local
npm install
npm run dev          # 웹 화면
npm run worker:dev   # 자동매매 Worker (별도 터미널)
```
웹: http://localhost:3000
관리자: http://localhost:3000/admin

## 서버(항상 켜짐) 배포
```bash
docker compose up -d --build
```
- `web`: 화면
- `worker`: 자동매매

PB Insight Vercel에는 배포하지 마세요.

## 처음 사용 순서
1. 관리자 화면에서 Worker 온라인 확인
2. 계좌 동기화
3. 거래일/세션 확인
4. 종목 선별 → 손익비 확인 → 포트폴리오 확정
5. 위험한도 설정
6. 확인 문구 입력 후 자동매매 켜기

## 장애가 나면
- Worker 오프라인: `npm run worker` 또는 docker worker 재시작
- 계좌 불일치: 자동매매 끄고 관리자에서 재동기화
- 휴장일: 주문이 차단되는 것이 정상입니다

// 모닝 브리핑 웹 검색 차단 목록 — 나중에 늘릴 때 이 배열만 수정하면 된다.
//
// 왜 도구에서 막는가: 프롬프트의 [출처 기준]은 모델의 자체 점검에 의존하는데,
// effort 를 medium 으로 낮춘 2026-09-04 실측에서 그 점검이 헐거워졌다. 출처 8개 중
// vegannews.co.kr(채식 전문 매체가 FOMC 일정 출처), benzinga.com/quote/CCJ(기사가
// 아닌 종목 시세 페이지) 등 프롬프트가 명시적으로 금지한 곳이 섞여 나왔다.
// effort 를 high 로 되돌리면 규율은 돌아오지만 소요시간이 약 395초로 maxDuration(300)을
// 넘는다 — Hobby 플랜에서는 선택지가 아니다.
//
// allowed_domains(화이트리스트) 대신 blocked_domains 를 쓰는 이유: 화이트리스트는
// 목록 밖 도메인에만 있는 사실을 영영 못 찾게 만든다. 지금은 Top Pick 목표주가가
// 9/9 공란인 상태라 검색을 더 굶기는 쪽이 위험이 크다. 차단 목록은 관측된 불량처만
// 제거하므로 굶을 위험이 사실상 없다. 대신 사후 대응이라 새 불량 도메인이 나오면
// 여기에 계속 추가해야 한다.
//
// ⚠️ allowed_domains 와 동시 사용은 불가하다(API 제약). 서브도메인은 자동 포함이라
//    "benzinga.com" 이 "kr.benzinga.com" 까지 덮는다.

export const BRIEFING_BLOCKED_DOMAINS: string[] = [
  // ── 실측에서 실제로 인용된 불량처 (2026-09-04) ──
  "vegannews.co.kr", // 채식 전문 매체 — FOMC 일정 출처로 인용됨
  "benzinga.com", // kr.benzinga.com/quote/CCJ — 기사가 아닌 종목 시세 페이지
  "investing.com", // 시세 요약 사이트
  "stockanalysis.com", // 종목정보 요약 — 운영 주체 불명
  "wikitree.co.kr", // 연예·이슈 중심 콘텐츠 매체
  "kbthink.com", // KB금융 자체 마케팅 콘텐츠 — [출처 기준]의 "증권사 마케팅 페이지"
  "huffingtonpost.kr", // A회차에서 방산 섹터 근거로 인용됨 — 경제 리서치 출처로 부적절

  // ── 개인 게시물·블로그 플랫폼 ── [출처 기준] "개인 블로그, 브런치·티스토리·미디엄"
  "tistory.com",
  "blog.naver.com",
  "post.naver.com",
  "cafe.naver.com",
  "brunch.co.kr",
  "medium.com",
  "velog.io",
  "blog.daum.net",
  "seekingalpha.com", // 개인 기고 중심
  "fool.com", // Motley Fool — 마케팅성 투자 콘텐츠

  // ── 커뮤니티·토론방 ── [출처 기준] "커뮤니티 게시판·토론방"
  "dcinside.com",
  "fmkorea.com",
  "clien.net",
  "ppomppu.co.kr",
  "ruliweb.com",
  "bobaedream.co.kr",
  "stocktwits.com",
  "reddit.com",

  // ── 시세 요약·목표가 예측 SEO 페이지 ── [출처 기준] "주가 전망/목표주가 예측 류"
  "finance.yahoo.com", // /quote/ 시세 페이지 — C회차 진단에 등장
  // E회차(차단 목록 적용 후)에서 새로 인용된 곳. 기존 불량처를 막으니 같은 성격의
  // 다른 도메인이 그 자리를 채웠다 — 차단 목록의 구조적 한계(사후 대응)를 보여준다.
  "tickernerd.com", // "VRT Stock Forecast 2026-2027 — Price Targets & Predictions"
  "stockscan.io",
  "coincodex.com",
  "24-7pressrelease.com",
  "marketbeat.com",
  "walletinvestor.com",
  "simplywall.st",
  "wallstreetzen.com",
  "barchart.com",
  "tradingview.com",
  "gurufocus.com",

  // ── CFD·마진거래·해외선물 브로커 ── [출처 기준] 명시 금지
  "plus500.com",
  "etoro.com",
  "avatrade.com",
  "xm.com",
  "capital.com",
  "fxpro.com",
  "oanda.com",
  "cmcmarkets.com",
  "forex.com",
  "ig.com",
];

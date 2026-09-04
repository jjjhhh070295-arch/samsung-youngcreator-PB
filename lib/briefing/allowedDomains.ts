// 모닝 브리핑 웹 검색 화이트리스트 — 나중에 늘릴 때 이 배열만 수정하면 된다.
//
// 왜 도구에서 막는가: 프롬프트의 [출처 기준]은 모델의 자체 점검에 의존하는데,
// effort 를 medium 으로 낮춘 2026-09-04 실측에서 그 점검이 헐거워졌다.
// effort 를 high 로 되돌리면 규율은 돌아오지만 소요시간이 약 395초로 maxDuration(300)을
// 넘는다 — Hobby 플랜에서는 선택지가 아니다.
//
// 왜 차단 목록이 아니라 화이트리스트인가: blocked_domains 를 먼저 시도했는데(43개),
// 첫 실행에서 기존 불량처는 걷혔지만 같은 성격의 새 도메인이 그대로 그 자리를 채웠다
// (tickernerd.com 의 "Stock Forecast · Price Targets & Predictions" 페이지).
// 목표주가 SEO 페이지는 사실상 무한히 생성되므로 차단 목록으로는 못 이긴다.
//
// 화이트리스트의 위험은 검색이 굶는 것이다. 그래서 좁게 잡지 않고 99개로 넓게 잡되,
// **목표주가가 실제로 보도되는 곳**을 우선했다 — Top Pick 목표가 공란이 지금 최대 병목이라
// 이 목록의 성패는 거기서 갈린다. 서브도메인은 자동 포함이다
// (hankyung.com 이 consensus.hankyung.com 을, krx.co.kr 이 kind.krx.co.kr 을 덮는다).
//
// allowed_domains 와 blocked_domains 는 동시 사용 불가다(API 제약).

export const BRIEFING_ALLOWED_DOMAINS: string[] = [
  // ══ 국내 통신사·금융 데이터 ══
  "yonhapinfomax.co.kr", // 연합인포맥스 — 금리·환율·채권
  "newsis.com", // 뉴시스
  "newspim.com", // 뉴스핌

  // ══ 국내 경제지 ══ 목표주가 보도의 주력
  "hankyung.com", // 한국경제 — consensus.hankyung.com(증권사 리포트 아카이브) 포함
  "mt.co.kr", // 머니투데이
  "moneys.co.kr", // 머니S
  "edaily.co.kr", // 이데일리
  "sedaily.com", // 서울경제
  "fnnews.com", // 파이낸셜뉴스
  "asiae.co.kr", // 아시아경제
  "heraldcorp.com", // 헤럴드경제
  "etoday.co.kr", // 이투데이
  "ajunews.com", // 아주경제
  "businesspost.co.kr", // 비즈니스포스트 — 증권사 리포트 인용 보도가 특히 많다
  "thebell.co.kr", // 더벨 — 자본시장 전문
  "investchosun.com", // 인베스트조선 — 자본시장
  "dealsite.co.kr", // 딜사이트 — 자본시장
  "seoulfn.com", // 서울파이낸스
  "businesskorea.co.kr",
  "theguru.co.kr", // 더구루 — 해외 산업·수주

  // ══ 국내 일반지(경제면) ══ 프롬프트 [출처 기준]이 일반지도 인정한다
  "khan.co.kr",

  // ══ 국내 지역 경제지 ══
  // 목표주가 보도는 드물다. 지역 산업(부산 조선·해운, 대구 섬유 등) 기사에만 값이 있어
  // 실효는 낮지만 배제할 이유도 없어 주요 2곳만 넣는다.
  "busan.com", // 부산일보
  "kookje.co.kr", // 국제신문

  // ══ 국내 산업 전문지 ══ 섹터(반도체·전력·방산·원전) 커버리지의 핵심
  "etnews.com", // 전자신문 — 반도체·IT 1차 매체
  "thelec.kr", // 더일렉 — 반도체·디스플레이 공정
  "kipost.net", // 키포스트 — 반도체 소부장
  "ddaily.co.kr", // 디지털데일리
  "inews24.com", // 아이뉴스24
  "zdnet.co.kr", // ZDNet Korea
  "dt.co.kr", // 디지털타임스
  "electimes.com", // 전기신문 — 전력기기 섹터
  "ekn.kr", // 에너지경제
  "dailypharm.com", // 데일리팜 — 제약
  "biospectator.com", // 바이오스펙테이터 — 바이오 목표주가 보도 다수
  "hitnews.co.kr", // 히트뉴스 — 제약바이오

  // ══ 증권사 자체 리서치 ══ 목표주가 1차 출처
  // ⚠️ 정식 리포트 PDF 는 로그인·유료가 많아 검색 결과에 본문이 안 잡힐 수 있다.
  //    공개된 리서치 요약·투자전략 페이지를 노린다. 프롬프트 [리서치 규칙]의
  //    "PDF 는 시도하지 말라"는 문장도 이에 맞춰 함께 손봤다.
  "securities.miraeasset.com", // 미래에셋증권
  "samsungpop.com", // 삼성증권
  "nhqv.com", // NH투자증권
  "kbsec.com", // KB증권
  "truefriend.com", // 한국투자증권
  "shinhansec.com", // 신한투자증권
  "kiwoom.com", // 키움증권
  "hanaw.com", // 하나증권
  "daishin.com", // 대신증권
  "meritz.co.kr", // 메리츠증권
  "myasset.com", // 유안타증권
  "iprovest.com", // 교보증권
  "hi-ib.com", // 하이투자증권
  "ibks.com", // IBK투자증권
  "sks.co.kr", // SK증권
  "hmsec.com", // 현대차증권

  // ══ 공식 기관 ══ 확정된 공개 일정·공시·통계
  // 프롬프트가 "FOMC 등은 '데이터 확인 안 됨'이 나와서는 안 된다"고 못박고 있어
  // 여기가 빠지면 그 지시가 구조적으로 실패한다. E회차 이전에 vegannews.co.kr 가
  // FOMC 일정 출처로 인용된 것이 정확히 이 공백 때문이었다.
  "federalreserve.gov", // FOMC·점도표
  "bls.gov", // 미 고용지표
  "bea.gov", // 미 GDP·물가
  "treasury.gov", // 미 국채 금리
  "eia.gov", // 미 에너지정보청 — WTI·천연가스(지금 계속 공란인 항목)
  "sec.gov", // 미 공시
  "nrc.gov", // 미 원자력규제위 — 원전 섹터
  "energy.gov",
  "bok.or.kr", // 한국은행 금통위
  "krx.co.kr", // 한국거래소 — kind.krx.co.kr(공시) 포함
  "fss.or.kr", // 금감원 — dart.fss.or.kr(전자공시) 포함
  "kosis.kr", // 국가통계포털
  "moef.go.kr", // 기획재정부
  "motie.go.kr", // 산업통상자원부
  "kpx.or.kr", // 전력거래소
  "ecb.europa.eu", // ECB

  // ══ 해외 통신사·경제지 ══
  "bloomberg.com",
  "cnbc.com",
  "nikkei.com", // asia.nikkei.com 포함
  "scmp.com",
  "koreaherald.com",
  "koreatimes.co.kr",

  // ══ 해외 산업 전문지 ══ 섹터 커버리지
  "digitimes.com", // 대만 반도체 공급망 — TSMC·파운드리
  "trendforce.com", // 시장조사 — HBM 점유율 1차 출처
  "eetimes.com", // 반도체
  "semianalysis.com", // 반도체 심층 분석
  "datacenterdynamics.com", // 데이터센터 전력 — VRT·GEV
  "utilitydive.com", // 전력 유틸리티
  "world-nuclear-news.org", // 원전·우라늄 섹터
  "defensenews.com", // 방산
  "breakingdefense.com", // 방산
  "janes.com", // 방산
  "fiercebiotech.com", // 바이오
  "endpts.com", // Endpoints News — 바이오

  // ══ 신용평가·지수 ══
  "spglobal.com",
];

// ── 크롤러 차단으로 쓸 수 없는 도메인 (다시 넣지 말 것) ──
// 아래 13곳은 Anthropic 크롤러를 robots 등으로 막고 있어 allowed_domains 에 넣으면
// 요청 자체가 400 으로 거부된다("The following domains are not accessible to our
// user agent"). 2026-09-04 실측으로 확인했다.
//
//   국내: yna.co.kr(연합뉴스) mk.co.kr(매일경제) chosun.com joongang.co.kr
//         donga.com hani.co.kr
//   해외: reuters.com apnews.com wsj.com ft.com barrons.com marketwatch.com
//         economist.com
//
// 품질이 가장 높은 축이 통째로 빠진다는 뜻이다. 지금까지 리포트가 2군 매체를 인용해 온
// 이유가 모델의 판단력 문제만이 아니라 이 접근 제약 때문이기도 하다 — 화이트리스트를
// 어떻게 짜든 이 13곳은 애초에 검색 결과에 나올 수 없다.

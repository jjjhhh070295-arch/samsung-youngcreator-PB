import type { ActualReport, ActualPick } from './actualTopPickView';

/** Public originals reviewed on a fixed date. Not a recommendation, feed, permission or auto-refresh. */
export const AS_OF = '2026-09-08';
export const WINDOW_START = '2026-08-08';
export const REPORTS: ActualReport[] = [
  {
    "id": "samsung-20260831-strategy",
    "title": "한국 증시 전망과 전략 — ’26년 9월: 펀더멘털 이상으로 중요해질 수급",
    "institution": "삼성증권",
    "institutionGroup": "samsung",
    "desk": "글로벌투자전략팀",
    "authors": [
      "양일우",
      "박주란"
    ],
    "publishedOn": "2026-08-31",
    "verifiedAt": "2026-09-08T06:43:45Z",
    "sourceUrl": "https://www.samsungpop.com/common.do?cmd=down&contentType=application/pdf&inlineYn=Y&saveKey=research.pdf&fileName=1010/2026083116512935K_02_02.pdf",
    "sourceHash": "b26ece7e1a09ab9bf94d7f5b98d07a880843e7751dd94c6f787b3bbabf2ebaf7",
    "sourceKind": "pdf",
    "rightsStatus": "unconfirmed",
    "accessNote": "공개 원문 열람을 확인했습니다. 링크의 지속성·재이용 허가는 보장하지 않습니다.",
    "warnings": []
  },
  {
    "id": "shinhan-20260828-top-picks",
    "title": "9월 해외주식 탑픽 10선",
    "institution": "신한투자증권",
    "institutionGroup": "domestic_other",
    "desk": "해외주식팀",
    "authors": [
      "최원석",
      "이주은",
      "김성환",
      "김형태",
      "함형도",
      "하헌호",
      "심지현",
      "고준혁",
      "전규은"
    ],
    "publishedOn": "2026-08-28",
    "verifiedAt": "2026-09-08T06:43:45Z",
    "sourceUrl": "https://bbs2.shinhansec.com/board/message/file.pdf.do?attachmentId=353571",
    "sourceHash": "a370028627fc98a5b529488f8d61173ee082fb6a39b52575094093c433544605",
    "sourceKind": "pdf",
    "rightsStatus": "unconfirmed",
    "accessNote": "공개 원문 열람을 확인했습니다. 링크의 지속성·재이용 허가는 보장하지 않습니다.",
    "warnings": [
      "종목·코드는 원문 표기이며 거래소 종목 마스터와의 대조는 미완료입니다."
    ]
  },
  {
    "id": "kb-20260814-semiconductors",
    "title": "반도체: 우려의 소멸, 재평가 시작",
    "institution": "KB증권",
    "institutionGroup": "domestic_other",
    "desk": "반도체/전기전자",
    "authors": [
      "김동원",
      "이창민",
      "강다현"
    ],
    "publishedOn": "2026-08-14",
    "verifiedAt": "2026-09-08T06:43:45Z",
    "sourceUrl": "https://rdata.kbsec.com/pdf_data/20260813183653443K.pdf",
    "sourceHash": "8d7f7e947cd813d877080c2cea4e95a5aa99cf3bfc8d377b3f41a9914477457b",
    "sourceKind": "pdf",
    "rightsStatus": "unconfirmed",
    "accessNote": "공개 원문 열람을 확인했습니다. 링크의 지속성·재이용 허가는 보장하지 않습니다.",
    "warnings": []
  },
  {
    "id": "hana-20260901-bio",
    "title": "하나 Biweekly 제약/바이오(9월 초): 때가 되면 이벤트가 있었던 종목부터 오른다",
    "institution": "하나증권",
    "institutionGroup": "domestic_other",
    "desk": "제약/바이오",
    "authors": [
      "김선아",
      "이희경(RA)"
    ],
    "publishedOn": "2026-09-01",
    "verifiedAt": "2026-09-08T06:43:45Z",
    "sourceUrl": "https://file.hanaw.com/download/research/FileServer/WEB/industry/industry/2026/08/31/Bio_biweekly_260901.pdf",
    "sourceHash": "2f4ea30ca094346f9138031e81fea766ac0a34ea236fcc876ed11ea0c0b31e1a",
    "sourceKind": "pdf",
    "rightsStatus": "unconfirmed",
    "accessNote": "공개 원문 열람을 확인했습니다. 링크의 지속성·재이용 허가는 보장하지 않습니다.",
    "warnings": []
  },
  {
    "id": "hana-20260901-construction",
    "title": "국내 투자의 확대에 건설 수혜(DC/LH)",
    "institution": "하나증권",
    "institutionGroup": "domestic_other",
    "desk": "건설",
    "authors": [
      "김승준",
      "하민호"
    ],
    "publishedOn": "2026-09-01",
    "verifiedAt": "2026-09-08T06:43:45Z",
    "sourceUrl": "https://file.hanaw.com/download/research/FileServer/WEB/industry/industry/2026/08/31/Con_Weekly_260901.pdf",
    "sourceHash": "d86c7f07411ed4d1c958be0644b5838d0cca675db8ecc826fc73e4ff289b2504",
    "sourceKind": "pdf",
    "rightsStatus": "unconfirmed",
    "accessNote": "공개 원문 열람을 확인했습니다. 링크의 지속성·재이용 허가는 보장하지 않습니다.",
    "warnings": []
  },
  {
    "id": "hana-20260907-energy-chemicals",
    "title": "에너지/화학 Weekly Monitor: 미국 디젤 사상 최대 vs. 10월 사우디 OSP -2$",
    "institution": "하나증권",
    "institutionGroup": "domestic_other",
    "desk": "에너지/화학",
    "authors": [
      "윤재성",
      "김형준(RA)"
    ],
    "publishedOn": "2026-09-07",
    "verifiedAt": "2026-09-08T06:43:45Z",
    "sourceUrl": "https://file.hanaw.com/download/research/FileServer/WEB/industry/industry/2026/09/05/Energy_Petchem_Weekly_20260907_F.pdf",
    "sourceHash": "7885d9cd646be6614b51b213f4eeacdf5991e1fa1f8ed6351edb4c35e1dd6ef0",
    "sourceKind": "pdf",
    "rightsStatus": "unconfirmed",
    "accessNote": "공개 원문 열람을 확인했습니다. 링크의 지속성·재이용 허가는 보장하지 않습니다.",
    "warnings": []
  },
  {
    "id": "kgi-20260814",
    "title": "Our Top Picks Today: Stocks — 14 August 2026",
    "institution": "KGI Securities (Singapore)",
    "institutionGroup": "foreign",
    "desk": "KGI Research / Daily Trading Ideas",
    "authors": [],
    "publishedOn": "2026-08-14",
    "verifiedAt": "2026-09-08T06:43:45Z",
    "sourceUrl": "https://www.kgieworld.sg/research/our-top-picks-today-stocks-14-august-2026/",
    "sourceHash": "64240b6f11c1c8f312a9b4c2951219596aa0cedd0de499628c1176845d43371c",
    "sourceKind": "html",
    "rightsStatus": "unconfirmed",
    "accessNote": "공개 원문 열람을 확인했습니다. 링크의 지속성·재이용 허가는 보장하지 않습니다.",
    "warnings": [
      "일간 발간 주기는 권고 보유기간이 아닙니다. 이후 철회·수정 전체를 추적하는 기능은 아직 없습니다.",
      "공식 Research Disclaimer는 전부·일부 복제와 재배포 등에 사전 서면동의를 요구합니다. 승인 확보 여부는 미확인입니다. https://www.kgieworld.sg/securities/kgi-research-disclaimer/"
    ]
  },
  {
    "id": "kgi-20260817",
    "title": "Our Top Picks Today: Stocks — 17 August 2026",
    "institution": "KGI Securities (Singapore)",
    "institutionGroup": "foreign",
    "desk": "KGI Research / Daily Trading Ideas",
    "authors": [],
    "publishedOn": "2026-08-17",
    "verifiedAt": "2026-09-08T06:43:45Z",
    "sourceUrl": "https://www.kgieworld.sg/research/our-top-picks-today-stocks-17-august-2026/",
    "sourceHash": "48040c7955de02eb3979923a33e0f03213cc367eded36c9da6c797ca480e51dc",
    "sourceKind": "html",
    "rightsStatus": "unconfirmed",
    "accessNote": "공개 원문 열람을 확인했습니다. 링크의 지속성·재이용 허가는 보장하지 않습니다.",
    "warnings": [
      "일간 발간 주기는 권고 보유기간이 아닙니다. 이후 철회·수정 전체를 추적하는 기능은 아직 없습니다.",
      "공식 Research Disclaimer는 전부·일부 복제와 재배포 등에 사전 서면동의를 요구합니다. 승인 확보 여부는 미확인입니다. https://www.kgieworld.sg/securities/kgi-research-disclaimer/"
    ]
  },
  {
    "id": "kgi-20260826",
    "title": "Our Top Picks Today: Stocks — 26 August 2026",
    "institution": "KGI Securities (Singapore)",
    "institutionGroup": "foreign",
    "desk": "KGI Research / Daily Trading Ideas",
    "authors": [],
    "publishedOn": "2026-08-26",
    "verifiedAt": "2026-09-08T06:43:45Z",
    "sourceUrl": "https://www.kgieworld.sg/research/our-top-picks-today-stocks-26-august-2026/",
    "sourceHash": "8b821c565422ddc3280abbb998155bc11a271c45771e51faa9f4087824ccf8d5",
    "sourceKind": "html",
    "rightsStatus": "unconfirmed",
    "accessNote": "공개 원문 열람을 확인했습니다. 링크의 지속성·재이용 허가는 보장하지 않습니다.",
    "warnings": [
      "일간 발간 주기는 권고 보유기간이 아닙니다. 이후 철회·수정 전체를 추적하는 기능은 아직 없습니다.",
      "공식 Research Disclaimer는 전부·일부 복제와 재배포 등에 사전 서면동의를 요구합니다. 승인 확보 여부는 미확인입니다. https://www.kgieworld.sg/securities/kgi-research-disclaimer/"
    ]
  },
  {
    "id": "axis-20260907-prime",
    "title": "PRIME RESEARCH SERVICES — High Growth & QARP Stock Ideas",
    "institution": "Axis Securities Limited",
    "institutionGroup": "foreign",
    "desk": "Private Client Group",
    "authors": [],
    "publishedOn": "2026-09-07",
    "verifiedAt": "2026-09-08T06:51:00Z",
    "sourceHash": "ff1edf18d08192946b2f70a646b784e3aae746599f377e0276ad8dfad5ae2c2b",
    "sourceUrl": "https://simplehai.axisdirect.in/app/index.php/insights/reports/downloadReport/file/Prime%2BResearch%2Band%2BServices%2BCAT3%2B-%2B7th%2BSept%2B2026_07-09-2026_11.pdf/type/fundamental",
    "sourceKind": "pdf",
    "rightsStatus": "unconfirmed",
    "accessNote": "발행일 필드는 공식 포털 게시일 9월 7일입니다. 표지에는 2026년 9월, 선정 표에는 8월 31일 기준으로 표시되어 있습니다.",
    "warnings": [
      "38쪽에 인도 거주자 대상이라고 명시되어 있습니다. 한국 고객 제공·앱 공개 이용은 보류합니다.",
      "37쪽은 복제·배포 등에 사전 서면동의를 요구합니다. 2~3년은 바스켓 투자기간이며 개인별 보유기간이나 만료일이 아닙니다."
    ]
  }
];

/** Minimal attribution facts only; no report binaries, full text, invented codes or returns. */
export const PICKS: ActualPick[] = [
  {
    "id": "samsung-20260831-strategy-01",
    "reportId": "samsung-20260831-strategy",
    "name": "삼성전자",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "2026년 9월 전략 보고서입니다. 월간 전략 대상기간을 개별 종목의 단기 보유기간으로 간주하지 않았습니다.",
    "sector": "반도체",
    "selectionLabel": "Top 10 picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 17,
    "locator": "Top picks 문단 및 ‘목표주가와 주가 수익률 (Top 10 picks)’ 표",
    "status": "recorded"
  },
  {
    "id": "samsung-20260831-strategy-02",
    "reportId": "samsung-20260831-strategy",
    "name": "SK하이닉스",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "2026년 9월 전략 보고서입니다. 월간 전략 대상기간을 개별 종목의 단기 보유기간으로 간주하지 않았습니다.",
    "sector": "반도체",
    "selectionLabel": "Top 10 picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 17,
    "locator": "Top picks 문단 및 ‘목표주가와 주가 수익률 (Top 10 picks)’ 표",
    "status": "recorded"
  },
  {
    "id": "samsung-20260831-strategy-03",
    "reportId": "samsung-20260831-strategy",
    "name": "삼성전기",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "2026년 9월 전략 보고서입니다. 월간 전략 대상기간을 개별 종목의 단기 보유기간으로 간주하지 않았습니다.",
    "sector": "IT하드웨어",
    "selectionLabel": "Top 10 picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 17,
    "locator": "Top picks 문단 및 ‘목표주가와 주가 수익률 (Top 10 picks)’ 표",
    "status": "recorded"
  },
  {
    "id": "samsung-20260831-strategy-04",
    "reportId": "samsung-20260831-strategy",
    "name": "HD현대중공업",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "2026년 9월 전략 보고서입니다. 월간 전략 대상기간을 개별 종목의 단기 보유기간으로 간주하지 않았습니다.",
    "sector": "조선",
    "selectionLabel": "Top 10 picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 17,
    "locator": "Top picks 문단 및 ‘목표주가와 주가 수익률 (Top 10 picks)’ 표",
    "status": "recorded"
  },
  {
    "id": "samsung-20260831-strategy-05",
    "reportId": "samsung-20260831-strategy",
    "name": "두산에너빌리티",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "2026년 9월 전략 보고서입니다. 월간 전략 대상기간을 개별 종목의 단기 보유기간으로 간주하지 않았습니다.",
    "sector": "기계",
    "selectionLabel": "Top 10 picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 17,
    "locator": "Top picks 문단 및 ‘목표주가와 주가 수익률 (Top 10 picks)’ 표",
    "status": "recorded"
  },
  {
    "id": "samsung-20260831-strategy-06",
    "reportId": "samsung-20260831-strategy",
    "name": "SK텔레콤",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "2026년 9월 전략 보고서입니다. 월간 전략 대상기간을 개별 종목의 단기 보유기간으로 간주하지 않았습니다.",
    "sector": "통신서비스",
    "selectionLabel": "Top 10 picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 17,
    "locator": "Top picks 문단 및 ‘목표주가와 주가 수익률 (Top 10 picks)’ 표",
    "status": "recorded"
  },
  {
    "id": "samsung-20260831-strategy-07",
    "reportId": "samsung-20260831-strategy",
    "name": "NH투자증권",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "2026년 9월 전략 보고서입니다. 월간 전략 대상기간을 개별 종목의 단기 보유기간으로 간주하지 않았습니다.",
    "sector": "증권",
    "selectionLabel": "Top 10 picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 17,
    "locator": "Top picks 문단 및 ‘목표주가와 주가 수익률 (Top 10 picks)’ 표",
    "status": "recorded"
  },
  {
    "id": "samsung-20260831-strategy-08",
    "reportId": "samsung-20260831-strategy",
    "name": "삼성E&A",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "2026년 9월 전략 보고서입니다. 월간 전략 대상기간을 개별 종목의 단기 보유기간으로 간주하지 않았습니다.",
    "sector": "건설·건축관련",
    "selectionLabel": "Top 10 picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 17,
    "locator": "Top picks 문단 및 ‘목표주가와 주가 수익률 (Top 10 picks)’ 표",
    "status": "recorded"
  },
  {
    "id": "samsung-20260831-strategy-09",
    "reportId": "samsung-20260831-strategy",
    "name": "HD건설기계",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "2026년 9월 전략 보고서입니다. 월간 전략 대상기간을 개별 종목의 단기 보유기간으로 간주하지 않았습니다.",
    "sector": "기계",
    "selectionLabel": "Top 10 picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 17,
    "locator": "Top picks 문단 및 ‘목표주가와 주가 수익률 (Top 10 picks)’ 표",
    "status": "recorded"
  },
  {
    "id": "samsung-20260831-strategy-10",
    "reportId": "samsung-20260831-strategy",
    "name": "신세계",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "2026년 9월 전략 보고서입니다. 월간 전략 대상기간을 개별 종목의 단기 보유기간으로 간주하지 않았습니다.",
    "sector": "소매(유통)",
    "selectionLabel": "Top 10 picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 17,
    "locator": "Top picks 문단 및 ‘목표주가와 주가 수익률 (Top 10 picks)’ 표",
    "status": "recorded"
  },
  {
    "id": "shinhan-20260828-top-picks-01",
    "reportId": "shinhan-20260828-top-picks",
    "name": "스페이스X",
    "code": "SPCX.US",
    "securityMarket": "US",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "9월 선정 목록이지만 개별 보유기간은 명시되지 않았습니다. 1M·3M 수익률 열은 과거 성과로, 보유기간이 아닙니다.",
    "sector": "AI/우주",
    "selectionLabel": "9월 해외주식 탑픽 10선",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 2,
    "locator": "‘9월 해외주식 탑픽 10선’ 표의 기업명·Ticker·테마 열",
    "status": "recorded"
  },
  {
    "id": "shinhan-20260828-top-picks-02",
    "reportId": "shinhan-20260828-top-picks",
    "name": "델 테크놀로지스",
    "code": "DELL.US",
    "securityMarket": "US",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "9월 선정 목록이지만 개별 보유기간은 명시되지 않았습니다. 1M·3M 수익률 열은 과거 성과로, 보유기간이 아닙니다.",
    "sector": "AI서버",
    "selectionLabel": "9월 해외주식 탑픽 10선",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 2,
    "locator": "‘9월 해외주식 탑픽 10선’ 표의 기업명·Ticker·테마 열",
    "status": "recorded"
  },
  {
    "id": "shinhan-20260828-top-picks-03",
    "reportId": "shinhan-20260828-top-picks",
    "name": "샌디스크",
    "code": "SNDK.US",
    "securityMarket": "US",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "9월 선정 목록이지만 개별 보유기간은 명시되지 않았습니다. 1M·3M 수익률 열은 과거 성과로, 보유기간이 아닙니다.",
    "sector": "메모리반도체",
    "selectionLabel": "9월 해외주식 탑픽 10선",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 2,
    "locator": "‘9월 해외주식 탑픽 10선’ 표의 기업명·Ticker·테마 열",
    "status": "recorded"
  },
  {
    "id": "shinhan-20260828-top-picks-04",
    "reportId": "shinhan-20260828-top-picks",
    "name": "마벨 테크놀로지",
    "code": "MRVL.US",
    "securityMarket": "US",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "9월 선정 목록이지만 개별 보유기간은 명시되지 않았습니다. 1M·3M 수익률 열은 과거 성과로, 보유기간이 아닙니다.",
    "sector": "AI/네트워크",
    "selectionLabel": "9월 해외주식 탑픽 10선",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 2,
    "locator": "‘9월 해외주식 탑픽 10선’ 표의 기업명·Ticker·테마 열",
    "status": "recorded"
  },
  {
    "id": "shinhan-20260828-top-picks-05",
    "reportId": "shinhan-20260828-top-picks",
    "name": "블룸에너지",
    "code": "BE.US",
    "securityMarket": "US",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "9월 선정 목록이지만 개별 보유기간은 명시되지 않았습니다. 1M·3M 수익률 열은 과거 성과로, 보유기간이 아닙니다.",
    "sector": "수소/SOFC",
    "selectionLabel": "9월 해외주식 탑픽 10선",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 2,
    "locator": "‘9월 해외주식 탑픽 10선’ 표의 기업명·Ticker·테마 열",
    "status": "recorded"
  },
  {
    "id": "shinhan-20260828-top-picks-06",
    "reportId": "shinhan-20260828-top-picks",
    "name": "네비우스",
    "code": "NBIS.US",
    "securityMarket": "US",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "9월 선정 목록이지만 개별 보유기간은 명시되지 않았습니다. 1M·3M 수익률 열은 과거 성과로, 보유기간이 아닙니다.",
    "sector": "네오클라우드",
    "selectionLabel": "9월 해외주식 탑픽 10선",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 2,
    "locator": "‘9월 해외주식 탑픽 10선’ 표의 기업명·Ticker·테마 열",
    "status": "recorded"
  },
  {
    "id": "shinhan-20260828-top-picks-07",
    "reportId": "shinhan-20260828-top-picks",
    "name": "템퍼스 AI",
    "code": "TEM.US",
    "securityMarket": "US",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "9월 선정 목록이지만 개별 보유기간은 명시되지 않았습니다. 1M·3M 수익률 열은 과거 성과로, 보유기간이 아닙니다.",
    "sector": "암 백신",
    "selectionLabel": "9월 해외주식 탑픽 10선",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 2,
    "locator": "‘9월 해외주식 탑픽 10선’ 표의 기업명·Ticker·테마 열",
    "status": "recorded"
  },
  {
    "id": "shinhan-20260828-top-picks-08",
    "reportId": "shinhan-20260828-top-picks",
    "name": "로빈후드",
    "code": "HOOD.US",
    "securityMarket": "US",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "9월 선정 목록이지만 개별 보유기간은 명시되지 않았습니다. 1M·3M 수익률 열은 과거 성과로, 보유기간이 아닙니다.",
    "sector": "핀테크/크립토",
    "selectionLabel": "9월 해외주식 탑픽 10선",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 2,
    "locator": "‘9월 해외주식 탑픽 10선’ 표의 기업명·Ticker·테마 열",
    "status": "recorded"
  },
  {
    "id": "shinhan-20260828-top-picks-09",
    "reportId": "shinhan-20260828-top-picks",
    "name": "쇼피파이",
    "code": "SHOP.US",
    "securityMarket": "US",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "9월 선정 목록이지만 개별 보유기간은 명시되지 않았습니다. 1M·3M 수익률 열은 과거 성과로, 보유기간이 아닙니다.",
    "sector": "소비재",
    "selectionLabel": "9월 해외주식 탑픽 10선",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 2,
    "locator": "‘9월 해외주식 탑픽 10선’ 표의 기업명·Ticker·테마 열",
    "status": "recorded"
  },
  {
    "id": "shinhan-20260828-top-picks-10",
    "reportId": "shinhan-20260828-top-picks",
    "name": "과창판 AI 반도체 ETF",
    "code": "588200.SH",
    "securityMarket": "CN",
    "kind": "etf",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "9월 선정 목록이지만 개별 보유기간은 명시되지 않았습니다. 1M·3M 수익률 열은 과거 성과로, 보유기간이 아닙니다.",
    "sector": "AI 반도체",
    "selectionLabel": "9월 해외주식 탑픽 10선",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 2,
    "locator": "‘9월 해외주식 탑픽 10선’ 표의 기업명·Ticker·테마 열",
    "status": "recorded"
  },
  {
    "id": "kb-20260814-semiconductors-01",
    "reportId": "kb-20260814-semiconductors",
    "name": "삼성전자",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": "반도체",
    "selectionLabel": "Top picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 1,
    "locator": "두 번째 소제목 ‘주가 재평가 본격화 기대, Top picks’",
    "status": "recorded"
  },
  {
    "id": "kb-20260814-semiconductors-02",
    "reportId": "kb-20260814-semiconductors",
    "name": "SK하이닉스",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": "반도체",
    "selectionLabel": "Top picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 1,
    "locator": "두 번째 소제목 ‘주가 재평가 본격화 기대, Top picks’",
    "status": "recorded"
  },
  {
    "id": "hana-20260901-bio-01",
    "reportId": "hana-20260901-bio",
    "name": "삼성바이오로직스",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "short",
      "medium-long"
    ],
    "horizonBasis": "같은 선정 문단에서 ‘단기 및 장기적인 관점’이라고 명시했습니다. 일수·만료일은 명시하지 않았습니다.",
    "sector": "제약/바이오",
    "selectionLabel": "9월 코스피 Top pick",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 1,
    "locator": "‘2) 2026년 9월 추천 종목’의 코스피/코스닥 Top pick 문단",
    "status": "recorded"
  },
  {
    "id": "hana-20260901-bio-02",
    "reportId": "hana-20260901-bio",
    "name": "SK바이오팜",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": "제약/바이오",
    "selectionLabel": "9월 코스피 Top pick",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 1,
    "locator": "‘2) 2026년 9월 추천 종목’의 코스피/코스닥 Top pick 문단",
    "status": "recorded"
  },
  {
    "id": "hana-20260901-bio-03",
    "reportId": "hana-20260901-bio",
    "name": "알테오젠",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "같은 선정 문단에서 ‘중장기적으로도 매력적’이라고 명시했습니다. 일수·만료일은 명시하지 않았습니다.",
    "sector": "제약/바이오",
    "selectionLabel": "9월 코스닥 Top pick",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 1,
    "locator": "‘2) 2026년 9월 추천 종목’의 코스피/코스닥 Top pick 문단",
    "status": "recorded"
  },
  {
    "id": "hana-20260901-bio-04",
    "reportId": "hana-20260901-bio",
    "name": "리가켐바이오",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": "제약/바이오",
    "selectionLabel": "9월 코스닥 Top pick",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 1,
    "locator": "‘2) 2026년 9월 추천 종목’의 코스피/코스닥 Top pick 문단",
    "status": "recorded"
  },
  {
    "id": "hana-20260901-construction-01",
    "reportId": "hana-20260901-construction",
    "name": "GS건설",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": "건설",
    "selectionLabel": "TOP PICK",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 1,
    "locator": "본문 마지막 문단의 TOP PICK 선정 문장",
    "status": "recorded"
  },
  {
    "id": "hana-20260907-energy-chemicals-01",
    "reportId": "hana-20260907-energy-chemicals",
    "name": "S-Oil",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": "에너지/화학",
    "selectionLabel": "Top Picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 1,
    "locator": "총평 세 번째 항목의 Top Picks 목록",
    "status": "recorded"
  },
  {
    "id": "hana-20260907-energy-chemicals-02",
    "reportId": "hana-20260907-energy-chemicals",
    "name": "SK이노베이션",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": "에너지/화학",
    "selectionLabel": "Top Picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 1,
    "locator": "총평 세 번째 항목의 Top Picks 목록",
    "status": "recorded"
  },
  {
    "id": "hana-20260907-energy-chemicals-03",
    "reportId": "hana-20260907-energy-chemicals",
    "name": "OCI홀딩스",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": "에너지/화학",
    "selectionLabel": "Top Picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 1,
    "locator": "총평 세 번째 항목의 Top Picks 목록",
    "status": "recorded"
  },
  {
    "id": "hana-20260907-energy-chemicals-04",
    "reportId": "hana-20260907-energy-chemicals",
    "name": "한화솔루션",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": "에너지/화학",
    "selectionLabel": "Top Picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 1,
    "locator": "총평 세 번째 항목의 Top Picks 목록",
    "status": "recorded"
  },
  {
    "id": "hana-20260907-energy-chemicals-05",
    "reportId": "hana-20260907-energy-chemicals",
    "name": "코오롱인더",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": "에너지/화학",
    "selectionLabel": "Top Picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 1,
    "locator": "총평 세 번째 항목의 Top Picks 목록",
    "status": "recorded"
  },
  {
    "id": "hana-20260907-energy-chemicals-06",
    "reportId": "hana-20260907-energy-chemicals",
    "name": "KCC",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": "에너지/화학",
    "selectionLabel": "Top Picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 1,
    "locator": "총평 세 번째 항목의 Top Picks 목록",
    "status": "recorded"
  },
  {
    "id": "hana-20260907-energy-chemicals-07",
    "reportId": "hana-20260907-energy-chemicals",
    "name": "효성티앤씨",
    "code": null,
    "securityMarket": "KR",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": "에너지/화학",
    "selectionLabel": "Top Picks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "표 또는 선정 문단에서 해당 종목의 명시적 Top Pick 선정을 대조했습니다. 목표주가·매수 수량·수익률을 추정하지 않았습니다.",
    "page": 1,
    "locator": "총평 세 번째 항목의 Top Picks 목록",
    "status": "recorded"
  },
  {
    "id": "kgi-20260814-01",
    "reportId": "kgi-20260814",
    "name": "Singapore Exchange Ltd",
    "code": "SGX SP",
    "securityMarket": "SG",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "Singapore 구역의 Singapore Exchange Ltd 종목 카드",
    "status": "recorded"
  },
  {
    "id": "kgi-20260814-02",
    "reportId": "kgi-20260814",
    "name": "Sembcorp Industries",
    "code": "SCI SP",
    "securityMarket": "SG",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "Singapore 구역의 Sembcorp Industries 종목 카드",
    "status": "recorded"
  },
  {
    "id": "kgi-20260814-03",
    "reportId": "kgi-20260814",
    "name": "Xiaomi Corporation",
    "code": "1810 HK",
    "securityMarket": "HK",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "Hong Kong 구역의 Xiaomi Corporation 종목 카드",
    "status": "conflicting",
    "warnings": [
      "종목 카드의 제목은 메모리 소재인데 본문은 Xiaomi EV·생태계로 내용이 맞지 않습니다. 선정 기록은 보존하되 투자 근거 해석을 보류합니다."
    ]
  },
  {
    "id": "kgi-20260814-04",
    "reportId": "kgi-20260814",
    "name": "Montage Technology",
    "code": "6809 HK",
    "securityMarket": "HK",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "Hong Kong 구역의 Montage Technology 종목 카드",
    "status": "recorded"
  },
  {
    "id": "kgi-20260814-05",
    "reportId": "kgi-20260814",
    "name": "Coherent Corp",
    "code": "COHR US",
    "securityMarket": "US",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "United States 구역의 Coherent Corp 종목 카드",
    "status": "recorded"
  },
  {
    "id": "kgi-20260814-06",
    "reportId": "kgi-20260814",
    "name": "Chevron Corporation",
    "code": "CVX US",
    "securityMarket": "US",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "United States 구역의 Chevron Corporation 종목 카드",
    "status": "recorded"
  },
  {
    "id": "kgi-20260817-01",
    "reportId": "kgi-20260817",
    "name": "The Assembly Place Holdings",
    "code": "ASSPH SP",
    "securityMarket": "SG",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "Singapore 구역의 The Assembly Place Holdings 종목 카드",
    "status": "recorded"
  },
  {
    "id": "kgi-20260817-02",
    "reportId": "kgi-20260817",
    "name": "Singapore Exchange Ltd",
    "code": "SGX SP",
    "securityMarket": "SG",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "Singapore 구역의 Singapore Exchange Ltd 종목 카드",
    "status": "recorded"
  },
  {
    "id": "kgi-20260817-03",
    "reportId": "kgi-20260817",
    "name": "Lenovo Group",
    "code": "992 HK",
    "securityMarket": "HK",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "Hong Kong 구역의 Lenovo Group 종목 카드",
    "status": "recorded"
  },
  {
    "id": "kgi-20260817-04",
    "reportId": "kgi-20260817",
    "name": "Xiaomi Corporation",
    "code": "1810 HK",
    "securityMarket": "HK",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "Hong Kong 구역의 Xiaomi Corporation 종목 카드",
    "status": "conflicting",
    "warnings": [
      "종목 카드의 제목과 본문 소재가 서로 맞지 않는 편집 불일치가 있습니다. 선정 기록은 남기되 투자 근거 해석은 보류합니다."
    ]
  },
  {
    "id": "kgi-20260817-05",
    "reportId": "kgi-20260817",
    "name": "Lumentum Holdings",
    "code": "LITE US",
    "securityMarket": "US",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "United States 구역의 Lumentum Holdings 종목 카드",
    "status": "withdrawn_later",
    "warnings": [
      "8월 26일 같은 기관의 Trading Dashboard에서 CUT을 확인했습니다. 8월 17일 당시의 선정 기록만 보존하며 현재 유효 추천으로 표시하지 않습니다. 후속 원문: https://www.kgieworld.sg/research/our-top-picks-today-stocks-26-august-2026/"
    ]
  },
  {
    "id": "kgi-20260817-06",
    "reportId": "kgi-20260817",
    "name": "Coherent Corp",
    "code": "COHR US",
    "securityMarket": "US",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "United States 구역의 Coherent Corp 종목 카드",
    "status": "recorded"
  },
  {
    "id": "kgi-20260826-01",
    "reportId": "kgi-20260826",
    "name": "City Developments Limited",
    "code": "CIT SP",
    "securityMarket": "SG",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "Singapore 구역의 City Developments Limited 종목 카드",
    "status": "recorded"
  },
  {
    "id": "kgi-20260826-02",
    "reportId": "kgi-20260826",
    "name": "Food Empire Holdings",
    "code": "FEH SP",
    "securityMarket": "SG",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "Singapore 구역의 Food Empire Holdings 종목 카드",
    "status": "recorded"
  },
  {
    "id": "kgi-20260826-03",
    "reportId": "kgi-20260826",
    "name": "MTR Corporation",
    "code": "66 HK",
    "securityMarket": "HK",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "Hong Kong 구역의 MTR Corporation 종목 카드",
    "status": "recorded"
  },
  {
    "id": "kgi-20260826-04",
    "reportId": "kgi-20260826",
    "name": "Hong Kong Exchanges and Clearing",
    "code": "388 HK",
    "securityMarket": "HK",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "Hong Kong 구역의 Hong Kong Exchanges and Clearing 종목 카드",
    "status": "recorded"
  },
  {
    "id": "kgi-20260826-05",
    "reportId": "kgi-20260826",
    "name": "Palo Alto Networks",
    "code": "PANW US",
    "securityMarket": "US",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "United States 구역의 Palo Alto Networks 종목 카드",
    "status": "recorded"
  },
  {
    "id": "kgi-20260826-06",
    "reportId": "kgi-20260826",
    "name": "CrowdStrike",
    "code": "CRWD US",
    "securityMarket": "US",
    "kind": "stock",
    "horizons": [
      "unknown"
    ],
    "horizonBasis": "개별 Top Pick의 보유기간이 원문에 명시되지 않았습니다. 발간 주기·일반 투자의견 유효기간으로 대체하지 않았습니다.",
    "sector": null,
    "selectionLabel": "Our Top Picks Today: Stocks",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "Top Picks라는 원문 페이지 제목과 본문의 국가별 종목 카드를 함께 대조했습니다. BUY 등급만을 선정 근거로 사용하지 않았습니다.",
    "page": null,
    "locator": "United States 구역의 CrowdStrike 종목 카드",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-01",
    "reportId": "axis-20260907-prime",
    "name": "Bharti Airtel Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Telecom",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-02",
    "reportId": "axis-20260907-prime",
    "name": "Ultratech Cement Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Cement",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-03",
    "reportId": "axis-20260907-prime",
    "name": "ICICI Bank Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Financials",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-04",
    "reportId": "axis-20260907-prime",
    "name": "APL Apollo Tubes Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Building Materials",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-05",
    "reportId": "axis-20260907-prime",
    "name": "Sansera Engineering Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Automobiles",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-06",
    "reportId": "axis-20260907-prime",
    "name": "The Indian Hotels Company Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Hotel",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-07",
    "reportId": "axis-20260907-prime",
    "name": "Healthcare Global Enterprises Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Healthcare",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-08",
    "reportId": "axis-20260907-prime",
    "name": "Coforge Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "IT",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-09",
    "reportId": "axis-20260907-prime",
    "name": "Larsen & Toubro Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Industrial",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-10",
    "reportId": "axis-20260907-prime",
    "name": "City Union Bank Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Financials",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-11",
    "reportId": "axis-20260907-prime",
    "name": "Affle 3i Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "IT",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-12",
    "reportId": "axis-20260907-prime",
    "name": "CIE Automotive India Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Automobiles",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-13",
    "reportId": "axis-20260907-prime",
    "name": "Bajaj Finance Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Financials",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-14",
    "reportId": "axis-20260907-prime",
    "name": "LG Electronics India Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Consumer",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-15",
    "reportId": "axis-20260907-prime",
    "name": "Indus Towers Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Telecom",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-16",
    "reportId": "axis-20260907-prime",
    "name": "Bharat Electronics Ltd.",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Industrial",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-17",
    "reportId": "axis-20260907-prime",
    "name": "Rainbow Children's Medicare Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Healthcare",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-18",
    "reportId": "axis-20260907-prime",
    "name": "Jubilant FoodWorks Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Consumer",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-19",
    "reportId": "axis-20260907-prime",
    "name": "IDFC First Bank Ltd.",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Financials",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-20",
    "reportId": "axis-20260907-prime",
    "name": "Trent Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Consumer",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-21",
    "reportId": "axis-20260907-prime",
    "name": "HDFC Bank Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Financials",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-22",
    "reportId": "axis-20260907-prime",
    "name": "Elecon Engineering Company Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Industrial",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-23",
    "reportId": "axis-20260907-prime",
    "name": "Cera Sanitaryware Ltd.",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Industrial",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  },
  {
    "id": "axis-20260907-prime-24",
    "reportId": "axis-20260907-prime",
    "name": "Kesoram Industries Ltd",
    "code": null,
    "securityMarket": "IN",
    "kind": "stock",
    "horizons": [
      "medium-long"
    ],
    "horizonBasis": "8쪽은 High Growth & QARP 바스켓에 2~3년 투자기간을 명시하며 9쪽에 그 바스켓 Top Picks를 나열합니다. 개별 종목 만료일이나 일반 BUY 등급 12~18개월과 구분합니다.",
    "sector": "Industrial",
    "selectionLabel": "Top Picks / High Growth & QARP Stock Ideas",
    "selectionEvidence": "explicit_top_pick",
    "evidence": "9쪽 Top Picks 표의 종목·섹터를 시각 대조했습니다. 8쪽 바스켓 기간과 연결되며 다른 전략 바스켓이나 BUY 종목 전체를 합치지 않았습니다.",
    "page": 9,
    "locator": "High Growth & QARP Stock Ideas — Top Picks 표, 투자기간은 8쪽",
    "status": "recorded"
  }
];

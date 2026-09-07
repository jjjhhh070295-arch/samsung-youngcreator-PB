/** Public navigation metadata only. No reports, customer data, prices or ratings. */
export type ResearchSourceKind = "independent" | "institution" | "broker";
export type ResearchSource = Readonly<{
  id: string;
  name: string;
  kind: ResearchSourceKind;
  description: string;
  accessNote: string;
  verifiedOn: string | null;
  url: string | null;
  status: "checked" | "needs-review";
}>;

export const KIND_LABELS: Record<ResearchSourceKind, string> = {
  independent: "독립 리서치",
  institution: "기관·배포 포털",
  broker: "증권사 리서치",
};

// Allow exact reviewed destinations, not user-supplied URLs or arbitrary redirects.
const ALLOWED_DESTINATIONS: Readonly<Record<string, readonly [string, string]>> = {
  growth: ["그로쓰리서치", "https://www.growthresearch.co.kr/report"],
  arum: ["리서치알음", "https://researcharum.com/report/small-cap-research-list.php"],
  valuefinder: ["밸류파인더", "https://contents.premium.naver.com/valuefinder/valuesmallcap"],
  morningstar: ["모닝스타", "https://www.morningstar.com/company"],
  buffett: ["버핏연구소", "https://buffettlab.co.kr/"],
  bulit: ["불릿", "https://bulit.io/plus"],
  smallinsight: ["스몰인사이트리서치", "https://t.me/s/smallinsightresearch"],
  stunningvalue: ["스터닝밸류리서치", "https://t.me/s/stunningvalue"],
  aris: ["아리스", "https://t.me/s/aris1031"],
  glresearch: ["지엘리서치", "https://t.me/s/valjuman"],
  konnect: ["코넥트", "https://index.konnect-ai.net/about"],
  finlit: ["핀릿", "https://finlit.tovstock.com/"],
  cmir: ["CMIR", "https://www.cmir.co.kr/"],
  hsacademy: ["HS아카데미", "https://www.hs-academy.kr/"],
  kirs: ["한국IR협의회", "https://www.kirs.or.kr/"],
  daol: ["다올투자증권", "https://www.daolsecurities.com/research/article/common.jspx?rGubun=I01&sctrGubun=I07&web=0"],
  heungkuk: ["흥국증권", "https://www.heungkuksec.co.kr/research/company/list.do?key=300"],
  hanyang: ["한양증권", "https://www.hygood.co.kr/board/researchAnalyzeCompany/list"],
  "krx-kosdaq": ["KRX KOSDAQ Global", "https://kosdaqglobal.krx.co.kr/02/02040000/KGS02040100.jsp"],
};

export const RESEARCH_SOURCES: readonly ResearchSource[] = [
  { id: "growth", name: "그로쓰리서치", kind: "independent", status: "checked",
    description: "기업탐방·산업 보고서 탐색", accessNote: "무료 열람 기간과 멤버십 전환 조건은 원 사이트에서 확인하세요.",
    verifiedOn: "2026-09-06", url: "https://www.growthresearch.co.kr/report" },
  { id: "arum", name: "리서치알음", kind: "independent", status: "checked",
    description: "스몰캡 리서치 목록", accessNote: "보고서별 로그인·이용 조건은 원 사이트에서 확인하세요.",
    verifiedOn: "2026-09-06", url: "https://researcharum.com/report/small-cap-research-list.php" },
  { id: "valuefinder", name: "밸류파인더", kind: "independent", status: "checked",
    description: "발행자 운영 채널의 기업탐방·리서치 탐색", accessNote: "네이버 프리미엄콘텐츠 구독형 채널입니다. 이번 자동 열람은 제한되어 현재 접속·이용 조건은 직접 확인해야 합니다.",
    verifiedOn: "2026-09-06", url: "https://contents.premium.naver.com/valuefinder/valuesmallcap" },
  { id: "morningstar", name: "모닝스타", kind: "independent", status: "checked",
    description: "글로벌 투자 리서치 기관 소개·서비스 탐색", accessNote: "국내 스몰캡 전용 목록이 아닙니다. 한국 사이트 접속은 확인하지 못해 글로벌 회사 소개로 연결합니다. 서비스별 구독 조건을 확인하세요.",
    verifiedOn: "2026-09-07", url: "https://www.morningstar.com/company" },
  { id: "buffett", name: "버핏연구소", kind: "independent", status: "checked",
    description: "기업·산업 분석과 리서치 관련 기사 탐색", accessNote: "자체 분석과 타 기관 보고서를 다룬 기사가 함께 있습니다. 게시물의 원 발행기관을 구분하세요.",
    verifiedOn: "2026-09-07", url: "https://buffettlab.co.kr/" },
  { id: "bulit", name: "불릿", kind: "independent", status: "checked",
    description: "독립 리서치·멤버십 서비스 탐색", accessNote: "서비스 안내 페이지입니다. 보고서별 로그인·구독 조건은 원 사이트에서 확인하세요.",
    verifiedOn: "2026-09-07", url: "https://bulit.io/plus" },
  { id: "smallinsight", name: "스몰인사이트리서치", kind: "independent", status: "checked",
    description: "스몰인사이트리서치 공개 텔레그램 채널", accessNote: "별도 홈페이지가 아닌 공개 채널입니다. 게시물·첨부별 발행자와 열람 조건을 확인하세요.",
    verifiedOn: "2026-09-07", url: "https://t.me/s/smallinsightresearch" },
  { id: "stunningvalue", name: "스터닝밸류리서치", kind: "independent", status: "checked",
    description: "보고서에서 안내하는 공개 텔레그램 채널", accessNote: "홈페이지 인증서 오류로 공개 채널을 연결합니다. 뉴스 공유와 자체 의견을 구분하세요. 자료 재이용 권한을 뜻하지 않습니다.",
    verifiedOn: "2026-09-07", url: "https://t.me/s/stunningvalue" },
  { id: "aris", name: "아리스", kind: "independent", status: "checked",
    description: "기업탐방 중심 아리스 ARIS 공개 텔레그램 채널", accessNote: "별도 홈페이지가 아닌 공개 채널입니다. 원 보고서와 공유된 뉴스·의견을 구분하세요.",
    verifiedOn: "2026-09-07", url: "https://t.me/s/aris1031" },
  { id: "glresearch", name: "지엘리서치", kind: "independent", status: "checked",
    description: "기업 리포트·탐방 노트를 안내하는 공개 텔레그램 채널", accessNote: "공개 채널의 기관 소개·연락처를 대조했습니다. 모든 게시물이 자체 보고서인 것은 아니며 재이용 조건은 별도 확인이 필요합니다.",
    verifiedOn: "2026-09-07", url: "https://t.me/s/valjuman" },
  { id: "konnect", name: "코넥트", kind: "independent", status: "checked",
    description: "코넥트 독립리서치 R·기업 분석 서비스 소개", accessNote: "회사 소개 페이지로 연결합니다. 전체 스몰캡 보고서 목록이 아니며, 기업 자문과 리서치의 이해상충 안내도 확인하세요.",
    verifiedOn: "2026-09-07", url: "https://index.konnect-ai.net/about" },
  { id: "finlit", name: "핀릿", kind: "independent", status: "checked",
    description: "기업·산업·전략 보고서 탐색", accessNote: "보고서·첨부별 로그인 또는 구독이 필요할 수 있습니다. 내부 저장·재배포 권한과 원문 열람은 별개입니다.",
    verifiedOn: "2026-09-07", url: "https://finlit.tovstock.com/" },
  { id: "cmir", name: "CMIR", kind: "independent", status: "checked",
    description: "씨엠아이알 독립 리서치 홈페이지·Research 메뉴", accessNote: "홈페이지의 Research 메뉴에서 찾아보세요. 개별 자료의 로그인·이용 조건은 원 사이트를 따릅니다.",
    verifiedOn: "2026-09-07", url: "https://www.cmir.co.kr/" },
  { id: "hsacademy", name: "HS아카데미", kind: "independent", status: "checked",
    description: "경제·투자 교육 및 리서치 콘텐츠 서비스", accessNote: "국내 스몰캡 전용 기관으로 분류하지 않습니다. 교육·매크로·기술 콘텐츠가 포함되며 상품별 구독 조건을 확인하세요.",
    verifiedOn: "2026-09-07", url: "https://www.hs-academy.kr/" },
  { id: "kirs", name: "한국IR협의회", kind: "institution", status: "checked",
    description: "기업리서치 자료를 제공하는 기관 홈페이지", accessNote: "홈페이지의 기업리서치 메뉴에서 찾아보세요. 현재 접속 상태는 재확인 필요하며, 독립 리서치 회사와 구분합니다.",
    verifiedOn: "2026-09-06", url: "https://www.kirs.or.kr/" },
  { id: "daol", name: "다올투자증권", kind: "broker", status: "checked",
    description: "스몰캡 리서치 자료 탐색", accessNote: "보고서 열람·이용 조건은 증권사 원 사이트를 따릅니다.",
    verifiedOn: "2026-09-06", url: "https://www.daolsecurities.com/research/article/common.jspx?rGubun=I01&sctrGubun=I07&web=0" },
  { id: "heungkuk", name: "흥국증권", kind: "broker", status: "checked",
    description: "기업분석 보고서 목록", accessNote: "스몰캡 전용 목록이 아닌 기업분석 자료입니다. 종목별로 확인하세요.",
    verifiedOn: "2026-09-06", url: "https://www.heungkuksec.co.kr/research/company/list.do?key=300" },
  { id: "hanyang", name: "한양증권", kind: "broker", status: "checked",
    description: "중소형주를 포함한 기업분석 보고서 목록", accessNote: "개별 첨부의 열람 조건은 원 사이트에서 확인하세요.",
    verifiedOn: "2026-09-06", url: "https://www.hygood.co.kr/board/researchAnalyzeCompany/list" },
  { id: "krx-kosdaq", name: "KRX KOSDAQ Global", kind: "institution", status: "checked",
    description: "코스닥 글로벌 기업분석보고서 배포 포털", accessNote: "KRX가 모든 보고서의 작성자는 아닙니다. 원문 발행기관을 확인하세요. 전체 스몰캡 목록이 아닙니다.",
    verifiedOn: "2026-09-06", url: "https://kosdaqglobal.krx.co.kr/02/02040000/KGS02040100.jsp" },
];

export function getResearchSourceHref(source: ResearchSource): string | null {
  if (source.status !== "checked" || !source.verifiedOn || !source.url) return null;
  const approved = ALLOWED_DESTINATIONS[source.id];
  return approved?.[0] === source.name && approved?.[1] === source.url ? source.url : null;
}

export function filterResearchSources(query: string, kind: ResearchSourceKind | "all"): readonly ResearchSource[] {
  const needle = query.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
  return RESEARCH_SOURCES.filter((source) =>
    (kind === "all" || source.kind === kind) &&
    `${source.name} ${source.description}`.normalize("NFKC").toLocaleLowerCase("ko-KR").includes(needle),
  );
}

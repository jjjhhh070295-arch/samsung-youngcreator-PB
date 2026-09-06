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
  { id: "value-research", name: "밸류리서치", kind: "independent", status: "needs-review",
    description: "동명 서비스와 기관 구분 필요", accessNote: "현재 독립 리서치 기관의 공식 주소가 확인되지 않아 이동을 제공하지 않습니다.",
    verifiedOn: null, url: null },
  { id: "fs-research", name: "FS리서치", kind: "independent", status: "needs-review",
    description: "현재 공식 보고서 열람 경로 재확인 필요", accessNote: "과거 발행 채널만으로 현재 서비스를 확정하지 않습니다.",
    verifiedOn: null, url: null },
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

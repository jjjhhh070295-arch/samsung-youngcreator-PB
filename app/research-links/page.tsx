import type { Metadata } from "next";
import ResearchLinkDirectory from "@/components/researchLinks/ResearchLinkDirectory";

export const metadata: Metadata = {
  title: "스몰캡 리서치 찾기 · PB센터",
  description: "독립 리서치·기관·증권사 원 사이트 탐색을 위한 공개 링크 모음",
};

export default function ResearchLinksPage() {
  return <ResearchLinkDirectory />;
}

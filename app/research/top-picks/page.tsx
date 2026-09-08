import type { Metadata } from "next";
import ActualTopPickExplorer from "@/components/researchIdeas/ActualTopPickExplorer";
import { REPORTS, PICKS, AS_OF, WINDOW_START } from "@/lib/researchIdeas/actualTopPickCatalog";
import { buildActualTopPickView, parseActualTopPickQuery } from "@/lib/researchIdeas/actualTopPickView";

export const metadata: Metadata = { title: "기관 Top Pick 선정 기록 · 로컬 검토", robots: { index: false, follow: false } };

// No fetch, upload or database query. Rights flags/noindex are NOT access controls.
// This page is for the authorized local review, not an approved public deployment.
export default function ActualTopPicksPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const view = buildActualTopPickView(REPORTS, PICKS, { start: WINDOW_START, end: AS_OF });
  return <ActualTopPickExplorer view={view} query={parseActualTopPickQuery(searchParams, view.sectors)} />;
}

import ResearchWorkspace from "@/components/research/ResearchWorkspace";

export default function PbResearchPage({
  params,
  searchParams,
}: {
  params: { pbId: string };
  searchParams: { clientId?: string };
}) {
  return <ResearchWorkspace pbId={params.pbId} initialClientId={searchParams.clientId} />;
}

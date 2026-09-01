import ResearchWorkspace from "@/components/research/ResearchWorkspace";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  authorizeInitialResearchClient,
  listAuthorizedResearchClients,
} from "@/lib/auth/pbAccess.server";
import { PbSessionConfigurationError, readPbSession } from "@/lib/auth/session.server";

export default async function PbResearchPage({
  params,
  searchParams,
}: {
  params: { pbId: string };
  searchParams: { clientId?: string };
}) {
  try {
    const session = readPbSession(cookies(), { expectedPbId: params.pbId });
    if (!session) redirect("/");
    const authorizedClients = await listAuthorizedResearchClients(session.pbId);
    const initialClientId = authorizeInitialResearchClient(searchParams.clientId, authorizedClients);
    return (
      <ResearchWorkspace
        pbId={session.pbId}
        authorizedClients={authorizedClients}
        initialClientId={initialClientId}
      />
    );
  } catch (error) {
    if (error instanceof PbSessionConfigurationError) redirect("/?auth=unavailable");
    throw error;
  }
}

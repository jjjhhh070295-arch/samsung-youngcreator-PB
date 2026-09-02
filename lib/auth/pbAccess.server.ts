import type { Client } from "@/lib/types";
import type { ResearchClientSummary } from "@/lib/researchCopilot/types";
import { DEMO_PB_CREDENTIALS, DEMO_PB_ID, getServerDemoPb, listClientsByPb } from "@/lib/store";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export interface PublicPbIdentity {
  pbId: string;
  pbName: string;
}

type AuthorizedClientLoader = (pbId: string) => Promise<Client[]>;

export async function authenticatePbCredentials(input: {
  employeeId: string;
  password: string;
}): Promise<PublicPbIdentity | null> {
  const employeeId = input.employeeId.trim().toUpperCase();
  const password = input.password;
  if (!employeeId || !password) return null;

  if (
    employeeId === DEMO_PB_CREDENTIALS.employeeId &&
    password === DEMO_PB_CREDENTIALS.password
  ) {
    const demo = getServerDemoPb(DEMO_PB_ID);
    return demo ? { pbId: demo.id, pbName: demo.name } : null;
  }

  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase
    .from("pbs")
    .select("id, name, employee_id, password")
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (error || !data || data.password !== password) return null;
  return { pbId: String(data.id), pbName: String(data.name) };
}

export async function listAuthorizedResearchClients(
  pbId: string,
  loader: AuthorizedClientLoader = listClientsByPb,
): Promise<Client[]> {
  const normalizedPbId = pbId.trim();
  if (!normalizedPbId) return [];
  const clients = await loader(normalizedPbId);
  // A data-source/RLS regression must not leak a foreign PB record through the server boundary.
  return clients.filter((client) => client.assignedPbId === normalizedPbId);
}

export function authorizeInitialResearchClient(
  requestedClientId: string | null | undefined,
  authorizedClients: ReadonlyArray<Pick<Client, "id">>,
): string | undefined {
  if (!requestedClientId) return undefined;
  return authorizedClients.some((client) => client.id === requestedClientId)
    ? requestedClientId
    : undefined;
}

export function toResearchClientSummaries(
  authorizedClients: ReadonlyArray<Pick<Client, "id" | "name" | "code">>,
): ResearchClientSummary[] {
  return authorizedClients.map(({ id, name, code }) => ({ id, name, code }));
}

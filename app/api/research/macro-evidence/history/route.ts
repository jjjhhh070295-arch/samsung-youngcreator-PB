import { NextRequest } from "next/server";
import { handleMacroHistoryRequest } from "./handler.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handleMacroHistoryRequest(request);
}

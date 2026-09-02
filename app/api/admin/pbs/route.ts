import { NextRequest } from "next/server";
import { handlePbAdminRequest } from "./handler.server";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return handlePbAdminRequest(request);
}

export function POST(request: NextRequest) {
  return handlePbAdminRequest(request);
}

export function PATCH(request: NextRequest) {
  return handlePbAdminRequest(request);
}

export function DELETE(request: NextRequest) {
  return handlePbAdminRequest(request);
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PbSessionConfigurationError, readPbSession } from "@/lib/auth/session.server";

// URL 식별자는 권한이 아니다. 모든 /pb/[pbId] 하위 화면은 서명된 HttpOnly 세션과
// URL PB가 모두 일치할 때만 서버에서 내용을 렌더링한다.
export default function PbLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { pbId: string };
}) {
  try {
    const session = readPbSession(cookies(), { expectedPbId: params.pbId });
    if (!session) redirect("/");
  } catch (error) {
    if (error instanceof PbSessionConfigurationError) redirect("/?auth=unavailable");
    throw error;
  }
  return <>{children}</>;
}

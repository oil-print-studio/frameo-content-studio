import { NextResponse } from "next/server";
import { startJob } from "@/lib/shorts/jobs";
import { runDraft } from "@/lib/shorts/pipeline";
import { loadProject } from "@/lib/shorts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 초안 다시 실행: 완료된 단계는 건너뛰고 실패·중단된 단계부터 이어간다 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await loadProject(id);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
  if (!startJob(id, "draft", () => runDraft(id))) return NextResponse.json({ error: "이미 작업 중이에요." }, { status: 409 });
  return NextResponse.json({ started: true }, { status: 202 });
}

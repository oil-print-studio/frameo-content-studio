import { NextResponse } from "next/server";
import { startJob } from "@/lib/shorts/jobs";
import { applyEdit } from "@/lib/shorts/pipeline";
import { editSchema } from "@/lib/shorts/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 2. 초안 수정: 수정 유형별로 필요한 작업만 다시 한다 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = editSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "잘못된 수정 요청이에요." }, { status: 400 });
  const edit = parsed.data;
  if (!startJob(id, `edit:${edit.op}`, async () => {
    const r = await applyEdit(id, edit);
    return { redo: r.redo, planVersion: r.plan.version, renderedCuts: r.preview.renderedCuts, reusedCuts: r.preview.reusedCuts };
  }))
    return NextResponse.json({ error: "이전 작업이 끝난 뒤 다시 시도해 주세요." }, { status: 409 });
  return NextResponse.json({ started: true }, { status: 202 });
}

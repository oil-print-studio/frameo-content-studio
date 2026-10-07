import { NextResponse } from "next/server";
import { startJob } from "@/lib/shorts/jobs";
import { exportPackage } from "@/lib/shorts/pipeline";
import { exportSchema } from "@/lib/shorts/schema";
import type { PlatformId } from "@/lib/shorts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 3. 저장: 최종 렌더 → 검사 → 패키지 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = exportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "잘못된 요청이에요." }, { status: 400 });
  if (!startJob(id, "export", () => exportPackage(id, parsed.data.platforms as PlatformId[])))
    return NextResponse.json({ error: "이전 작업이 끝난 뒤 다시 시도해 주세요." }, { status: 409 });
  return NextResponse.json({ started: true }, { status: 202 });
}

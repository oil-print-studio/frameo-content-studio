import { NextResponse } from "next/server";
import { isRunning } from "@/lib/shorts/jobs";
import { projectView } from "@/lib/shorts/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json({ ...(await projectView(id)), running: isRunning(id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}

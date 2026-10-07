import { NextResponse } from "next/server";
import { settingsSchema } from "@/lib/shorts/schema";
import { loadChannelSettings, saveChannelSettings } from "@/lib/shorts/store";
import type { ChannelSettings } from "@/lib/shorts/types";
import { capabilities } from "@/lib/shorts/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 채널 기본값 + 현재 사용 가능한 엔진(키 값은 내보내지 않음) */
export async function GET() {
  return NextResponse.json({ settings: await loadChannelSettings(), capabilities: capabilities() });
}

export async function PUT(request: Request) {
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "설정을 확인해 주세요." }, { status: 400 });
  await saveChannelSettings(parsed.data as ChannelSettings);
  return NextResponse.json({ settings: parsed.data });
}

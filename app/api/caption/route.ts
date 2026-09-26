import { NextResponse } from "next/server";
import { createMockProvider, getCaptionProvider } from "@/lib/ai";
import { captionInputSchema } from "@/lib/ai/schema";
import type { CaptionResponse } from "@/lib/ai/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const parsed = captionInputSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "입력값을 확인해주세요.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const provider = getCaptionProvider();
  try {
    const caption = await provider.generate(parsed.data);
    return NextResponse.json<CaptionResponse>({ caption, provider: provider.name });
  } catch (error) {
    console.error(`[caption] ${provider.name} provider failed`, error);
    // 실제 AI 호출이 실패해도 운영자가 작업을 이어갈 수 있도록 mock 으로 대체
    const caption = await createMockProvider().generate(parsed.data);
    return NextResponse.json<CaptionResponse>({
      caption,
      provider: "mock",
      notice: "AI 글 생성에 실패해 기본 템플릿으로 작성했습니다. 잠시 후 다시 시도해보세요.",
    });
  }
}

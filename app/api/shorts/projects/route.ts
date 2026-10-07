import { NextResponse } from "next/server";
import { startJob } from "@/lib/shorts/jobs";
import { createProject, runDraft } from "@/lib/shorts/pipeline";
import { MAX_UPLOAD_BYTES, productInputSchema } from "@/lib/shorts/schema";
import type { AssetRole } from "@/lib/shorts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 1. 상품과 소재 넣기 → 프로젝트 생성 후 초안 작업 시작 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "업로드를 읽지 못했어요." }, { status: 400 });
  }
  let productRaw: unknown;
  try {
    productRaw = JSON.parse(String(form.get("product") ?? "{}"));
  } catch {
    return NextResponse.json({ error: "상품 정보 형식이 잘못됐어요." }, { status: 400 });
  }
  const parsed = productInputSchema.safeParse(productRaw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요." }, { status: 400 });

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "영상이나 사진을 하나 이상 넣어 주세요." }, { status: 400 });
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "소재 용량이 너무 커요(합계 500MB 이하)." }, { status: 413 });
  let confirmed: boolean[] = [];
  let roles: (string | null)[] = [];
  try {
    confirmed = JSON.parse(String(form.get("confirmed") ?? "[]"));
    roles = JSON.parse(String(form.get("roles") ?? "[]"));
  } catch {
    /* 확인·역할 정보가 없으면 모두 미확인·역할 없음 */
  }
  const roleOf = (i: number): AssetRole | undefined => (["before", "after", "canvas", "product"].includes(String(roles[i])) ? (roles[i] as AssetRole) : undefined);

  const p = parsed.data;
  try {
    const project = await createProject(
      {
        name: p.name,
        purpose: p.purpose,
        url: p.url,
        cta: p.cta,
        facts: p.facts.map((f, i) => ({ id: `f${i + 1}`, text: f.text, source: f.source, sourceNote: f.sourceNote, approved: true })),
      },
      await Promise.all(files.map(async (f, i) => ({ name: f.name, data: Buffer.from(await f.arrayBuffer()), productConfirmed: Boolean(confirmed[i]), role: roleOf(i) }))),
    );
    startJob(project.id, "draft", () => runDraft(project.id));
    return NextResponse.json({ id: project.id }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

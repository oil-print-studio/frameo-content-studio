/**
 * 실제 소재로 영상 한 편 만들기: 상품 정보 파일 하나로 입력 → 초안 → 저장 → 측정까지.
 *   pnpm shorts make <product.json>
 *
 * product.json 예시(경로는 이 파일 기준 상대 경로 가능):
 * {
 *   "name": "FRAME O 유화 캔버스",
 *   "purpose": "own",
 *   "url": "https://frameoart.com",
 *   "facts": [{ "text": "사진 한 장으로 유화 느낌의 캔버스 작품을 만들어요", "source": "user", "sourceNote": "FRAME O 상품 설명" }],
 *   "files": [
 *     { "path": "원본.jpg", "role": "before", "confirmed": true },
 *     { "path": "완성.jpg", "role": "after", "confirmed": true },
 *     { "path": "캔버스_거실.jpg", "role": "canvas", "confirmed": true }
 *   ],
 *   "voice": "gemini",
 *   "platforms": ["common", "youtube_shorts", "instagram_reels"]
 * }
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { hasGemini } from "../lib/shorts/gemini";
import { createProject, exportPackage, runDraft } from "../lib/shorts/pipeline";
import { isPlatformId } from "../lib/shorts/platforms";
import { productInputSchema } from "../lib/shorts/schema";
import { readLog, resolveInProject, saveProject } from "../lib/shorts/store";
import type { AssetRole, CallLogEntry, PlatformId } from "../lib/shorts/types";

interface MakeSpec {
  files: { path: string; role?: AssetRole; confirmed?: boolean }[];
  voice?: "gemini" | "local";
  voiceName?: string;
  platforms?: string[];
  [k: string]: unknown;
}

export async function makeVideo(specFile: string) {
  const base = path.dirname(path.resolve(specFile));
  const spec = JSON.parse(await readFile(specFile, "utf8")) as MakeSpec;
  const product = productInputSchema.parse(spec);
  if (spec.voice === "gemini" && !hasGemini()) throw new Error("voice=gemini 인데 GEMINI_API_KEY 가 없습니다.");
  const t0 = Date.now();
  const files = await Promise.all(
    spec.files.map(async (f) => ({ name: path.basename(f.path), data: await readFile(path.resolve(base, f.path)), role: f.role, productConfirmed: f.confirmed })),
  );
  const project = await createProject(
    { ...product, facts: product.facts.map((f, i) => ({ id: `f${i + 1}`, ...f, approved: true })) },
    files,
  );
  const voice = spec.voice ?? (hasGemini() ? "gemini" : "local");
  project.settings.voice = voice === "gemini" ? { provider: "gemini", voice: spec.voiceName || process.env.GEMINI_TTS_VOICE || "Kore" } : { provider: "local", voice: "ko", rate: 175 };
  await saveProject(project);
  console.log(`프로젝트 ${project.id} · 소재 ${files.length}개 · 음성 ${voice}`);

  const d = await runDraft(project.id);
  console.log(`초안 v${d.plan.version} · ${d.timeline.totalDuration.toFixed(1)}초 · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  for (const s of d.plan.sentences) {
    const t = d.timeline.sentences.find((x) => x.sentenceId === s.id);
    console.log(`  ${t?.start.toFixed(1)}~${t?.end.toFixed(1)}s [${s.role}] ${s.text} ← 근거 ${s.factIds.join(",") || "-"} · ${s.sceneReason}`);
  }
  for (const r of d.review) console.log(`  ${r.blocking ? "■ 필수" : "□ 권장"} ${r.message}`);
  console.log(`  미리보기: ${resolveInProject(project.id, d.preview.videoRel)}`);
  if (d.review.some((r) => r.blocking)) {
    console.log("필수 확인 항목이 남아 저장하지 않았습니다. 화면(/shorts?p=" + project.id + ")에서 확인 후 저장하세요.");
    return project.id;
  }
  const platforms = (spec.platforms ?? ["common", "youtube_shorts", "instagram_reels"]).filter(isPlatformId) as PlatformId[];
  const t1 = Date.now();
  const e = await exportPackage(project.id, platforms);
  console.log(`저장 ${((Date.now() - t1) / 1000).toFixed(1)}초 → ${resolveInProject(project.id, e.folder)}`);
  for (const o of e.outputs) {
    console.log(`  ${o.platform}: ${o.verify.ok ? "검사 통과" : "검사 실패"} · ${o.verify.publishable ? "게시 가능" : "게시 불가"} · 음성 ${o.voice}`);
    for (const c of o.verify.checks.filter((c) => !c.ok)) console.log(`    ✗ ${c.name}: ${c.detail}`);
    for (const b of o.verify.blockers) console.log(`    ! ${b}`);
  }
  const calls = (await readLog<CallLogEntry>(project.id, "calls")).filter((c) => c.provider === "gemini");
  console.log(`AI 사용량: Gemini 호출 ${calls.length}건(실패 ${calls.filter((c) => !c.ok).length}) · 입력 토큰 ${calls.reduce((a, c) => a + (c.inputTokens ?? 0), 0)} · 출력 토큰 ${calls.reduce((a, c) => a + (c.outputTokens ?? 0), 0)}`);
  return project.id;
}

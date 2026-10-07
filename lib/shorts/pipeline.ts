import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeAll, analyzerKey, assetReviewItems, effectiveSegments } from "./analyze";
import { hashFile, hashOf, probe, parseRate, streamRotation } from "./media";
import { checkClaims, generateScript, newHook, PLAN_PROMPT_VERSION } from "./planner";
import { PLATFORMS } from "./platforms";
import { postText } from "./postText";
import { renderPlatform, type RenderOutput, PROFILES } from "./render";
import {
  loadChannelSettings,
  loadProject,
  loadState,
  logStep,
  newId,
  planFile,
  projectDir,
  readJson,
  readLog,
  resolveInProject,
  saveProject,
  timelineFile,
  updateStep,
  writeJson,
} from "./store";
import { buildTimeline, timelineReviewItems, validateForRender } from "./timeline";
import type { CallLogEntry, EditPlan, PlatformId, ProductCard, Project, ReviewItem, Segment, SourceAsset, Timeline, VerifyReport } from "./types";
import { verifyOutput } from "./verify";
import { buildVoiceTrack } from "./voice";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

export interface NewFile {
  name: string;
  data: Buffer;
  /** 사용자가 입력 단계에서 '판매 상품 촬영본'으로 확인했는지 */
  productConfirmed?: boolean;
}

export async function probeAsset(projectId: string, rel: string, fileName: string): Promise<Omit<SourceAsset, "id" | "productConfirmed">> {
  const abs = resolveInProject(projectId, rel);
  const info = await probe(abs);
  const v = info.streams.find((s) => s.codec_type === "video");
  if (!v?.width || !v.height) throw new Error(`${fileName}: 영상/사진으로 읽을 수 없는 파일입니다.`);
  const ext = path.extname(fileName).toLowerCase();
  const isImage = IMAGE_EXT.has(ext) || /image2|png_pipe|jpeg_pipe|webp_pipe/.test(info.format.format_name ?? "");
  const rot = streamRotation(v);
  const [w, h] = rot === 90 || rot === 270 ? [v.height, v.width] : [v.width, v.height];
  return {
    fileName,
    path: rel,
    hash: await hashFile(abs),
    kind: isImage ? "image" : "video",
    width: w,
    height: h,
    duration: isImage ? 0 : Number(info.format.duration ?? v.duration ?? 0),
    fps: isImage ? 0 : parseRate(v.avg_frame_rate || v.r_frame_rate),
    hasAudio: info.streams.some((s) => s.codec_type === "audio"),
  };
}

export async function addAssets(project: Project, files: NewFile[]): Promise<SourceAsset[]> {
  const added: SourceAsset[] = [];
  for (const f of files) {
    const ext = path.extname(f.name).toLowerCase();
    if (!IMAGE_EXT.has(ext) && !VIDEO_EXT.has(ext)) throw new Error(`${f.name}: 지원하지 않는 형식입니다(mp4·mov·webm·jpg·png·webp).`);
    const id = newId("a");
    const rel = path.join("sources", `${id}${ext}`);
    await mkdir(path.dirname(resolveInProject(project.id, rel)), { recursive: true });
    await writeFile(resolveInProject(project.id, rel), f.data);
    const meta = await probeAsset(project.id, rel, f.name);
    added.push({ id, ...meta, productConfirmed: f.productConfirmed ? true : undefined });
  }
  project.assets.push(...added);
  if (!project.product.referenceAssetId) project.product.referenceAssetId = project.assets.find((a) => a.kind === "image")?.id;
  return added;
}

export async function createProject(product: Omit<ProductCard, "id" | "confirmedAt">, files: NewFile[], title?: string): Promise<Project> {
  const settings = await loadChannelSettings();
  const id = newId("p");
  const project: Project = {
    id,
    title: title || product.name,
    product: { ...product, id: `prod-${hashOf(product.name)}`, confirmedAt: new Date().toISOString() },
    assets: [],
    settings,
    createdAt: new Date().toISOString(),
  };
  await mkdir(projectDir(id), { recursive: true });
  await addAssets(project, files);
  await saveProject(project);
  await writeJson(path.join(projectDir(id), "state.json"), { steps: {}, updatedAt: new Date().toISOString() });
  return project;
}

const segmentsFile = (id: string) => path.join(projectDir(id), "segments.json");
const reviewFile = (id: string) => path.join(projectDir(id), "review.json");

async function loadSegments(project: Project): Promise<Segment[]> {
  const raw = (await readJson<Segment[]>(segmentsFile(project.id))) ?? [];
  return effectiveSegments(project, raw);
}

export async function loadPlan(id: string) {
  return readJson<EditPlan>(planFile(id));
}
export async function loadTimeline(id: string) {
  return readJson<Timeline>(timelineFile(id));
}

async function savePlan(plan: EditPlan) {
  await writeJson(planFile(plan.projectId), plan);
  await writeJson(path.join(projectDir(plan.projectId), "plans", `v${plan.version}.json`), plan);
}

async function timed<T>(projectId: string, step: string, fn: () => Promise<T>, activity: string): Promise<T> {
  const started = Date.now();
  await updateStep(projectId, step as never, { status: "running", startedAt: new Date().toISOString(), error: undefined }, activity);
  try {
    const out = await fn();
    await updateStep(projectId, step as never, { status: "done", finishedAt: new Date().toISOString() }, "");
    await logStep(projectId, { step, ok: true, ms: Date.now() - started });
    return out;
  } catch (err) {
    const msg = (err as Error).message + ((err as { stderrTail?: string }).stderrTail ? `\n${(err as { stderrTail?: string }).stderrTail}` : "");
    await updateStep(projectId, step as never, { status: "failed", error: msg, finishedAt: new Date().toISOString() }, "");
    await logStep(projectId, { step, ok: false, ms: Date.now() - started, error: msg });
    throw err;
  }
}

/** 1단계: 소재 분석 (해시·설정이 같으면 캐시 재사용) */
async function stepAnalyze(project: Project): Promise<Segment[]> {
  const key = hashOf({ a: project.assets.map((a) => [a.id, a.hash, a.excluded]), k: analyzerKey() });
  const state = await loadState(project.id);
  const existing = await readJson<Segment[]>(segmentsFile(project.id));
  if (existing && state.steps.analyze?.status === "done" && state.steps.analyze.inputKey === key) return effectiveSegments(project, existing);
  return timed(project.id, "analyze", async () => {
    const segs = await analyzeAll(project);
    await writeJson(segmentsFile(project.id), segs);
    await updateStep(project.id, "analyze", { inputKey: key });
    return effectiveSegments(project, segs);
  }, "소재 분석 중");
}

function newPlan(project: Project, prev: EditPlan | undefined, sentences: EditPlan["sentences"], generator: EditPlan["generator"]): EditPlan {
  return {
    kind: "edit_plan",
    planSchema: 1,
    version: (prev?.version ?? 0) + 1,
    projectId: project.id,
    productId: project.product.id,
    approvedFactIds: project.product.facts.filter((f) => f.approved).map((f) => f.id),
    sourceHashes: Object.fromEntries(project.assets.filter((a) => !a.excluded).map((a) => [a.id, a.hash])),
    generator,
    sentences,
    hookHistory: prev?.hookHistory ?? [],
    voice: prev?.voice ?? project.settings.voice,
    captionStyle: prev?.captionStyle ?? { scale: project.settings.captionScale, color: "#ffffff", highlight: "#ffd84d" },
    design: { id: "basic-v1", brandColor: project.settings.brandColor },
    output: { targetSeconds: project.settings.targetSeconds, endCardSeconds: 2 },
    createdAt: new Date().toISOString(),
  };
}

/** 2단계: 대본·장면 계획. 상품 사실·소재가 바뀌지 않으면 기존 계획 유지 */
async function stepPlan(project: Project, segments: Segment[], notices: string[]): Promise<EditPlan> {
  const key = hashOf({ f: project.product.facts, n: project.product.name, p: project.product.purpose, c: project.product.cta, s: segments.map((s) => s.id), v: PLAN_PROMPT_VERSION });
  const state = await loadState(project.id);
  const prev = await loadPlan(project.id);
  if (prev && state.steps.plan?.status === "done" && state.steps.plan.inputKey === key) return prev;
  return timed(project.id, "plan", async () => {
    const result = await generateScript(project, segments);
    if (result.notice) notices.push(result.notice);
    const plan = newPlan(project, prev, result.sentences, result.generator);
    await savePlan(plan);
    await updateStep(project.id, "plan", { inputKey: key });
    return plan;
  }, "대본·장면 계획 중");
}

/** 3단계: 음성 + 타임라인 */
async function stepVoiceTimeline(project: Project, plan: EditPlan, segments: Segment[]) {
  const track = await timed(project.id, "voice", () => buildVoiceTrack(project, plan), "음성 합성 중");
  const timeline = await timed(project.id, "timeline", async () => {
    const t = buildTimeline(project, plan, segments, track);
    await writeJson(timelineFile(project.id), t);
    return t;
  }, "타임라인 맞추는 중");
  return { track, timeline };
}

export async function computeReview(project: Project, plan: EditPlan, timeline: Timeline | undefined, segments: Segment[]): Promise<ReviewItem[]> {
  const raw = (await readJson<Segment[]>(segmentsFile(project.id))) ?? segments;
  const usedAssets = new Set((timeline?.cuts ?? []).map((c) => c.assetId));
  const items = [
    ...assetReviewItems(project, raw).filter((r) => !r.assetId || usedAssets.has(r.assetId) || !timeline),
    ...checkClaims(project, plan.sentences),
    ...(timeline ? timelineReviewItems(plan, timeline) : []),
  ];
  await writeJson(reviewFile(project.id), items);
  return items;
}

async function stepPreview(project: Project, plan: EditPlan, timeline: Timeline): Promise<RenderOutput> {
  const errors = await validateForRender(project, plan, timeline);
  if (errors.length) throw new Error(`편집 계획 검사 실패:\n- ${errors.join("\n- ")}`);
  const platform = project.settings.defaultPlatforms[0] ?? "common";
  return timed(project.id, "preview", () => renderPlatform(project, plan, timeline, platform, "preview"), "미리보기 렌더 중");
}

export interface DraftResult {
  plan: EditPlan;
  timeline: Timeline;
  preview: RenderOutput;
  review: ReviewItem[];
  notices: string[];
}

/** 소재 입력 → 완성 초안(미리보기) 한 편. 완료된 단계는 건너뛰고 실패한 단계부터 이어간다 */
export async function runDraft(projectId: string): Promise<DraftResult> {
  const project = await loadProject(projectId);
  const notices: string[] = [];
  const segments = await stepAnalyze(project);
  const plan = await stepPlan(project, segments, notices);
  const { timeline } = await stepVoiceTimeline(project, plan, segments);
  const review = await computeReview(project, plan, timeline, segments);
  const preview = await stepPreview(project, plan, timeline);
  await writeJson(path.join(projectDir(projectId), "preview.json"), { ...preview, planVersion: plan.version, notices });
  return { plan, timeline, preview, review, notices };
}

export type EditOp =
  | { op: "captionScale"; scale: number }
  | { op: "editSentence"; sentenceId: string; text: string; caption?: string }
  | { op: "shorter" }
  | { op: "newHook" }
  | { op: "swapScene"; sentenceId: string; segmentId: string }
  | { op: "confirmAsset"; assetId: string; confirmed: boolean }
  | { op: "excludeAsset"; assetId: string };

/** 수정 유형별로 다시 할 작업만 실행한다(재사용 표는 README 참고) */
export async function applyEdit(projectId: string, edit: EditOp): Promise<DraftResult & { redo: string[] }> {
  const project = await loadProject(projectId);
  const prev = await loadPlan(projectId);
  if (!prev) throw new Error("초안을 먼저 만들어 주세요.");
  let segments = await loadSegments(project);
  const plan: EditPlan = structuredClone(prev);
  plan.version = prev.version + 1;
  plan.createdAt = new Date().toISOString();
  const redo: string[] = [];

  switch (edit.op) {
    case "captionScale":
      plan.captionStyle.scale = Math.min(1.5, Math.max(0.8, edit.scale));
      redo.push("자막 배치", "미리보기 렌더");
      break;
    case "editSentence": {
      const s = plan.sentences.find((x) => x.id === edit.sentenceId);
      if (!s) throw new Error("문장을 찾을 수 없습니다.");
      s.text = edit.text.trim();
      s.caption = edit.caption?.trim() || undefined;
      s.locked = true;
      redo.push(`음성(${s.block} 블록)`, "타이밍", "미리보기 렌더");
      break;
    }
    case "shorter": {
      const removable = plan.sentences.filter((s) => !s.locked && s.priority > 1).sort((a, b) => b.priority - a.priority);
      if (!removable.length) throw new Error("더 줄일 수 있는 문장이 없습니다(필수·고정 문장만 남음).");
      plan.sentences = plan.sentences.filter((s) => s.id !== removable[0].id);
      redo.push("타이밍", "미리보기 렌더");
      break;
    }
    case "newHook": {
      const hook = plan.sentences.find((s) => s.role === "hook");
      if (!hook) throw new Error("시작 문장이 없습니다.");
      const next = await newHook(project, prev, segments);
      plan.hookHistory = [...plan.hookHistory, hook.text];
      hook.text = next.text;
      hook.caption = undefined;
      redo.push(next.viaAi ? "시작 문구(AI)" : "시작 문구(규칙)", "시작 음성", "타이밍", "미리보기 렌더");
      break;
    }
    case "swapScene": {
      const s = plan.sentences.find((x) => x.id === edit.sentenceId);
      const seg = segments.find((x) => x.id === edit.segmentId);
      if (!s || !seg || seg.status === "excluded") throw new Error("바꿀 장면을 찾을 수 없습니다.");
      s.segmentIds = [seg.id];
      s.sceneReason = "사용자가 선택한 장면";
      s.locked = true;
      redo.push("해당 컷", "타이밍", "미리보기 렌더");
      break;
    }
    case "confirmAsset":
    case "excludeAsset": {
      const asset = project.assets.find((a) => a.id === edit.assetId);
      if (!asset) throw new Error("소재를 찾을 수 없습니다.");
      if (edit.op === "confirmAsset") asset.productConfirmed = edit.confirmed;
      else asset.excluded = true;
      await saveProject(project);
      segments = await loadSegments(project);
      if (edit.op === "excludeAsset" || !edit.confirmed) {
        const { assignScenes } = await import("./planner");
        const gone = new Set(segments.filter((s) => s.status === "excluded").map((s) => s.id));
        const affected = plan.sentences.map((s) => ({ ...s, segmentIds: s.segmentIds.filter((id) => !gone.has(id)) }));
        const reassigned = assignScenes(project, affected.map((s) => (s.segmentIds.length ? { ...s, locked: true } : s)), segments);
        plan.sentences = reassigned.map((s, i) => ({ ...s, locked: affected[i].locked }));
        plan.sourceHashes = Object.fromEntries(project.assets.filter((a) => !a.excluded).map((a) => [a.id, a.hash]));
        redo.push("관련 컷 재배치", "타이밍", "미리보기 렌더");
      } else {
        // 확인만 바뀐 경우 계획·렌더는 그대로
        const timeline = (await loadTimeline(projectId))!;
        const review = await computeReview(project, prev, timeline, segments);
        const preview = (await readJson<RenderOutput>(path.join(projectDir(projectId), "preview.json")))!;
        return { plan: prev, timeline, preview, review, notices: [], redo: ["확인 상태 갱신"] };
      }
      break;
    }
  }

  await savePlan(plan);
  await logStep(projectId, { step: "edit", op: edit.op, planVersion: plan.version, redo });
  const { timeline } = await stepVoiceTimeline(project, plan, segments);
  const review = await computeReview(project, plan, timeline, segments);
  const preview = await stepPreview(project, plan, timeline);
  await writeJson(path.join(projectDir(projectId), "preview.json"), { ...preview, planVersion: plan.version, notices: [] });
  return { plan, timeline, preview, review, notices: [], redo };
}

export interface ExportResult {
  ok: boolean;
  blocked?: ReviewItem[];
  folder: string;
  outputs: (RenderOutput & { verify: VerifyReport; packageDir: string })[];
}

/** 3단계: 저장. 최종 해상도로 렌더 → 검사 → 패키지(MP4·SRT·표지·게시 문구·프로젝트 기록) */
export async function exportPackage(projectId: string, platforms: PlatformId[]): Promise<ExportResult> {
  const project = await loadProject(projectId);
  const plan = await loadPlan(projectId);
  const timeline = await loadTimeline(projectId);
  if (!plan || !timeline) throw new Error("초안을 먼저 만들어 주세요.");
  const segments = await loadSegments(project);
  const review = await computeReview(project, plan, timeline, segments);
  const folderRel = path.join("export", `v${plan.version}`);
  const blocking = review.filter((r) => r.blocking);
  if (blocking.length) return { ok: false, blocked: blocking, folder: folderRel, outputs: [] };

  const errors = await validateForRender(project, plan, timeline);
  if (errors.length) throw new Error(`편집 계획 검사 실패:\n- ${errors.join("\n- ")}`);

  const outputs: ExportResult["outputs"] = [];
  for (const platform of platforms) {
    const out = await timed(projectId, `final:${platform}`, () => renderPlatform(project, plan, timeline, platform, "final"), `${PLATFORMS[platform].label} 최종 렌더 중`);
    const verify = await verifyOutput(resolveInProject(projectId, out.videoRel), {
      width: PROFILES.final.width,
      height: PROFILES.final.height,
      timeline,
      plan,
      platform,
      review,
    });
    const pkgRel = path.join(folderRel, platform);
    const pkg = resolveInProject(projectId, pkgRel);
    await mkdir(pkg, { recursive: true });
    const slug = project.product.name.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 30);
    await copyFile(resolveInProject(projectId, out.videoRel), path.join(pkg, `${slug}_${platform}.mp4`));
    await copyFile(resolveInProject(projectId, out.srtRel), path.join(pkg, `${slug}_${platform}.srt`));
    await copyFile(resolveInProject(projectId, out.coverRel), path.join(pkg, "cover.jpg"));
    if (out.coverGridRel) await copyFile(resolveInProject(projectId, out.coverGridRel), path.join(pkg, "cover_grid_4x5.jpg"));
    const text = postText(project.product, plan, platform);
    await writeFile(path.join(pkg, "post.txt"), `${text.title}\n\n${text.body}\n`);
    await writeJson(path.join(pkg, "verify.json"), verify);
    await updateStep(projectId, `final:${platform}`, { status: verify.ok ? "done" : "failed", error: verify.ok ? undefined : "출력 검사 실패" });
    outputs.push({ ...out, verify, packageDir: pkgRel });
  }

  // 승인한 사실·편집 계획·실행 기록 보관
  const rec = resolveInProject(projectId, path.join(folderRel, "project"));
  await mkdir(rec, { recursive: true });
  await writeJson(path.join(rec, "product.json"), project.product);
  await writeJson(path.join(rec, "edit_plan.json"), plan);
  await writeJson(path.join(rec, "timeline.json"), timeline);
  await writeJson(path.join(rec, "review.json"), review);
  await writeJson(path.join(rec, "calls.json"), await readLog<CallLogEntry>(projectId, "calls"));
  await writeJson(path.join(rec, "steps.json"), await readLog(projectId, "steps"));

  return { ok: outputs.every((o) => o.verify.ok), folder: folderRel, outputs };
}

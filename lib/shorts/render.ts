import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAss, buildSrt, CAPTION_FONT, wrapLines } from "./captions";
import { ffmpeg, filterPath, hashOf, writeAtomically } from "./media";
import { FRAME, PLATFORMS } from "./platforms";
import { resolveInProject } from "./store";
import type { Cut, EditPlan, PlatformId, Project, SourceAsset, Timeline } from "./types";

export type RenderProfileId = "preview" | "final";

interface RenderProfile {
  id: RenderProfileId;
  width: number;
  height: number;
  /** 컷 중간 파일 품질 */
  cutCrf: number;
  crf: number;
  preset: string;
}

/** 미리보기와 최종본은 해상도·인코딩 품질만 다르다. 장면·문장·음성·자막 상대 위치는 같다 */
export const PROFILES: Record<RenderProfileId, RenderProfile> = {
  preview: { id: "preview", width: 540, height: 960, cutCrf: 24, crf: 28, preset: "veryfast" },
  final: { id: "final", width: FRAME.width, height: FRAME.height, cutCrf: 14, crf: 19, preset: "medium" },
};

export function fontDir(): string {
  return process.env.SHORTS_FONT_DIR || path.join(process.cwd(), "node_modules", "pretendard", "dist", "public", "static");
}

async function exists(p: string) {
  try {
    return (await stat(p)).size > 0;
  } catch {
    return false;
  }
}

function isPortrait(a: SourceAsset) {
  return a.width / a.height <= 0.6;
}

/** 세로 소재는 꽉 채우고, 가로·정사각 소재는 흐린 배경 위에 전체를 보여 상품이 잘리지 않게 한다 */
function frameGraph(a: SourceAsset, W: number, H: number, pre: string): string {
  if (isPortrait(a)) return `[0:v]${pre}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[v]`;
  return [
    `[0:v]${pre}split[a][b]`,
    `[a]scale=${Math.round(W / 4)}:${Math.round(H / 4)}:force_original_aspect_ratio=increase,crop=${Math.round(W / 4)}:${Math.round(H / 4)},boxblur=8:2,eq=brightness=-0.10:saturation=0.8,scale=${W}:${H}[bg]`,
    `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`,
  ].join(";");
}

const ENC = (crf: number, preset: string) => ["-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p", "-r", String(FRAME.fps), "-an"];

async function renderCut(project: Project, asset: SourceAsset, c: Cut, profile: RenderProfile, index: number): Promise<{ file: string; reused: boolean }> {
  // 부동소수점 오차로 같은 컷의 캐시 키가 달라지지 않도록 ms 단위로 맞춘다
  const outDur = Math.round((c.outEnd - c.outStart) * 1000) / 1000;
  const key = hashOf({ h: asset.hash, s: c.srcStart, e: c.srcEnd, d: outDur, f: c.fill, p: profile.id, v: 2, k: asset.kind === "image" ? index % 2 : 0 });
  const out = resolveInProject(project.id, path.join("cache", "cuts", `${key}.mp4`));
  if (await exists(out)) return { file: out, reused: true };
  await mkdir(path.dirname(out), { recursive: true });
  const src = resolveInProject(project.id, asset.path);
  const { width: W, height: H } = profile;

  if (asset.kind === "image") {
    // 사진형: 천천히 확대(짝수 컷) 또는 축소(홀수 컷). 실제 작동 영상처럼 꾸미지 않는다.
    const frames = Math.max(1, Math.round(outDur * FRAME.fps));
    const zoomIn = index % 2 === 0;
    const z = zoomIn ? `1+0.08*on/${frames}` : `1.08-0.08*on/${frames}`;
    const graph = frameGraph(asset, W * 2, H * 2, "").replace(
      /\[v\]$/,
      `,zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FRAME.fps},setsar=1[v]`,
    );
    await writeAtomically(out, (tmp) => ffmpeg(["-i", src, "-filter_complex", graph, "-map", "[v]", "-frames:v", String(frames), ...ENC(profile.cutCrf, profile.preset), tmp]));
    return { file: out, reused: false };
  }

  const srcDur = Math.max(0.05, c.srcEnd - c.srcStart);
  let pre = `fps=${FRAME.fps},`;
  if (c.fill === "slow") pre = `setpts=PTS*${(outDur / srcDur).toFixed(4)},fps=${FRAME.fps},`;
  let graph = frameGraph(asset, W, H, pre);
  if (c.fill === "freeze" && outDur > srcDur) graph = graph.replace(/\[v\]$/, `,tpad=stop_mode=clone:stop_duration=${(outDur - srcDur + 0.1).toFixed(3)}[v]`);
  await writeAtomically(out, (tmp) =>
    ffmpeg([
      "-ss",
      c.srcStart.toFixed(3),
      "-t",
      (c.fill === "slow" ? srcDur : Math.min(srcDur, outDur) + 0.05).toFixed(3),
      "-i",
      src,
      "-filter_complex",
      graph,
      "-map",
      "[v]",
      "-t",
      outDur.toFixed(3),
      ...ENC(profile.cutCrf, profile.preset),
      tmp,
    ]),
  );
  return { file: out, reused: false };
}

/** 마지막 안내 배경: 기준 사진(없으면 마지막 컷 화면)을 위쪽에 두고 흐린 배경을 깐다 */
async function renderEndCard(project: Project, timeline: Timeline, lastCutFile: string, profile: RenderProfile): Promise<string> {
  const dur = timeline.endCard.end - timeline.endCard.start;
  const ref = project.assets.find((a) => a.id === timeline.endCard.assetId);
  const key = hashOf({ ref: ref?.hash, last: path.basename(lastCutFile), d: dur, p: profile.id, v: 2 });
  const out = resolveInProject(project.id, path.join("cache", "cuts", `end-${key}.mp4`));
  if (await exists(out)) return out;
  const { width: W, height: H } = profile;
  const input = ref ? ["-loop", "1", "-i", resolveInProject(project.id, ref.path)] : ["-sseof", "-0.1", "-i", lastCutFile];
  const boxW = Math.round(W * 0.7);
  const boxH = Math.round(H * 0.27);
  const top = Math.round(H * 0.15);
  const graph = [
    `[0:v]fps=${FRAME.fps},split[a][b]`,
    `[a]scale=${Math.round(W / 4)}:${Math.round(H / 4)}:force_original_aspect_ratio=increase,crop=${Math.round(W / 4)}:${Math.round(H / 4)},boxblur=10:2,eq=brightness=-0.28:saturation=0.7,scale=${W}:${H}[bg]`,
    `[b]scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease[fg]`,
    `[bg][fg]overlay=(W-w)/2:${top},setsar=1,tpad=stop_mode=clone:stop_duration=${dur.toFixed(3)}[v]`,
  ].join(";");
  await writeAtomically(out, (tmp) => ffmpeg([...input, "-filter_complex", graph, "-map", "[v]", "-t", dur.toFixed(3), ...ENC(profile.cutCrf, profile.preset), tmp]));
  return out;
}

export interface RenderOutput {
  platform: PlatformId;
  profile: RenderProfileId;
  videoRel: string;
  srtRel: string;
  assRel: string;
  coverRel: string;
  coverGridRel?: string;
  renderMs: number;
  reusedCuts: number;
  renderedCuts: number;
}

/** 자막 없는 본편(컷 + 마지막 안내 배경). 모든 플랫폼이 공유한다 */
async function renderBase(project: Project, timeline: Timeline, profile: RenderProfile) {
  const assetById = new Map(project.assets.map((a) => [a.id, a]));
  const files: string[] = [];
  let reused = 0;
  for (const [i, c] of timeline.cuts.entries()) {
    const r = await renderCut(project, assetById.get(c.assetId)!, c, profile, i);
    files.push(r.file);
    if (r.reused) reused++;
  }
  files.push(await renderEndCard(project, timeline, files[files.length - 1], profile));
  const key = hashOf(files.map((f) => path.basename(f)));
  const base = resolveInProject(project.id, path.join("cache", "base", `${profile.id}-${key}.mp4`));
  if (!(await exists(base))) {
    await mkdir(path.dirname(base), { recursive: true });
    const list = `${base}.txt`;
    await writeFile(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    await writeAtomically(base, (tmp) => ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", tmp]));
  }
  return { base, reused, rendered: timeline.cuts.length - reused };
}

export async function renderPlatform(project: Project, plan: EditPlan, timeline: Timeline, platform: PlatformId, profileId: RenderProfileId): Promise<RenderOutput> {
  const started = Date.now();
  const profile = PROFILES[profileId];
  const { base, reused, rendered } = await renderBase(project, timeline, profile);
  const dirRel = path.join("renders", `v${plan.version}`, profileId);
  const dir = resolveInProject(project.id, dirRel);
  await mkdir(dir, { recursive: true });

  const assRel = path.join(dirRel, `${platform}.ass`);
  const srtRel = path.join(dirRel, `${platform}.srt`);
  await writeFile(resolveInProject(project.id, assRel), buildAss(plan, timeline, platform, project.product));
  await writeFile(resolveInProject(project.id, srtRel), buildSrt(plan, timeline, platform));

  const videoRel = path.join(dirRel, `${platform}.mp4`);
  const total = timeline.totalDuration;
  const fonts = fontDir();
  await ffmpeg([
    "-i",
    base,
    "-i",
    resolveInProject(project.id, timeline.audioPath),
    "-filter_complex",
    `[0:v]ass=filename='${filterPath(resolveInProject(project.id, assRel))}':fontsdir='${filterPath(fonts)}'[v];[1:a]apad,atrim=0:${total.toFixed(3)},loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    profile.preset,
    "-crf",
    String(profile.crf),
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FRAME.fps),
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    "-t",
    total.toFixed(3),
    "-movflags",
    "+faststart",
    resolveInProject(project.id, videoRel),
  ]);

  const { coverRel, coverGridRel } = await renderCover(project, plan, timeline, platform, base, dirRel);
  return { platform, profile: profileId, videoRel, srtRel, assRel, coverRel, coverGridRel, renderMs: Date.now() - started, reusedCuts: reused, renderedCuts: rendered };
}

/** 표지: 시작 장면 위에 제목. 릴스는 프로필 격자(4:5)에서도 제목이 보이도록 가운데 영역에 둔다 */
async function renderCover(project: Project, plan: EditPlan, timeline: Timeline, platform: PlatformId, base: string, dirRel: string) {
  const p = PLATFORMS[platform];
  const hook = plan.sentences.find((s) => s.role === "hook");
  const title = (hook?.caption || hook?.text || project.product.name).replace(/[.]$/, "");
  const firstCut = timeline.cuts[0];
  const at = firstCut ? Math.min(firstCut.outEnd - 0.05, firstCut.outStart + 0.6) : 0;
  const size = 104;
  const lines = wrapLines(title, FRAME.width - 140, size).slice(0, 3);
  const cy = Math.round((p.coverTextArea.top + p.coverTextArea.bottom) / 2);
  const ass = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${FRAME.width}`,
    `PlayResY: ${FRAME.height}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cover,${CAPTION_FONT},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,8,3,5,70,70,0,1`,
    `Style: Brand,Pretendard Bold,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,3,14,0,5,70,70,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 1,0:00:00.00,0:00:10.00,Cover,,0,0,0,,{\\pos(540,${cy})}${lines.map((l) => l.replace(/[{}\\]/g, "")).join("\\N")}`,
    `Dialogue: 1,0:00:00.00,0:00:10.00,Brand,,0,0,0,,{\\pos(540,${p.coverTextArea.bottom - 40})\\3c${plan.design.brandColor.replace(/^#?(..)(..)(..)$/, "&H$3$2$1&")}}${project.product.name.replace(/[{}\\]/g, "")}`,
    "",
  ].join("\n");
  const assRel = path.join(dirRel, `${platform}-cover.ass`);
  await writeFile(resolveInProject(project.id, assRel), ass);
  const coverRel = path.join(dirRel, `${platform}-cover.jpg`);
  await ffmpeg([
    "-ss",
    at.toFixed(3),
    "-i",
    base,
    "-frames:v",
    "1",
    "-vf",
    `scale=${FRAME.width}:${FRAME.height},eq=brightness=-0.12,ass=filename='${filterPath(resolveInProject(project.id, assRel))}':fontsdir='${filterPath(fontDir())}'`,
    "-q:v",
    "3",
    resolveInProject(project.id, coverRel),
  ]);
  let coverGridRel: string | undefined;
  if (platform !== "youtube_shorts") {
    coverGridRel = path.join(dirRel, `${platform}-cover-grid-4x5.jpg`);
    const top = Math.round((FRAME.height - FRAME.width * 1.25) / 2);
    await ffmpeg(["-i", resolveInProject(project.id, coverRel), "-vf", `crop=${FRAME.width}:${FRAME.width * 1.25}:0:${top}`, "-q:v", "3", resolveInProject(project.id, coverGridRel)]);
  }
  return { coverRel, coverGridRel };
}

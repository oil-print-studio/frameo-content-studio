import { mkdir } from "node:fs/promises";
import path from "node:path";
import { GEMINI_MODELS, generateJson, hasGemini } from "./gemini";
import { ffmpeg, round3 } from "./media";
import { logCall, projectDir, readJson, resolveInProject, writeJson } from "./store";
import type { AssetAnalysis, Project, ReviewItem, Segment, SourceAsset } from "./types";

const LOCAL_ANALYZER = "local-v1";
const GEMINI_PROMPT_VERSION = "analysis-v1";
const MAX_SEGMENT = 4;
const MIN_SEGMENT = 0.8;

export function analyzerKey(): string {
  return hasGemini() ? `gemini:${GEMINI_MODELS.analysis}:${GEMINI_PROMPT_VERSION}` : LOCAL_ANALYZER;
}

function orientationOf(a: SourceAsset): Segment["quality"]["orientation"] {
  const r = a.width / a.height;
  if (r < 0.9) return "portrait";
  if (r > 1.1) return "landscape";
  return "square";
}

/** 장면 전환·검은 구간을 찾아 의미 있는 구간으로 나눈다 (AI 없이 동작) */
async function detectLocal(file: string, duration: number) {
  const { stderr } = await ffmpeg(
    ["-i", file, "-an", "-vf", "fps=10,scale=160:-2,blackdetect=d=0.2:pix_th=0.10,scdet=t=10", "-f", "null", "-"],
    { allowFail: true },
  );
  const cuts = [...stderr.matchAll(/lavfi\.scd\.time: ([\d.]+)/g)].map((m) => Number(m[1]));
  const blacks = [...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({
    start: Number(m[1]),
    end: Number(m[2]),
  }));
  const bounds = [0, ...cuts.filter((t) => t > MIN_SEGMENT && t < duration - MIN_SEGMENT), duration];
  const ranges: { start: number; end: number }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const s = bounds[i];
    const e = bounds[i + 1];
    if (e - s < MIN_SEGMENT && ranges.length) {
      ranges[ranges.length - 1].end = e;
      continue;
    }
    const pieces = Math.max(1, Math.ceil((e - s) / MAX_SEGMENT));
    const len = (e - s) / pieces;
    for (let k = 0; k < pieces; k++) ranges.push({ start: s + k * len, end: s + (k + 1) * len });
  }
  return ranges.map((r) => {
    const overlap = blacks.reduce((acc, b) => acc + Math.max(0, Math.min(r.end, b.end) - Math.max(r.start, b.start)), 0);
    return { ...r, blackRatio: overlap / Math.max(0.001, r.end - r.start) };
  });
}

interface GeminiSegment {
  start: number;
  end: number;
  observed: string[];
  productMatch: "matches" | "suspected_different" | "unverified";
  matchNote: string;
  burnedCaption: "none" | "top" | "middle" | "bottom";
  usable: boolean;
  reason: string;
}

const GEMINI_SCHEMA = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start: { type: "number", description: "구간 시작(초)" },
          end: { type: "number", description: "구간 종료(초)" },
          observed: { type: "array", items: { type: "string" }, description: "화면에 실제로 보이는 제품 특징·동작" },
          productMatch: { type: "string", enum: ["matches", "suspected_different", "unverified"] },
          matchNote: { type: "string", description: "기준 상품과 같다고 본 근거 또는 다른 점" },
          burnedCaption: { type: "string", enum: ["none", "top", "middle", "bottom"] },
          usable: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["start", "end", "observed", "productMatch", "matchNote", "burnedCaption", "usable", "reason"],
      },
    },
  },
  required: ["segments"],
};

async function analyzeWithGemini(project: Project, asset: SourceAsset): Promise<GeminiSegment[]> {
  const ref = project.assets.find((a) => a.id === project.product.referenceAssetId && a.id !== asset.id);
  const files = [];
  if (ref) files.push({ path: resolveInProject(project.id, ref.path), mimeType: ref.kind === "image" ? mimeOf(ref.fileName) : "video/mp4" });
  files.push({ path: resolveInProject(project.id, asset.path), mimeType: asset.kind === "image" ? mimeOf(asset.fileName) : "video/mp4" });
  const prompt = [
    `판매 상품: ${project.product.name}`,
    ref ? "첫 번째 파일은 기준 상품 사진/영상이고, 마지막 파일이 분석할 소재다." : "분석할 소재 하나가 주어진다.",
    `소재 길이: ${asset.duration.toFixed(2)}초`,
    "소재를 1~4초의 의미 있는 구간으로 나누고, 각 구간에 실제로 보이는 제품 특징과 동작만 적어라.",
    "외형이 비슷하다는 이유만으로 같은 상품으로 판단하지 말 것. 모양·구성·기능이 다르면 suspected_different, 판단이 어려우면 unverified.",
    "재질·인증·내구성·효과처럼 화면만으로 확인할 수 없는 내용은 observed 에 쓰지 말 것.",
    "원본 영상에 박힌 자막이 있으면 위치를 burnedCaption 에 적어라. 흐림·심한 흔들림·가림이 있으면 usable=false 와 이유를 적어라.",
  ].join("\n");
  const out = await generateJson<{ segments: GeminiSegment[] }>({
    projectId: project.id,
    task: `analyze:${asset.fileName}`,
    model: GEMINI_MODELS.analysis,
    prompt,
    schema: GEMINI_SCHEMA,
    files,
  });
  return out.segments;
}

function mimeOf(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
}

async function makeThumb(project: Project, asset: SourceAsset, seg: Segment): Promise<string> {
  const rel = path.join("cache", "thumbs", `${seg.id}.jpg`);
  const abs = resolveInProject(project.id, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  const src = resolveInProject(project.id, asset.path);
  const at = asset.kind === "video" ? Math.max(0, (seg.start + seg.end) / 2) : 0;
  await ffmpeg([...(asset.kind === "video" ? ["-ss", at.toFixed(3)] : []), "-i", src, "-frames:v", "1", "-vf", "scale=270:-2", "-q:v", "5", abs]);
  return rel;
}

/** 소재 하나 분석. 내용 해시 + 분석 설정이 같으면 저장된 결과를 재사용한다. */
export async function analyzeAsset(project: Project, asset: SourceAsset): Promise<AssetAnalysis> {
  const key = analyzerKey();
  const cacheFile = path.join(projectDir(project.id), "cache", "analysis", `${asset.hash.slice(0, 20)}-${key.replace(/[^a-z0-9.-]/gi, "_")}.json`);
  const cached = await readJson<AssetAnalysis>(cacheFile);
  if (cached && cached.assetId === asset.id) {
    await logCall(project.id, { provider: key.startsWith("gemini") ? "gemini" : "local", task: `analyze:${asset.fileName}`, reused: true, ok: true, durationMs: 0 });
    return cached;
  }

  const started = Date.now();
  const orientation = orientationOf(asset);
  let segments: Segment[];
  const base = { assetId: asset.id, thumbnail: undefined };

  if (asset.kind === "image") {
    segments = [
      {
        ...base,
        id: `${asset.id}-s0`,
        start: 0,
        end: 0,
        observed: [],
        productMatch: "unverified",
        quality: { orientation },
        status: "usable",
        analyzer: "local",
      },
    ];
  } else if (hasGemini()) {
    const raw = await analyzeWithGemini(project, asset);
    segments = raw
      .map((g, i): Segment => {
        const start = Math.max(0, Math.min(asset.duration, g.start));
        const end = Math.max(start, Math.min(asset.duration, g.end));
        return {
          ...base,
          id: `${asset.id}-s${i}`,
          start: round3(start),
          end: round3(end),
          observed: g.observed,
          productMatch: g.productMatch,
          matchNote: g.matchNote,
          quality: { orientation, burnedCaption: g.burnedCaption },
          status: !g.usable ? "excluded" : g.productMatch === "matches" ? "usable" : "review",
          statusReason: g.reason,
          analyzer: "gemini",
        };
      })
      .filter((s) => s.end - s.start >= 0.3);
  } else {
    const ranges = await detectLocal(resolveInProject(project.id, asset.path), asset.duration);
    segments = ranges.map((r, i) => ({
      ...base,
      id: `${asset.id}-s${i}`,
      start: round3(r.start),
      end: round3(r.end),
      observed: [],
      productMatch: "unverified",
      quality: { orientation, blackRatio: round3(r.blackRatio), burnedCaption: "unknown" },
      status: r.blackRatio > 0.5 ? "excluded" : "usable",
      statusReason: r.blackRatio > 0.5 ? "검은 화면이 절반 이상" : undefined,
      analyzer: "local",
    }));
  }

  for (const seg of segments) seg.thumbnail = await makeThumb(project, asset, seg);

  const analysis: AssetAnalysis = { assetId: asset.id, hash: asset.hash, analyzerKey: key, segments, createdAt: new Date().toISOString() };
  await writeJson(cacheFile, analysis);
  if (!key.startsWith("gemini")) {
    await logCall(project.id, { provider: "local", task: `analyze:${asset.fileName}`, reused: false, ok: true, durationMs: Date.now() - started });
  }
  return analysis;
}

/** 독립적인 소재 분석을 제한된 수로 병렬 실행 */
export async function analyzeAll(project: Project, concurrency = 2): Promise<Segment[]> {
  const assets = project.assets.filter((a) => !a.excluded);
  const results: AssetAnalysis[] = new Array(assets.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, assets.length) }, async () => {
      while (next < assets.length) {
        const i = next++;
        results[i] = await analyzeAsset(project, assets[i]);
      }
    }),
  );
  return results.flatMap((r) => r.segments);
}

/** 사용자 확인 상태를 반영한 구간 상태 */
export function effectiveSegments(project: Project, segments: Segment[]): Segment[] {
  return segments.map((s) => {
    const asset = project.assets.find((a) => a.id === s.assetId);
    if (!asset || asset.excluded) return { ...s, status: "excluded", statusReason: "사용자가 제외한 소재" };
    if (s.status === "excluded") return s;
    if (asset.productConfirmed) return { ...s, status: "usable" };
    if (s.productMatch === "suspected_different") return { ...s, status: "review" };
    if (asset.productConfirmed === undefined && s.productMatch !== "matches")
      return { ...s, status: "review", statusReason: s.statusReason ?? "판매 상품을 촬영한 소재인지 확인 필요" };
    return s;
  });
}

export function assetReviewItems(project: Project, segments: Segment[]): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const asset of project.assets) {
    if (asset.excluded || asset.productConfirmed) continue;
    const segs = segments.filter((s) => s.assetId === asset.id);
    const suspected = segs.filter((s) => s.productMatch === "suspected_different");
    if (suspected.length) {
      items.push({
        id: `mismatch-${asset.id}`,
        kind: "product_mismatch",
        blocking: true,
        assetId: asset.id,
        message: `${asset.fileName}: 판매 상품과 다른 상품일 수 있음 — ${suspected[0].matchNote ?? "외형·기능 차이"}`,
      });
    } else if (segs.some((s) => s.productMatch !== "matches")) {
      items.push({
        id: `confirm-${asset.id}`,
        kind: "asset_unconfirmed",
        blocking: true,
        assetId: asset.id,
        message: `${asset.fileName}: 실제 판매 상품을 촬영한 소재인지 확인해 주세요.`,
      });
    }
  }
  return items;
}

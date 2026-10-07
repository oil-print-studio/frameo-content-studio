import { stat } from "node:fs/promises";
import { hashFile, round3 } from "./media";
import { resolveInProject } from "./store";
import type { Cut, EditPlan, Project, ReviewItem, Segment, Timeline } from "./types";
import type { VoiceTrack } from "./voice";

/** 원본이 이 비율 이내로 짧으면 살짝 느리게, 그보다 짧으면 다른 구간을 잇는다 */
const MAX_SLOW = 1.25;
const MIN_CUT = 0.35;

export function buildTimeline(project: Project, plan: EditPlan, segments: Segment[], track: VoiceTrack): Timeline {
  const segById = new Map(segments.map((s) => [s.id, s]));
  const assetById = new Map(project.assets.map((a) => [a.id, a]));
  const warnings: string[] = [];
  const cuts: Cut[] = [];
  const usedSegs = new Set<string>();
  const timings = plan.sentences.map((s) => track.timings.find((t) => t.sentenceId === s.id)!).filter(Boolean);
  // 컷 경계는 누적 문장 위치 기준(파일 실측 길이의 ms 오차가 컷 캐시를 깨지 않게)
  const lastTiming = timings[timings.length - 1];
  const speechEnd = lastTiming ? lastTiming.end : track.duration;

  // 다른 문장에 배정된 구간은 남는 구간이 없을 때만 빌려 쓴다(같은 화면 반복 방지)
  const reserved = new Set(plan.sentences.flatMap((s) => s.segmentIds));
  const spare = () =>
    segments
      .filter((s) => s.status !== "excluded" && s.end > s.start && !usedSegs.has(s.id))
      .sort((a, b) => Number(reserved.has(a.id)) - Number(reserved.has(b.id)) || Number(a.status !== "usable") - Number(b.status !== "usable"));

  plan.sentences.forEach((sentence, i) => {
    const outStart = i === 0 ? 0 : timings[i].start;
    const outEnd = i === plan.sentences.length - 1 ? speechEnd : timings[i + 1].start;
    let cursor = outStart;
    const queue = sentence.segmentIds.map((id) => segById.get(id)).filter((s): s is Segment => Boolean(s));
    if (!queue.length) {
      const fallback = spare()[0] ?? segments.find((s) => s.status !== "excluded");
      if (fallback) queue.push(fallback);
      warnings.push(`“${sentence.text}”에 연결된 장면이 없어 다른 구간을 사용`);
    }
    while (cursor < outEnd - 0.01) {
      const need = outEnd - cursor;
      const seg = queue.shift() ?? spare()[0];
      if (!seg) {
        // 이을 구간이 없으면 마지막 컷을 정지 화면으로 늘린다
        const last = cuts[cuts.length - 1];
        if (last) {
          last.outEnd = round3(outEnd);
          last.fill = "freeze";
          warnings.push(`“${sentence.text}”: 장면이 부족해 정지 화면으로 채움`);
        }
        break;
      }
      usedSegs.add(seg.id);
      const asset = assetById.get(seg.assetId)!;
      if (asset.kind === "image") {
        cuts.push({ sentenceId: sentence.id, assetId: asset.id, segmentId: seg.id, srcStart: 0, srcEnd: 0, outStart: round3(cursor), outEnd: round3(outEnd), fill: "none" });
        cursor = outEnd;
        continue;
      }
      // 같은 소재에서 구간 뒤로 이어지는 화면까지 쓸 수 있으면 늘린다
      const nextExcluded = segments.find((s) => s.assetId === asset.id && s.start >= seg.end - 0.01 && s.status === "excluded");
      const hardEnd = nextExcluded ? nextExcluded.start : asset.duration;
      // 다른 문장에 배정된 구간을 빌릴 때는 그 문장과 덜 겹치도록 구간 끝부분을 쓴다
      const borrowed = reserved.has(seg.id) && !sentence.segmentIds.includes(seg.id);
      const from = borrowed ? Math.max(seg.start, seg.end - need) : seg.start;
      const available = Math.max(0, Math.min(hardEnd, from + need) - from);
      if (available >= need - 0.01) {
        cuts.push(cut(sentence.id, seg, from, from + need, cursor, outEnd));
        cursor = outEnd;
      } else if (available * MAX_SLOW >= need) {
        cuts.push({ ...cut(sentence.id, seg, from, from + available, cursor, outEnd), fill: "slow" });
        cursor = outEnd;
      } else if (available >= MIN_CUT) {
        cuts.push(cut(sentence.id, seg, from, from + available, cursor, cursor + available));
        cursor += available;
        if (!queue.length) warnings.push(`“${sentence.text}”: 원본 장면이 음성보다 짧아 다음 구간을 이어 붙임`);
      }
    }
  });

  const endCardSeconds = plan.output.endCardSeconds;
  const ref = project.assets.find((a) => a.id === project.product.referenceAssetId && !a.excluded && a.kind === "image");
  return {
    planVersion: plan.version,
    audioPath: track.audioRel,
    audioDuration: track.duration,
    speechEnd: round3(speechEnd),
    totalDuration: round3(speechEnd + endCardSeconds),
    sentences: track.timings,
    cuts,
    endCard: { start: round3(speechEnd), end: round3(speechEnd + endCardSeconds), assetId: ref?.id },
    warnings,
  };
}

function cut(sentenceId: string, seg: Segment, srcStart: number, srcEnd: number, outStart: number, outEnd: number): Cut {
  return { sentenceId, assetId: seg.assetId, segmentId: seg.id, srcStart: round3(srcStart), srcEnd: round3(srcEnd), outStart: round3(outStart), outEnd: round3(outEnd), fill: "none" };
}

export function timelineReviewItems(plan: EditPlan, t: Timeline): ReviewItem[] {
  const items: ReviewItem[] = [];
  const estimated = t.sentences.filter((s) => s.source === "estimated");
  if (estimated.length)
    items.push({
      id: "timing-estimated",
      kind: "timing_estimated",
      blocking: false,
      message: `자막 시작 시각 ${estimated.length}개가 추정값입니다(블록 음성). 미리보기에서 자막과 음성이 맞는지 확인하세요.`,
    });
  for (const c of t.cuts.filter((c) => c.fill === "freeze")) {
    const s = plan.sentences.find((x) => x.id === c.sentenceId);
    items.push({ id: `short-${c.sentenceId}`, kind: "short_scene", blocking: false, sentenceId: c.sentenceId, message: `“${s?.text}”: 장면이 부족해 정지 화면으로 채웠습니다. 장면 바꾸기나 소재 추가를 권합니다.` });
  }
  return items;
}

/**
 * 렌더 전 계획 검사: 실제 파일에 없는 구간, 누락·변경된 소재, 음성보다 짧은 컷, 빈 구간.
 * 문제가 있으면 렌더하지 않는다.
 */
export async function validateForRender(project: Project, plan: EditPlan, t: Timeline): Promise<string[]> {
  const errors: string[] = [];
  const assetById = new Map(project.assets.map((a) => [a.id, a]));
  for (const [id, hash] of Object.entries(plan.sourceHashes)) {
    const a = assetById.get(id);
    if (!a) {
      errors.push(`편집 계획의 소재가 프로젝트에 없음: ${id}`);
      continue;
    }
    try {
      const actual = await hashFile(resolveInProject(project.id, a.path));
      if (actual !== hash) errors.push(`${a.fileName}: 계획을 만든 뒤 파일 내용이 바뀜(다시 분석 필요)`);
    } catch {
      errors.push(`${a.fileName}: 파일이 없음`);
    }
  }
  try {
    if ((await stat(resolveInProject(project.id, t.audioPath))).size === 0) errors.push("음성 파일이 비어 있음");
  } catch {
    errors.push("음성 파일이 없음");
  }
  if (t.planVersion !== plan.version) errors.push("타임라인이 현재 편집 계획과 버전이 다름");
  let expected = 0;
  for (const c of t.cuts) {
    const a = assetById.get(c.assetId);
    if (!a) errors.push(`컷의 소재 없음: ${c.assetId}`);
    else if (a.kind === "video" && (c.srcStart < 0 || c.srcEnd > a.duration + 0.05)) errors.push(`${a.fileName}: 파일에 없는 구간 ${c.srcStart}~${c.srcEnd}초`);
    if (Math.abs(c.outStart - expected) > 0.02) errors.push(`${expected.toFixed(2)}초 부근에 빈 구간 또는 겹침`);
    if (c.outEnd - c.outStart <= 0) errors.push("길이가 0인 컷");
    expected = c.outEnd;
  }
  if (Math.abs(expected - t.speechEnd) > 0.05) errors.push(`컷 합계(${expected.toFixed(2)}초)가 음성 길이(${t.speechEnd.toFixed(2)}초)와 다름 — 음성이 잘릴 수 있음`);
  return errors;
}

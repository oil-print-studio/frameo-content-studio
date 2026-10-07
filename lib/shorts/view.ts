import path from "node:path";
import { GEMINI_MODELS, hasGemini } from "./gemini";
import { readJob } from "./jobs";
import { computeReview, loadPlan, loadTimeline } from "./pipeline";
import { effectiveSegments } from "./analyze";
import { loadProject, loadState, projectDir, readJson, readLog } from "./store";
import type { CallLogEntry, Segment } from "./types";
import { resolveVoice, voiceLabel } from "./voice";

/** 화면에 필요한 프로젝트 상태를 한 번에 모은다 */
export async function projectView(id: string) {
  const project = await loadProject(id);
  const [state, plan, timeline, job, rawSegments, preview, calls] = await Promise.all([
    loadState(id),
    loadPlan(id),
    loadTimeline(id),
    readJob(id),
    readJson<Segment[]>(path.join(projectDir(id), "segments.json")),
    readJson<Record<string, unknown>>(path.join(projectDir(id), "preview.json")),
    readLog<CallLogEntry>(id, "calls"),
  ]);
  const segments = rawSegments ? effectiveSegments(project, rawSegments) : [];
  const review = plan ? await computeReview(project, plan, timeline, segments) : [];
  return {
    project,
    state,
    plan,
    timeline,
    job,
    segments,
    review,
    preview,
    usage: {
      fresh: calls.filter((c) => !c.reused).length,
      reused: calls.filter((c) => c.reused).length,
      ai: calls.filter((c) => c.provider === "gemini" && !c.reused).length,
    },
    voiceLabel: plan ? voiceLabel(resolveVoice(plan.voice)) : undefined,
  };
}

export function capabilities() {
  return {
    gemini: hasGemini(),
    models: hasGemini() ? GEMINI_MODELS : undefined,
    analysis: hasGemini() ? `Gemini 영상 분석(${GEMINI_MODELS.analysis})` : "로컬 분석(장면 전환·검은 화면 검출, 장면 내용은 판별하지 않음)",
    script: hasGemini() ? `Gemini 대본(${GEMINI_MODELS.plan})` : "규칙 기반 대본(승인한 사실만 사용, AI 미사용)",
    voice: hasGemini() ? `Gemini TTS(${GEMINI_MODELS.tts})` : "로컬 테스트 음성(espeak-ng, 게시용 품질 아님)",
  };
}

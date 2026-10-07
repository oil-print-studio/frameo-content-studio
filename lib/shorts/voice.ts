import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { GEMINI_MODELS, hasGemini, synthesizeSpeech } from "./gemini";
import { ffmpeg, hashOf, mediaDuration, round3, run, writeAtomically } from "./media";
import { logCall, resolveInProject } from "./store";
import type { EditPlan, Project, Sentence, SentenceTiming, VoiceBlockId, VoiceSettings } from "./types";

const SAMPLE_RATE = 48000;
/** 블록 안 문장 사이 쉼, 블록 사이 쉼 */
const SENTENCE_GAP = 0.18;
const BLOCK_GAP = 0.3;
const BLOCK_ORDER: VoiceBlockId[] = ["hook", "body", "outro"];

/** espeak-ng 위치: 환경변수 → 운영체제별 기본 설치 위치 → PATH */
export function espeakPath(): string {
  if (process.env.ESPEAK_PATH) return process.env.ESPEAK_PATH;
  const candidates =
    process.platform === "win32"
      ? ["C:\\Program Files\\eSpeak NG\\espeak-ng.exe", "C:\\Program Files (x86)\\eSpeak NG\\espeak-ng.exe"]
      : process.platform === "darwin"
        ? ["/opt/homebrew/bin/espeak-ng", "/usr/local/bin/espeak-ng"]
        : [];
  return candidates.find((c) => existsSync(c)) ?? "espeak-ng";
}

/** 실제로 쓸 음성 엔진: Gemini 키가 없으면 로컬 엔진 */
export function resolveVoice(v: VoiceSettings): VoiceSettings {
  if (v.provider === "gemini" && !hasGemini()) return { provider: "local", voice: "ko", rate: v.rate ?? 175 };
  if (v.provider === "local") return { provider: "local", voice: "ko", rate: v.rate ?? 175 };
  return v;
}

export function voiceLabel(v: VoiceSettings): string {
  return v.provider === "gemini" ? `Gemini TTS (${GEMINI_MODELS.tts}, ${v.voice})` : "로컬 테스트 음성(espeak-ng)";
}

async function exists(p: string) {
  try {
    return (await stat(p)).size > 0;
  } catch {
    return false;
  }
}

/** 합성 결과를 48kHz 모노로 맞추고 앞뒤 무음을 정리 */
async function normalizeWav(src: string, dst: string) {
  await writeAtomically(dst, (tmp) => ffmpeg([
    "-i",
    src,
    "-af",
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse",
    "-ar",
    String(SAMPLE_RATE),
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    tmp,
  ]));
}

/** 텍스트 한 단위를 합성. (엔진·목소리·텍스트) 해시가 같으면 재사용 */
async function synthUnit(project: Project, v: VoiceSettings, text: string, task: string): Promise<{ file: string; duration: number; reused: boolean }> {
  const key = hashOf({ p: v.provider, m: v.provider === "gemini" ? GEMINI_MODELS.tts : "espeak", voice: v.voice, rate: v.rate, text });
  const rel = path.join("cache", "voice", `${key}.wav`);
  const file = resolveInProject(project.id, rel);
  if (await exists(file)) {
    await logCall(project.id, { provider: v.provider, model: v.provider === "gemini" ? GEMINI_MODELS.tts : "espeak-ng", task, reused: true, ok: true, durationMs: 0 });
    return { file, duration: await mediaDuration(file), reused: true };
  }
  await mkdir(path.dirname(file), { recursive: true });
  const raw = `${file}.raw.wav`;
  const started = Date.now();
  if (v.provider === "gemini") {
    await writeFile(raw, await synthesizeSpeech(project.id, text, v.voice));
  } else {
    await run(espeakPath(), ["-v", "ko", "-s", String(v.rate ?? 175), "-w", raw, text]);
    await logCall(project.id, { provider: "local", model: "espeak-ng", task, reused: false, ok: true, durationMs: Date.now() - started });
  }
  await normalizeWav(raw, file);
  return { file, duration: await mediaDuration(file), reused: false };
}

export interface VoiceTrack {
  audioRel: string;
  duration: number;
  timings: SentenceTiming[];
  voice: VoiceSettings;
  reusedUnits: number;
  synthesizedUnits: number;
}

/**
 * 음성 트랙 생성.
 *  - 로컬 엔진: 문장 단위로 합성해 블록으로 이어 붙인다 → 문장 경계 실측(measured)
 *  - Gemini: 블록 단위로 합성해 억양을 유지한다 → 블록 안 문장 경계는 글자 비율 추정(estimated)
 * 시작 문구만 바뀌면 본문·마무리 블록은 캐시를 재사용한다.
 */
export async function buildVoiceTrack(project: Project, plan: EditPlan): Promise<VoiceTrack> {
  const v = resolveVoice(plan.voice);
  const parts: { file: string; duration: number; gapAfter: number }[] = [];
  const timings: SentenceTiming[] = [];
  let cursor = 0;
  let reusedUnits = 0;
  let synthesizedUnits = 0;

  const blocks = BLOCK_ORDER.map((b) => ({ id: b, sentences: plan.sentences.filter((s) => s.block === b) })).filter((b) => b.sentences.length);

  for (const [bi, block] of blocks.entries()) {
    const isLastBlock = bi === blocks.length - 1;
    if (v.provider === "local") {
      for (const [si, s] of block.sentences.entries()) {
        const unit = await synthUnit(project, v, s.text, `tts:${s.id}`);
        if (unit.reused) reusedUnits++;
        else synthesizedUnits++;
        const gap = si < block.sentences.length - 1 ? SENTENCE_GAP : isLastBlock ? 0 : BLOCK_GAP;
        // 각 위치를 ms 단위로 누적해, 앞 문장이 바뀌어도 뒤 문장 사이 간격(=컷 길이)이 그대로 유지되게 한다
        const dur = round3(unit.duration);
        timings.push({ sentenceId: s.id, start: cursor, end: round3(cursor + dur), source: "measured" });
        parts.push({ file: unit.file, duration: dur, gapAfter: gap });
        cursor = round3(cursor + dur + gap);
      }
    } else {
      const text = block.sentences.map((s) => s.text).join(" ");
      const unit = await synthUnit(project, v, text, `tts:block:${block.id}`);
      if (unit.reused) reusedUnits++;
      else synthesizedUnits++;
      const dur = round3(unit.duration);
      timings.push(...estimateTimings(block.sentences, cursor, dur));
      const gap = isLastBlock ? 0 : BLOCK_GAP;
      parts.push({ file: unit.file, duration: dur, gapAfter: gap });
      cursor = round3(cursor + dur + gap);
    }
  }

  const key = hashOf(parts.map((p) => [path.basename(p.file), p.gapAfter]));
  const audioRel = path.join("cache", "voice", `track-${key}.wav`);
  const out = resolveInProject(project.id, audioRel);
  if (!(await exists(out))) {
    // 무음 간격을 넣어 이어 붙인다
    const args: string[] = [];
    const labels: string[] = [];
    parts.forEach((p, i) => {
      args.push("-i", p.file);
      labels.push(p.gapAfter > 0 ? `[a${i}]` : `[${i}:a]`);
    });
    const pads = parts
      .map((p, i) => (p.gapAfter > 0 ? `[${i}:a]apad=pad_dur=${p.gapAfter.toFixed(3)}[a${i}]` : ""))
      .filter(Boolean);
    const filter = [...pads, `${labels.join("")}concat=n=${parts.length}:v=0:a=1[out]`].join(";");
    await writeAtomically(out, (tmp) => ffmpeg([...args, "-filter_complex", filter, "-map", "[out]", "-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", tmp]));
  }
  const duration = await mediaDuration(out);
  return { audioRel, duration: round3(duration), timings, voice: v, reusedUnits, synthesizedUnits };
}

/** 블록 음성 안의 문장 경계를 글자 수 비율로 추정. 추정 상태는 숨기지 않고 확인 대상으로 표시한다. */
export function estimateTimings(sentences: Sentence[], offset: number, duration: number): SentenceTiming[] {
  const weights = sentences.map((s) => Math.max(1, s.text.replace(/\s/g, "").length));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = offset;
  return sentences.map((s, i) => {
    const len = (duration * weights[i]) / total;
    const timing: SentenceTiming = { sentenceId: s.id, start: round3(t), end: round3(t + len), source: "estimated" };
    t += len;
    return timing;
  });
}

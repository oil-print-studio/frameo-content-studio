import { existsSync } from "node:fs";
import path from "node:path";
import { FFMPEG, ffmpeg, run } from "./media";

/**
 * 실제 발화 기준 측정.
 *  - 동기화: 완성본 음성에서 말소리가 시작되는 지점(음성 구간 검출)을 찾아 자막 시작과 비교
 *  - 발음 명료도: 측정용 음성 인식(Vosk) 결과와 원문의 글자 오류율(CER)
 * 음성 인식은 선택 도구다(ASR_PYTHON, ASR_VOSK_MODEL). 없으면 동기화만 측정한다.
 */

export interface SpeechSpan {
  start: number;
  end: number;
}

/** 무음이 아닌 구간 = 실제 발화 구간 */
export async function speechSpans(file: string, opts: { noiseDb?: number; minSilence?: number } = {}): Promise<SpeechSpan[]> {
  const noise = opts.noiseDb ?? -40;
  const d = opts.minSilence ?? 0.1;
  const { stderr } = await ffmpeg(["-i", file, "-vn", "-af", `silencedetect=noise=${noise}dB:d=${d}`, "-f", "null", "-"], { allowFail: true });
  const total = Number(/Duration: (\d+):(\d+):([\d.]+)/.exec(stderr)?.slice(1).reduce((acc, v, i) => acc + Number(v) * [3600, 60, 1][i], 0) ?? 0);
  const silences: SpeechSpan[] = [];
  let open: number | undefined;
  for (const line of stderr.split("\n")) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (s) open = Math.max(0, Number(s[1]));
    if (e) {
      silences.push({ start: open ?? 0, end: Number(e[1]) });
      open = undefined;
    }
  }
  if (open !== undefined) silences.push({ start: open, end: total });
  const spans: SpeechSpan[] = [];
  let cursor = 0;
  for (const sil of silences) {
    if (sil.start - cursor > 0.04) spans.push({ start: cursor, end: sil.start });
    cursor = sil.end;
  }
  if (total - cursor > 0.04) spans.push({ start: cursor, end: total });
  return spans;
}

export interface SyncPoint {
  id: string;
  text: string;
  captionStart: number;
  speechOnset?: number;
  errorMs?: number;
}

/** 각 자막 시작에서 가장 가까운 실제 발화 시작(±1.5초 안)을 찾는다 */
export function matchOnsets(points: { id: string; text: string; captionStart: number }[], spans: SpeechSpan[]): SyncPoint[] {
  return points.map((p) => {
    const near = spans.map((s) => s.start).filter((o) => Math.abs(o - p.captionStart) <= 1.5);
    if (!near.length) return { ...p };
    const onset = near.reduce((a, b) => (Math.abs(b - p.captionStart) < Math.abs(a - p.captionStart) ? b : a));
    return { ...p, speechOnset: Math.round(onset * 1000) / 1000, errorMs: Math.round((p.captionStart - onset) * 1000) };
  });
}

export function syncSummary(points: SyncPoint[], thresholdMs = 300) {
  const measured = points.filter((p) => p.errorMs !== undefined);
  const within = measured.filter((p) => Math.abs(p.errorMs!) <= thresholdMs).length;
  const abs = measured.map((p) => Math.abs(p.errorMs!)).sort((a, b) => a - b);
  const pct = (q: number) => (abs.length ? abs[Math.min(abs.length - 1, Math.floor(q * abs.length))] : 0);
  return {
    total: points.length,
    measured: measured.length,
    within,
    rate: points.length ? within / points.length : 0,
    medianMs: pct(0.5),
    p95Ms: pct(0.95),
    maxMs: abs.at(-1) ?? 0,
    pass: points.length > 0 && within / points.length >= 0.9,
  };
}

// ---------- 발음 명료도 ----------

export interface AsrWord {
  w: string;
  start: number;
  end: number;
  conf: number;
}

export function asrAvailable(): boolean {
  return Boolean(process.env.ASR_VOSK_MODEL && existsSync(process.env.ASR_VOSK_MODEL));
}

export async function transcribe(file: string): Promise<AsrWord[] | undefined> {
  if (!asrAvailable()) return undefined;
  const py = process.env.ASR_PYTHON || "python3";
  const script = path.join(process.cwd(), "scripts", "asr_vosk.py");
  const { stdout } = await run(py, [script, file, process.env.ASR_VOSK_MODEL!, FFMPEG]);
  return (JSON.parse(stdout) as { words: AsrWord[] }).words;
}

const DIGIT = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const UNIT = ["", "십", "백", "천"];

/** 정수를 한자어 수사로 읽기(1~9999만 단위까지) — CER 비교용 근사 */
export function sinoNumber(n: number): string {
  if (n === 0) return "영";
  const parts: string[] = [];
  const groups = ["", "만", "억"];
  let g = 0;
  while (n > 0 && g < groups.length) {
    const chunk = n % 10000;
    if (chunk) {
      let s = "";
      [...String(chunk).padStart(4, "0")].forEach((d, i) => {
        const v = Number(d);
        if (!v) return;
        const unit = UNIT[3 - i];
        s += (v === 1 && unit ? "" : DIGIT[v]) + unit;
      });
      parts.unshift(s + groups[g]);
    }
    n = Math.floor(n / 10000);
    g++;
  }
  return parts.join("");
}

/** 비교용 정규화: 숫자는 한자어 수사로, 영문은 제외, 공백·기호 제거 */
export function normalizeForCer(text: string): { norm: string; hasLatin: boolean } {
  const hasLatin = /[A-Za-z]/.test(text);
  const withNums = text.replace(/\d+(?:\.\d+)?/g, (m) => {
    const [i, f] = m.split(".");
    return sinoNumber(Number(i)) + (f ? "점" + [...f].map((d) => DIGIT[Number(d)]).join("") : "");
  });
  const norm = withNums.replace(/[A-Za-z]+/g, "").replace(/[^가-힣]/g, "");
  return { norm, hasLatin };
}

export function cer(ref: string, hyp: string): number {
  const a = [...ref];
  const b = [...hyp];
  if (!a.length) return b.length ? 1 : 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] / a.length;
}

/** 문장 구간 안의 인식 단어를 모아 원문과 비교 */
export function sentenceIntelligibility(sentences: { id: string; text: string; start: number; end: number }[], words: AsrWord[]) {
  return sentences.map((s) => {
    const heard = words.filter((w) => w.start >= s.start - 0.15 && w.start < s.end + 0.1).map((w) => w.w).join(" ");
    const ref = normalizeForCer(s.text);
    const hyp = normalizeForCer(heard).norm;
    return { id: s.id, text: s.text, heard, cer: Math.round(cer(ref.norm, hyp) * 1000) / 1000, hasLatin: ref.hasLatin };
  });
}

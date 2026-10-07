/**
 * 실제 사용 검증 명령: 영상 한 편 동기화·발음 측정, 50문장 측정, Gemini 실제 호출 점검.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { analyzeAll } from "../lib/shorts/analyze";
import { captionChunks } from "../lib/shorts/captions";
import { GEMINI_MODELS, hasGemini, synthesizeSpeech } from "../lib/shorts/gemini";
import { mediaDuration } from "../lib/shorts/media";
import { asrAvailable, matchOnsets, sentenceIntelligibility, speechSpans, syncSummary, transcribe, type SyncPoint } from "../lib/shorts/measure";
import { createProject } from "../lib/shorts/pipeline";
import { generateScript } from "../lib/shorts/planner";
import { dataRoot, loadProject, projectDir, readJson, readLog, resolveInProject, saveProject, writeJson } from "../lib/shorts/store";
import type { CallLogEntry, EditPlan, PlatformId, Sentence, SentenceRole, Timeline } from "../lib/shorts/types";
import { buildVoiceTrack, resolveVoice, voiceLabel } from "../lib/shorts/voice";
import { SYNC_SENTENCES } from "./sync-sentences";

const pct = (r: number) => `${Math.round(r * 100)}%`;

function printSync(label: string, points: SyncPoint[]) {
  const s = syncSummary(points);
  console.log(`${label}: ${s.within}/${s.total} 이 300ms 이내 (${pct(s.rate)}) · 중앙값 ${s.medianMs}ms · 95% ${s.p95Ms}ms · 최대 ${s.maxMs}ms · 측정 못함 ${s.total - s.measured} → ${s.pass ? "통과" : "실패"}`);
  for (const p of points.filter((x) => x.errorMs === undefined || Math.abs(x.errorMs) > 300)) console.log(`    ${p.errorMs === undefined ? "측정 못함(쉼 없음)" : `벗어남 ${p.errorMs}ms`}: ${p.text}`);
  return s;
}

function printIntelligibility(rows: ReturnType<typeof sentenceIntelligibility>) {
  const ko = rows.filter((r) => !r.hasLatin);
  const avg = ko.reduce((a, r) => a + r.cer, 0) / Math.max(1, ko.length);
  console.log(`발음 명료도(측정용 음성 인식, 영문 제외 ${ko.length}문장): 평균 글자 오류율 ${pct(avg)} (낮을수록 또렷함 · 측정 도구 자체의 기준값은 아직 미측정)`);
  for (const r of rows.slice(0, 60)) console.log(`  ${r.hasLatin ? "[영문]" : "      "} CER ${pct(r.cer).padStart(4)} | ${r.text}\n                  들림: ${r.heard || "(인식 안 됨)"}`);
  return avg;
}

/** 저장된 영상 한 편: 실제 발화 시작과 자막 시작 비교 + 발음 명료도 */
export async function measureProject(projectId: string, platform: PlatformId = "common") {
  const dir = projectDir(projectId);
  const versions = (await readdir(path.join(dir, "export")).catch(() => [])).filter((v) => /^v\d+$/.test(v)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const v = versions.at(-1);
  if (!v) throw new Error("저장된 영상이 없습니다. 먼저 export 하세요.");
  const rec = path.join(dir, "export", v, "project");
  const plan = (await readJson<EditPlan>(path.join(rec, "edit_plan.json")))!;
  const timeline = (await readJson<Timeline>(path.join(rec, "timeline.json")))!;
  const pkg = path.join(dir, "export", v, platform);
  const mp4 = (await readdir(pkg)).find((f) => f.endsWith(".mp4"));
  if (!mp4) throw new Error(`${platform} 영상이 없습니다.`);
  const file = path.join(pkg, mp4);
  console.log(`영상: ${file}\n음성: ${voiceLabel(resolveVoice(plan.voice))}`);

  const spans = await speechSpans(file);
  const sentencePts = plan.sentences.map((s) => ({ id: s.id, text: s.text, captionStart: timeline.sentences.find((t) => t.sentenceId === s.id)!.start }));
  const chunkPts = captionChunks(plan, timeline, platform).map((c, i) => ({ id: `${c.sentenceId}#${i}`, text: c.lines.join(" "), captionStart: c.start }));
  const s1 = printSync("문장 시작", matchOnsets(sentencePts, spans));
  const s2 = printSync("자막 화면 시작(문장 안 분할 포함)", matchOnsets(chunkPts, spans));
  let intel;
  const words = await transcribe(file);
  if (words) intel = printIntelligibility(sentenceIntelligibility(plan.sentences.map((s) => ({ id: s.id, text: s.text, ...timeline.sentences.find((t) => t.sentenceId === s.id)! })), words));
  else console.log("발음 명료도: 측정용 음성 인식 미설정(ASR_PYTHON·ASR_VOSK_MODEL) — 건너뜀");
  await writeJson(path.join(pkg, "measure.json"), { file, voice: voiceLabel(resolveVoice(plan.voice)), sentences: s1, chunks: s2, avgCer: intel, measuredAt: new Date().toISOString() });
}

/** 50문장 검증: 실제 사용과 같은 블록 구성(시작 1 · 본문 3 · 마무리 1)으로 10묶음 합성 후 측정 */
export async function syncBench(voiceProvider: "local" | "gemini") {
  if (voiceProvider === "gemini" && !hasGemini()) throw new Error("GEMINI_API_KEY 가 없어 Gemini 음성으로 측정할 수 없습니다.");
  const project = await createProject({ name: "동기화 검증", purpose: "own", facts: [{ id: "f1", text: "측정용", source: "user", approved: true }] }, [], "sync-bench");
  project.settings.voice = voiceProvider === "gemini" ? { provider: "gemini", voice: process.env.GEMINI_TTS_VOICE || "Kore" } : { provider: "local", voice: "ko", rate: 175 };
  await saveProject(project);
  console.log(`프로젝트 ${project.id} · 음성 ${voiceLabel(resolveVoice(project.settings.voice))}`);
  const roles: SentenceRole[] = ["hook", "benefit", "benefit", "benefit", "cta"];
  const allSentence: SyncPoint[] = [];
  const allChunk: SyncPoint[] = [];
  const intelRows: ReturnType<typeof sentenceIntelligibility> = [];
  const started = Date.now();
  for (let g = 0; g < SYNC_SENTENCES.length / 5; g++) {
    const sentences: Sentence[] = SYNC_SENTENCES.slice(g * 5, g * 5 + 5).map((text, i) => ({
      id: `b${g}-${i}`,
      role: roles[i],
      text,
      factIds: [],
      segmentIds: [],
      sceneReason: "",
      priority: 1,
      block: roles[i] === "hook" ? "hook" : roles[i] === "cta" ? "outro" : "body",
    }));
    const plan: EditPlan = {
      kind: "edit_plan",
      planSchema: 1,
      version: g + 1,
      projectId: project.id,
      productId: project.product.id,
      approvedFactIds: [],
      sourceHashes: {},
      generator: { provider: "rules", promptVersion: "bench" },
      sentences,
      hookHistory: [],
      voice: project.settings.voice,
      captionStyle: { scale: 1, color: "#ffffff", highlight: "#ffd84d" },
      design: { id: "basic-v1", brandColor: "#a8845a" },
      output: { targetSeconds: 20, endCardSeconds: 2 },
      createdAt: new Date().toISOString(),
    };
    const track = await buildVoiceTrack(project, plan);
    const audio = resolveInProject(project.id, track.audioRel);
    const spans = await speechSpans(audio);
    // 제작 경로(pipeline)와 같이 실제 말소리 시작 지점을 타임라인에 넣는다
    const timeline: Timeline = { planVersion: plan.version, audioPath: track.audioRel, audioDuration: track.duration, speechEnd: track.duration, totalDuration: track.duration, sentences: track.timings, cuts: [], endCard: { start: track.duration, end: track.duration }, warnings: [], speechOnsets: spans.map((x) => x.start) };
    allSentence.push(...matchOnsets(sentences.map((s) => ({ id: s.id, text: s.text, captionStart: track.timings.find((t) => t.sentenceId === s.id)!.start })), spans));
    allChunk.push(...matchOnsets(captionChunks(plan, timeline, "common").map((c, i) => ({ id: `${c.sentenceId}#${i}`, text: c.lines.join(" "), captionStart: c.start })), spans));
    const words = await transcribe(audio);
    if (words) intelRows.push(...sentenceIntelligibility(sentences.map((s) => ({ id: s.id, text: s.text, ...track.timings.find((t) => t.sentenceId === s.id)! })), words));
    process.stdout.write(`  묶음 ${g + 1}/10 (${(await mediaDuration(audio)).toFixed(1)}초)\n`);
  }
  console.log(`합성·측정 ${((Date.now() - started) / 1000).toFixed(1)}초`);
  const s1 = printSync("문장 시작 50개", allSentence);
  const s2 = printSync("자막 화면 시작", allChunk);
  const worst = [...allSentence].filter((p) => p.errorMs !== undefined).sort((a, b) => Math.abs(b.errorMs!) - Math.abs(a.errorMs!)).slice(0, 5);
  for (const w of worst) console.log(`  오차 ${w.errorMs}ms: ${w.text}`);
  const avgCer = intelRows.length ? printIntelligibility(intelRows) : (console.log("발음 명료도: 측정용 음성 인식 미설정 — 건너뜀"), undefined);
  const calls = await readLog<CallLogEntry>(project.id, "calls");
  const out = { voice: voiceLabel(resolveVoice(project.settings.voice)), sentences: s1, chunks: s2, points: allSentence, intelligibility: intelRows, avgCer, calls: calls.length, measuredAt: new Date().toISOString() };
  await writeJson(path.join(dataRoot(), "reports", `sync-bench-${voiceProvider}.json`), out);
  console.log(`기록: ${path.join(dataRoot(), "reports", `sync-bench-${voiceProvider}.json`)}`);
}

interface CheckRow {
  step: string;
  model: string;
  ok: boolean;
  ms: number;
  detail: string;
}

/** Gemini 실제 호출 점검: 분석·대본·TTS 를 각각 실제로 호출하고 결과를 기록 */
export async function geminiCheck(sourceDir?: string) {
  const rows: CheckRow[] = [];
  const report = { at: new Date().toISOString(), keySet: hasGemini(), models: GEMINI_MODELS, rows };
  const file = path.join(dataRoot(), "reports", "gemini-check.json");
  if (!hasGemini()) {
    for (const [step, model] of [["분석", GEMINI_MODELS.analysis], ["대본", GEMINI_MODELS.plan], ["TTS", GEMINI_MODELS.tts]])
      rows.push({ step, model, ok: false, ms: 0, detail: "호출 안 함: GEMINI_API_KEY 없음" });
    await writeJson(file, report);
    for (const r of rows) console.log(`✗ ${r.step} (${r.model}): ${r.detail}`);
    console.log(`기록: ${file}`);
    return report;
  }
  const dir = sourceDir ?? path.join(dataRoot(), "test-sources");
  const names = (await readdir(dir)).filter((f) => /\.(mp4|mov|webm|jpe?g|png|webp)$/i.test(f)).slice(0, 4);
  const files = await Promise.all(names.map(async (n) => ({ name: n, data: await readFile(path.join(dir, n)), productConfirmed: false })));
  const project = await createProject(
    { name: "Gemini 점검", purpose: "own", facts: [{ id: "f1", text: "사진을 유화 느낌의 캔버스 작품으로 만들어요", source: "user", approved: true }] },
    files,
    "gemini-check",
  );
  project.settings.voice = { provider: "gemini", voice: process.env.GEMINI_TTS_VOICE || "Kore" };
  await saveProject(project);
  const p = await loadProject(project.id);

  let segments: Awaited<ReturnType<typeof analyzeAll>> = [];
  let t = Date.now();
  try {
    segments = await analyzeAll(p);
    const byGemini = segments.filter((s) => s.analyzer === "gemini");
    rows.push({ step: "분석", model: GEMINI_MODELS.analysis, ok: byGemini.length > 0, ms: Date.now() - t, detail: `구간 ${segments.length}개(Gemini ${byGemini.length}) · 예: ${byGemini[0]?.observed.join(", ") || "-"}` });
  } catch (err) {
    rows.push({ step: "분석", model: GEMINI_MODELS.analysis, ok: false, ms: Date.now() - t, detail: (err as Error).message });
  }
  t = Date.now();
  try {
    const r = await generateScript(p, segments);
    rows.push({ step: "대본", model: GEMINI_MODELS.plan, ok: r.generator.provider === "gemini", ms: Date.now() - t, detail: r.notice ?? r.sentences.map((s) => s.text).join(" / ") });
  } catch (err) {
    rows.push({ step: "대본", model: GEMINI_MODELS.plan, ok: false, ms: Date.now() - t, detail: (err as Error).message });
  }
  t = Date.now();
  try {
    const wav = await synthesizeSpeech(p.id, "FRAME O는 사진을 30x40cm 캔버스 작품으로 만들어요.", p.settings.voice.voice);
    const out = resolveInProject(p.id, "gemini-tts-check.wav");
    await (await import("node:fs/promises")).writeFile(out, wav);
    const dur = await mediaDuration(out);
    const words = await transcribe(out);
    rows.push({ step: "TTS", model: GEMINI_MODELS.tts, ok: dur > 0.5, ms: Date.now() - t, detail: `${dur.toFixed(2)}초 음성 · ${out}${words ? ` · 인식: ${words.map((w) => w.w).join(" ")}` : ""}` });
  } catch (err) {
    rows.push({ step: "TTS", model: GEMINI_MODELS.tts, ok: false, ms: Date.now() - t, detail: (err as Error).message });
  }
  const calls = await readLog<CallLogEntry>(p.id, "calls");
  const usage = calls.filter((c) => c.provider === "gemini");
  await writeJson(file, { ...report, calls: usage });
  for (const r of rows) console.log(`${r.ok ? "✓" : "✗"} ${r.step} (${r.model}) ${(r.ms / 1000).toFixed(1)}초: ${r.detail}`);
  console.log(`Gemini 호출 ${usage.length}건 · 입력 토큰 ${usage.reduce((a, c) => a + (c.inputTokens ?? 0), 0)} · 출력 토큰 ${usage.reduce((a, c) => a + (c.outputTokens ?? 0), 0)} (비용은 공급자가 반환하지 않아 기록하지 않음)`);
  console.log(`기록: ${file}`);
  return report;
}

export { asrAvailable };

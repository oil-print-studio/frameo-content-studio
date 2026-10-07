import { ApiError, createPartFromUri, createUserContent, GoogleGenAI, type Part } from "@google/genai";
import { logCall } from "./store";

/**
 * Gemini 연결. 모델 ID는 고정값을 쓰고 '최신' 별칭으로 자동 변경하지 않는다.
 * 기본 ID는 @google/genai 2.27.0 의 모델 목록에서 가져왔다. 실제 호출 검증 전에는 환경변수로 바꿀 수 있다.
 */
export const GEMINI_MODELS = {
  analysis: process.env.GEMINI_ANALYSIS_MODEL || "gemini-3.8-flash",
  plan: process.env.GEMINI_PLAN_MODEL || "gemini-3.8-flash",
  tts: process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts",
};

export function geminiKey(): string | undefined {
  return process.env.GEMINI_API_KEY?.trim() || undefined;
}

export function hasGemini(): boolean {
  return Boolean(geminiKey());
}

let client: GoogleGenAI | undefined;
function getClient(): GoogleGenAI {
  const apiKey = geminiKey();
  if (!apiKey) throw new GeminiError("GEMINI_API_KEY가 설정되지 않았습니다.", "auth");
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export type GeminiErrorKind = "auth" | "quota" | "transient" | "invalid" | "refused";

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly kind: GeminiErrorKind,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

function classify(err: unknown): GeminiError {
  if (err instanceof GeminiError) return err;
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403)
      return new GeminiError("Gemini API 키 또는 권한 오류입니다. 설정에서 키를 확인하세요.", "auth");
    if (err.status === 429) return new GeminiError("Gemini 사용 한도를 넘었습니다. 잠시 후 다시 시도하거나 한도를 확인하세요.", "quota");
    if (err.status === 400 || err.status === 404) return new GeminiError(`Gemini 요청 오류(${err.status}): ${err.message}`, "invalid");
    if (err.status >= 500) return new GeminiError(`Gemini 서버 오류(${err.status})`, "transient");
  }
  return new GeminiError(`Gemini 연결 오류: ${(err as Error)?.message ?? String(err)}`, "transient");
}

/** 일시 오류만 한 번 재시도. 키·권한·한도 오류는 반복하지 않는다. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (first) {
    const e = classify(first);
    if (e.kind !== "transient") throw e;
    await new Promise((r) => setTimeout(r, 1500));
    try {
      return await fn();
    } catch (second) {
      throw classify(second);
    }
  }
}

interface JsonCall {
  projectId: string;
  task: string;
  model: string;
  prompt: string;
  schema: object;
  files?: { path: string; mimeType: string }[];
}

export async function generateJson<T>(call: JsonCall): Promise<T> {
  const ai = getClient();
  const started = Date.now();
  try {
    const parts: (Part | string)[] = [];
    for (const f of call.files ?? []) {
      const uploaded = await withRetry(() => ai.files.upload({ file: f.path, config: { mimeType: f.mimeType } }));
      const ready = await waitActive(ai, uploaded.name!);
      parts.push(createPartFromUri(ready.uri!, ready.mimeType ?? f.mimeType));
    }
    parts.push(call.prompt);
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: call.model,
        contents: [createUserContent(parts)],
        config: { responseMimeType: "application/json", responseJsonSchema: call.schema, temperature: 0.4 },
      }),
    );
    const text = res.text;
    if (!text) throw new GeminiError("Gemini가 빈 응답을 반환했습니다(차단 또는 거절 가능).", "refused");
    await logCall(call.projectId, {
      provider: "gemini",
      model: call.model,
      task: call.task,
      reused: false,
      ok: true,
      durationMs: Date.now() - started,
      inputTokens: res.usageMetadata?.promptTokenCount,
      outputTokens: res.usageMetadata?.candidatesTokenCount,
    });
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GeminiError("Gemini 응답이 JSON 형식이 아닙니다.", "invalid");
    }
  } catch (err) {
    const e = classify(err);
    await logCall(call.projectId, {
      provider: "gemini",
      model: call.model,
      task: call.task,
      reused: false,
      ok: false,
      durationMs: Date.now() - started,
      error: e.message,
    });
    throw e;
  }
}

async function waitActive(ai: GoogleGenAI, name: string) {
  for (let i = 0; i < 60; i++) {
    const f = await ai.files.get({ name });
    if (f.state === "ACTIVE") return f;
    if (f.state === "FAILED") throw new GeminiError("Gemini가 업로드한 소재를 처리하지 못했습니다.", "invalid");
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new GeminiError("Gemini 소재 처리 대기 시간이 초과됐습니다.", "transient");
}

/** Gemini TTS: PCM(L16) 응답을 WAV 로 감싸 돌려준다 */
export async function synthesizeSpeech(projectId: string, text: string, voice: string): Promise<Buffer> {
  const ai = getClient();
  const started = Date.now();
  try {
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: GEMINI_MODELS.tts,
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    );
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new GeminiError("Gemini TTS가 음성을 반환하지 않았습니다.", "refused");
    const mime = part.inlineData.mimeType ?? "audio/L16;rate=24000";
    const pcm = Buffer.from(part.inlineData.data, "base64");
    await logCall(projectId, {
      provider: "gemini",
      model: GEMINI_MODELS.tts,
      task: "tts",
      reused: false,
      ok: true,
      durationMs: Date.now() - started,
      inputTokens: res.usageMetadata?.promptTokenCount,
      outputTokens: res.usageMetadata?.candidatesTokenCount,
    });
    if (mime.includes("wav")) return pcm;
    const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
    return pcmToWav(pcm, rate);
  } catch (err) {
    const e = classify(err);
    await logCall(projectId, {
      provider: "gemini",
      model: GEMINI_MODELS.tts,
      task: "tts",
      reused: false,
      ok: false,
      durationMs: Date.now() - started,
      error: e.message,
    });
    throw e;
  }
}

export function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bits = 16): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bits) / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

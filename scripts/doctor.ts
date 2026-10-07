/**
 * 실행 환경 점검: Node, FFmpeg(필수 필터·인코더), 한글 글꼴, 음성 엔진, Gemini 키·접속.
 *   pnpm shorts doctor
 */
import { existsSync, statfsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODELS, geminiKey } from "../lib/shorts/gemini";
import { FFMPEG, FFPROBE, run } from "../lib/shorts/media";
import { fontDir } from "../lib/shorts/render";
import { dataRoot } from "../lib/shorts/store";
import { espeakPath } from "../lib/shorts/voice";

type Level = "ok" | "warn" | "fail";
interface Check {
  name: string;
  level: Level;
  detail: string;
  fix?: string;
}

const INSTALL: Record<string, { ffmpeg: string; espeak: string }> = {
  win32: {
    ffmpeg: "winget install Gyan.FFmpeg  (설치 후 터미널을 새로 열기)",
    espeak: "https://github.com/espeak-ng/espeak-ng/releases 에서 espeak-ng.msi 설치 (데모 음성용, 선택)",
  },
  darwin: { ffmpeg: "brew install ffmpeg", espeak: "brew install espeak-ng (데모 음성용, 선택)" },
  linux: { ffmpeg: "sudo apt install ffmpeg", espeak: "sudo apt install espeak-ng (데모 음성용, 선택)" },
};

async function tryRun(cmd: string, args: string[]) {
  try {
    return await run(cmd, args, { allowFail: true });
  } catch {
    return undefined;
  }
}

export async function doctor(): Promise<{ checks: Check[]; ok: boolean }> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const how = INSTALL[process.platform] ?? INSTALL.linux;

  const [major, minor] = process.versions.node.split(".").map(Number);
  add({
    name: "Node.js",
    level: major > 20 || (major === 20 && minor >= 9) ? "ok" : "fail",
    detail: `v${process.versions.node} (20.9 이상 필요)`,
    fix: "https://nodejs.org 에서 LTS 설치",
  });

  const ff = await tryRun(FFMPEG, ["-hide_banner", "-version"]);
  if (!ff || ff.code !== 0) {
    add({ name: "FFmpeg", level: "fail", detail: `${FFMPEG} 를 실행할 수 없음`, fix: how.ffmpeg });
  } else {
    add({ name: "FFmpeg", level: "ok", detail: ff.stdout.split("\n")[0] });
    const filters = (await tryRun(FFMPEG, ["-hide_banner", "-filters"]))?.stdout ?? "";
    const encoders = (await tryRun(FFMPEG, ["-hide_banner", "-encoders"]))?.stdout ?? "";
    const need = { "ass(libass, 자막)": / ass /.test(filters), "zoompan(사진 움직임)": /zoompan/.test(filters), "scdet(장면 전환)": /scdet/.test(filters), "loudnorm(음량)": /loudnorm/.test(filters), "libx264": /libx264/.test(encoders), aac: / aac /.test(encoders) };
    const missing = Object.entries(need).filter(([, v]) => !v).map(([k]) => k);
    add({ name: "FFmpeg 필수 기능", level: missing.length ? "fail" : "ok", detail: missing.length ? `없음: ${missing.join(", ")}` : "ass·zoompan·scdet·loudnorm·libx264·aac 모두 있음", fix: "libass·libx264 가 포함된 전체(full) 빌드로 설치" });
  }
  const fp = await tryRun(FFPROBE, ["-version"]);
  add({ name: "ffprobe", level: fp?.code === 0 ? "ok" : "fail", detail: fp?.code === 0 ? fp.stdout.split("\n")[0] : "실행할 수 없음", fix: how.ffmpeg });

  const fonts = ["Pretendard-ExtraBold.otf", "Pretendard-Bold.otf", "Pretendard-SemiBold.otf"].map((f) => path.join(fontDir(), f));
  const missingFonts = fonts.filter((f) => !existsSync(f));
  add({ name: "한글 글꼴(Pretendard)", level: missingFonts.length ? "fail" : "ok", detail: missingFonts.length ? `없음: ${missingFonts.map((f) => path.basename(f)).join(", ")}` : fontDir(), fix: "pnpm install (pretendard 패키지) 또는 SHORTS_FONT_DIR 지정" });

  const es = espeakPath();
  const ev = await tryRun(es, ["--voices=ko"]);
  add({
    name: "로컬 데모 음성(espeak-ng)",
    level: ev?.code === 0 && /\bko\b/.test(ev.stdout) ? "ok" : "warn",
    detail: ev?.code === 0 ? `${es} · 한국어 음성 ${/\bko\b/.test(ev.stdout) ? "있음" : "없음"} (게시용 아님)` : "없음 — Gemini 키가 있으면 필요 없음",
    fix: how.espeak,
  });

  const key = geminiKey();
  if (!key) {
    add({ name: "Gemini API 키", level: "warn", detail: "GEMINI_API_KEY 없음 → 로컬 모드(분석 제한·규칙 대본·데모 음성, 게시 불가)", fix: ".env.local 에 GEMINI_API_KEY=... 추가 (https://aistudio.google.com/apikey)" });
  } else {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      const names: string[] = [];
      const pager = await ai.models.list({ config: { pageSize: 200 } });
      for await (const m of pager) if (m.name) names.push(m.name.replace(/^models\//, ""));
      const want = Object.entries(GEMINI_MODELS).map(([k, id]) => `${k}=${id} ${names.includes(id) ? "✓" : "✗(목록에 없음)"}`);
      const allFound = Object.values(GEMINI_MODELS).every((id) => names.includes(id));
      add({ name: "Gemini 접속·모델", level: allFound ? "ok" : "fail", detail: `키 인증 성공 · 사용 가능 모델 ${names.length}개 · ${want.join(" · ")}`, fix: allFound ? undefined : `사용 가능한 TTS·flash 모델: ${names.filter((n) => /flash|tts/.test(n)).slice(0, 12).join(", ")} → .env.local 의 GEMINI_*_MODEL 로 지정` });
    } catch (err) {
      add({ name: "Gemini 접속·모델", level: "fail", detail: (err as Error).message.slice(0, 200), fix: "키가 맞는지, 네트워크가 generativelanguage.googleapis.com 에 접속되는지 확인" });
    }
  }

  try {
    const st = statfsSync(existsSync(dataRoot()) ? dataRoot() : process.cwd());
    const freeGb = (st.bavail * st.bsize) / 1024 ** 3;
    add({ name: "저장 공간", level: freeGb > 2 ? "ok" : "warn", detail: `${dataRoot()} · 여유 ${freeGb.toFixed(1)}GB (영상 1편 작업에 약 0.2~1GB)` });
  } catch {
    /* 일부 환경은 statfs 미지원 */
  }

  add({ name: "운영체제", level: "ok", detail: `${os.type()} ${os.release()} ${os.arch()} · CPU ${os.cpus().length}코어 · 메모리 ${Math.round(os.totalmem() / 1024 ** 3)}GB` });
  return { checks, ok: checks.every((c) => c.level !== "fail") };
}

export function printDoctor(r: { checks: Check[]; ok: boolean }) {
  const mark = { ok: "✓", warn: "!", fail: "✗" };
  for (const c of r.checks) {
    console.log(`${mark[c.level]} ${c.name}: ${c.detail}`);
    if (c.level !== "ok" && c.fix) console.log(`    → ${c.fix}`);
  }
  console.log(r.ok ? "\n실행 준비 완료" : "\n✗ 항목을 해결해야 실행할 수 있어요");
}

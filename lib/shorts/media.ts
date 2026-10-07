import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import path from "node:path";

export const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
export const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class MediaToolError extends Error {
  constructor(
    message: string,
    readonly stderrTail: string,
  ) {
    super(message);
    this.name = "MediaToolError";
  }
}

export function run(cmd: string, args: string[], options: { allowFail?: boolean; input?: string } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => {
      stderr += d;
      // 긴 렌더에서 메모리를 아끼기 위해 끝부분만 유지
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on("error", (err) =>
      reject(new MediaToolError(`${cmd} 실행 실패: ${err.message}. FFmpeg 설치 또는 FFMPEG_PATH 설정을 확인하세요.`, "")),
    );
    child.on("close", (code) => {
      const result = { code: code ?? -1, stdout, stderr };
      if (code !== 0 && !options.allowFail) {
        const tail = stderr.split("\n").slice(-15).join("\n");
        reject(new MediaToolError(`${cmd} 종료 코드 ${code}`, tail));
      } else resolve(result);
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

export function ffmpeg(args: string[], options?: { allowFail?: boolean }) {
  return run(FFMPEG, ["-hide_banner", "-nostdin", "-y", ...args], options);
}

export interface ProbeStream {
  codec_type: "video" | "audio" | string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
  pix_fmt?: string;
  side_data_list?: { rotation?: number }[];
  tags?: { rotate?: string };
}

export interface ProbeResult {
  streams: ProbeStream[];
  format: { duration?: string; format_name?: string; bit_rate?: string };
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]);
  return JSON.parse(stdout) as ProbeResult;
}

export function parseRate(rate?: string): number {
  if (!rate) return 0;
  const [n, d] = rate.split("/").map(Number);
  if (!d) return n || 0;
  return n / d;
}

export function streamRotation(s: ProbeStream): number {
  const fromSide = s.side_data_list?.find((x) => typeof x.rotation === "number")?.rotation;
  const r = fromSide ?? (s.tags?.rotate ? Number(s.tags.rotate) : 0);
  return ((Math.round(r) % 360) + 360) % 360;
}

export async function mediaDuration(file: string): Promise<number> {
  const p = await probe(file);
  return Number(p.format.duration ?? 0);
}

export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });
}

export function hashOf(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 16);
}

/** FFmpeg filter 인자 안에서 경로를 안전하게 쓰기 위한 이스케이프 */
export function filterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * 결과 파일을 임시 이름으로 만든 뒤 완료되면 교체한다.
 * 렌더·합성 도중 앱이 종료돼도 잘린 파일이 '완료된 캐시'로 재사용되지 않는다.
 */
export async function writeAtomically(out: string, make: (tmp: string) => Promise<unknown>): Promise<void> {
  const ext = path.extname(out);
  const tmp = `${out.slice(0, out.length - ext.length)}.part-${process.pid}${ext}`;
  try {
    await make(tmp);
    await rename(tmp, out);
  } finally {
    await rm(tmp, { force: true });
  }
}

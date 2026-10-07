import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { resolveInProject } from "@/lib/shorts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".srt": "application/x-subrip; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/** 프로젝트 폴더 안의 파일만 제공(영상은 구간 요청 지원) */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const rel = url.searchParams.get("path") ?? "";
  let abs: string;
  try {
    abs = resolveInProject(id, rel);
  } catch {
    return new Response("잘못된 경로", { status: 400 });
  }
  const ext = path.extname(abs).toLowerCase();
  const type = TYPES[ext];
  if (!type) return new Response("지원하지 않는 파일", { status: 400 });
  let size: number;
  try {
    size = (await stat(abs)).size;
  } catch {
    return new Response("파일 없음", { status: 404 });
  }
  const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
  if (url.searchParams.get("download")) headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`;

  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(size) } });
}

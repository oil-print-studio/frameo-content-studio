import type { ExportResult } from "@/lib/shorts/pipeline";
import type { RenderOutput } from "@/lib/shorts/render";
import type { ChannelSettings, EditPlan, Project, ProjectState, ReviewItem, Segment, Timeline } from "@/lib/shorts/types";

export interface Capabilities {
  gemini: boolean;
  analysis: string;
  script: string;
  voice: string;
}

export interface ProjectViewData {
  project: Project;
  state: ProjectState;
  plan?: EditPlan;
  timeline?: Timeline;
  job?: { name: string; status: "running" | "done" | "failed"; error?: string; result?: unknown };
  segments: Segment[];
  review: ReviewItem[];
  preview?: RenderOutput & { planVersion: number; notices: string[] };
  usage: { fresh: number; reused: number; ai: number };
  voiceLabel?: string;
  running: boolean;
}

export type ExportJobResult = ExportResult;
export type { ChannelSettings };

export function fileUrl(projectId: string, rel: string, opts: { download?: boolean; v?: string | number } = {}) {
  const q = new URLSearchParams({ path: rel });
  if (opts.download) q.set("download", "1");
  if (opts.v !== undefined) q.set("v", String(opts.v));
  return `/api/shorts/projects/${projectId}/file?${q}`;
}

export async function postJson(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true } : { ok: false, error: data.error ?? "요청에 실패했어요." };
  } catch {
    return { ok: false, error: "서버에 연결하지 못했어요." };
  }
}

import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CallLogEntry, ChannelSettings, Project, ProjectState, StepName, StepState } from "./types";

/** 로컬 프로젝트 저장 위치. 기본은 저장소의 data/shorts (git 제외) */
export function dataRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.SHORTS_DATA_DIR || path.join(process.cwd(), "data", "shorts"));
}

export function projectDir(projectId: string): string {
  if (!/^[a-z0-9-]{6,64}$/.test(projectId)) throw new Error("잘못된 프로젝트 id");
  return path.join(dataRoot(), "projects", projectId);
}

/** 프로젝트 폴더 밖을 가리키는 경로를 막는다 */
export function resolveInProject(projectId: string, rel: string): string {
  const base = projectDir(projectId);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error("프로젝트 밖의 경로입니다.");
  return abs;
}

export function newId(prefix = ""): string {
  const stamp = Date.now().toString(36);
  return `${prefix}${stamp}-${randomBytes(3).toString("hex")}`;
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** 쓰는 도중 앱이 종료돼도 기존 파일이 깨지지 않도록 임시 파일 후 교체 */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file);
}

export const projectFile = (id: string) => path.join(projectDir(id), "project.json");
export const stateFile = (id: string) => path.join(projectDir(id), "state.json");
export const planFile = (id: string) => path.join(projectDir(id), "edit_plan.json");
export const timelineFile = (id: string) => path.join(projectDir(id), "timeline.json");

export async function loadProject(id: string): Promise<Project> {
  const p = await readJson<Project>(projectFile(id));
  if (!p) throw new Error(`프로젝트를 찾을 수 없습니다: ${id}`);
  return p;
}

export async function saveProject(p: Project): Promise<void> {
  await writeJson(projectFile(p.id), p);
}

export async function loadState(id: string): Promise<ProjectState> {
  return (await readJson<ProjectState>(stateFile(id))) ?? { steps: {}, updatedAt: new Date().toISOString() };
}

export async function updateStep(id: string, step: StepName | `final:${string}` | `preview:${string}`, patch: Partial<StepState>, activity?: string) {
  const state = await loadState(id);
  state.steps[step] = { ...(state.steps[step] ?? { status: "pending" }), ...patch };
  if (activity !== undefined) state.activity = activity || undefined;
  state.updatedAt = new Date().toISOString();
  await writeJson(stateFile(id), state);
  return state;
}

export async function setActivity(id: string, activity: string | undefined) {
  const state = await loadState(id);
  state.activity = activity;
  state.updatedAt = new Date().toISOString();
  await writeJson(stateFile(id), state);
}

export async function logCall(projectId: string, entry: Omit<CallLogEntry, "ts">): Promise<void> {
  const file = path.join(projectDir(projectId), "logs", "calls.jsonl");
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

export async function logStep(projectId: string, entry: Record<string, unknown>): Promise<void> {
  const file = path.join(projectDir(projectId), "logs", "steps.jsonl");
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

export async function readLog<T>(projectId: string, name: "calls" | "steps"): Promise<T[]> {
  try {
    const raw = await readFile(path.join(projectDir(projectId), "logs", `${name}.jsonl`), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}

export const DEFAULT_SETTINGS: ChannelSettings = {
  voice: { provider: "local", voice: "ko", rate: 175 },
  brandColor: "#a8845a",
  targetSeconds: 20,
  defaultPlatforms: ["common"],
  captionScale: 1,
};

/** 채널 기본값: 처음 한 번 저장하면 다음 영상부터 다시 고르지 않는다 */
export async function loadChannelSettings(): Promise<ChannelSettings> {
  const saved = await readJson<Partial<ChannelSettings>>(path.join(dataRoot(), "channel.json"));
  const merged = { ...DEFAULT_SETTINGS, ...saved, voice: { ...DEFAULT_SETTINGS.voice, ...saved?.voice } };
  return merged;
}

export async function saveChannelSettings(s: ChannelSettings): Promise<void> {
  await writeJson(path.join(dataRoot(), "channel.json"), s);
}

import path from "node:path";
import { projectDir, readJson, writeJson } from "./store";

/** 프로젝트별 백그라운드 작업. 진행 상태는 파일에 남겨 앱을 다시 켜도 확인·재개할 수 있다 */
export interface JobRecord {
  name: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  error?: string;
  result?: unknown;
}

const g = globalThis as unknown as { __shortsJobs?: Map<string, Promise<unknown>> };
const running = (g.__shortsJobs ??= new Map());

const jobFile = (id: string) => path.join(projectDir(id), "job.json");

export function isRunning(projectId: string): boolean {
  return running.has(projectId);
}

export async function readJob(projectId: string): Promise<JobRecord | undefined> {
  const rec = await readJson<JobRecord>(jobFile(projectId));
  // 앱이 작업 도중 종료됐으면 '중단됨'으로 보고 다시 실행할 수 있게 한다
  if (rec?.status === "running" && !running.has(projectId)) return { ...rec, status: "failed", error: "작업 도중 앱이 종료됐습니다. 다시 실행하면 완료된 단계부터 이어갑니다." };
  return rec;
}

export function startJob(projectId: string, name: string, fn: () => Promise<unknown>): boolean {
  if (running.has(projectId)) return false;
  const startedAt = new Date().toISOString();
  const p = (async () => {
    await writeJson(jobFile(projectId), { name, status: "running", startedAt } satisfies JobRecord);
    try {
      const result = await fn();
      await writeJson(jobFile(projectId), { name, status: "done", startedAt, finishedAt: new Date().toISOString(), result } satisfies JobRecord);
    } catch (err) {
      const e = err as Error & { stderrTail?: string };
      await writeJson(jobFile(projectId), {
        name,
        status: "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        error: e.message + (e.stderrTail ? `\n${e.stderrTail}` : ""),
      } satisfies JobRecord);
    } finally {
      running.delete(projectId);
    }
  })();
  running.set(projectId, p);
  return true;
}

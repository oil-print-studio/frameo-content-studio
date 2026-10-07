/**
 * 쇼츠 제작기 명령줄 도구 (화면 없이 같은 파이프라인 실행·검증용)
 *
 *   pnpm shorts demo                 합성 시험 소재로 입력 → 초안 → 저장 전체 실행
 *   pnpm shorts draft <projectId>    초안 생성(완료된 단계는 건너뜀)
 *   pnpm shorts export <projectId> [common,youtube_shorts,instagram_reels]
 *   pnpm shorts edit <projectId> '<json>'   예: '{"op":"captionScale","scale":1.2}'
 *   pnpm shorts confirm <projectId>  모든 소재를 '판매 상품 촬영본'으로 확인
 *   pnpm shorts doctor               실행 환경 점검(FFmpeg·글꼴·음성 엔진·Gemini)
 *   pnpm shorts gemini-check [소재폴더]  Gemini 분석·대본·TTS 실제 호출 점검
 *   pnpm shorts measure <projectId> [플랫폼]  저장된 영상의 실제 발화 기준 동기화·발음 측정
 *   pnpm shorts sync-bench [local|gemini]  숫자·영문 포함 50문장 동기화·발음 측정
 *   pnpm shorts calibrate            인스타·유튜브 앱 확인용 눈금 영상·표지 생성
 *   pnpm shorts make <product.json>  실제 소재로 입력 → 초안 → 저장 → 검사 한 번에
 */
import "./env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { hasGemini } from "../lib/shorts/gemini";
import { applyEdit, createProject, exportPackage, runDraft, type EditOp } from "../lib/shorts/pipeline";
import { isPlatformId, PLATFORM_IDS } from "../lib/shorts/platforms";
import { dataRoot, loadProject, readLog, resolveInProject } from "../lib/shorts/store";
import type { CallLogEntry, PlatformId } from "../lib/shorts/types";
import { makeTestSources } from "./make-test-sources";
import { doctor, printDoctor } from "./doctor";
import { geminiCheck, measureProject, syncBench } from "./verify-tools";
import { makeCalibrationKit } from "./calibrate";
import { makeVideo } from "./make-video";

function sec(ms: number) {
  return `${(ms / 1000).toFixed(1)}초`;
}

async function printCalls(projectId: string, sinceIndex = 0) {
  const calls = (await readLog<CallLogEntry>(projectId, "calls")).slice(sinceIndex);
  const fresh = calls.filter((c) => !c.reused);
  const reused = calls.filter((c) => c.reused);
  console.log(`  호출 기록: 새 작업 ${fresh.length}건, 재사용 ${reused.length}건`);
  const byTask = new Map<string, number>();
  for (const c of fresh) byTask.set(`${c.provider}:${c.task.split(":")[0]}`, (byTask.get(`${c.provider}:${c.task.split(":")[0]}`) ?? 0) + 1);
  for (const [k, n] of byTask) console.log(`    - ${k} × ${n}`);
  return calls.length + sinceIndex;
}

async function draft(id: string) {
  const t = Date.now();
  const r = await runDraft(id);
  console.log(`\n[초안] 편집 계획 v${r.plan.version} · ${r.plan.generator.provider === "gemini" ? `Gemini(${r.plan.generator.model})` : "규칙 기반 대본(AI 미사용)"} · ${sec(Date.now() - t)}`);
  for (const n of r.notices) console.log(`  알림: ${n}`);
  for (const s of r.plan.sentences) {
    const tm = r.timeline.sentences.find((x) => x.sentenceId === s.id);
    console.log(`  ${tm?.start.toFixed(2).padStart(6)}~${tm?.end.toFixed(2).padStart(6)}s [${s.role}] ${s.text}  ← 사실 ${s.factIds.join(",") || "-"} / 장면 ${s.segmentIds.join(",") || "-"}`);
  }
  console.log(`  길이: 음성 ${r.timeline.speechEnd.toFixed(2)}초 + 마지막 안내 ${(r.timeline.totalDuration - r.timeline.speechEnd).toFixed(1)}초 = ${r.timeline.totalDuration.toFixed(2)}초`);
  console.log(`  컷 ${r.timeline.cuts.length}개 (${r.timeline.cuts.map((c) => `${(c.outEnd - c.outStart).toFixed(1)}s${c.fill !== "none" ? `/${c.fill}` : ""}`).join(" ")})`);
  for (const w of r.timeline.warnings) console.log(`  주의: ${w}`);
  console.log(`  미리보기: ${resolveInProject(id, r.preview.videoRel)} (${sec(r.preview.renderMs)}, 컷 새로 ${r.preview.renderedCuts}/재사용 ${r.preview.reusedCuts})`);
  console.log(`  확인 항목 ${r.review.length}개${r.review.length ? ":" : ""}`);
  for (const i of r.review) console.log(`    ${i.blocking ? "■ 필수" : "□ 권장"} ${i.message}`);
  return r;
}

async function doExport(id: string, platforms: PlatformId[]) {
  const t = Date.now();
  const r = await exportPackage(id, platforms);
  if (r.blocked) {
    console.log("\n[저장 중단] 해결되지 않은 필수 확인 항목:");
    for (const b of r.blocked) console.log(`  - ${b.message}`);
    return r;
  }
  console.log(`\n[저장] ${resolveInProject(id, r.folder)} · ${sec(Date.now() - t)}`);
  for (const o of r.outputs) {
    console.log(`  ${o.platform}: ${o.verify.ok ? "검사 통과" : "검사 실패"} · ${o.verify.publishable ? "게시 가능" : "게시 불가"} · 음성 ${o.voice} · 렌더 ${sec(o.renderMs)} (컷 새로 ${o.renderedCuts}/재사용 ${o.reusedCuts})`);
    for (const b of o.verify.blockers) console.log(`    ! ${b}`);
    for (const c of o.verify.checks) console.log(`    ${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  }
  return r;
}

async function demo() {
  console.log(`데이터 폴더: ${dataRoot()}`);
  console.log(`AI: ${hasGemini() ? "Gemini 키 있음" : "Gemini 키 없음 → 로컬 분석·규칙 기반 대본·로컬 테스트 음성(espeak-ng)"}`);
  const srcDir = path.join(dataRoot(), "test-sources");
  const t0 = Date.now();
  const sources = await makeTestSources(srcDir);
  console.log(`\n[시험 소재] 합성 소재 ${sources.length}개 생성 (${sec(Date.now() - t0)})`);
  for (const s of sources) console.log(`  - ${path.basename(s.file)}: ${s.note}`);

  const files = await Promise.all(sources.map(async (s) => ({ name: path.basename(s.file), data: await readFile(s.file) })));
  const project = await createProject(
    {
      name: "휴대용 접이식 텀블러",
      purpose: "affiliate",
      url: "https://example.com/p/tumbler",
      facts: [
        { id: "f1", text: "접으면 높이가 4cm로 줄어 가방에 쏙 들어가요", source: "description", sourceNote: "상품 상세 설명", approved: true },
        { id: "f2", text: "뚜껑을 돌려 잠그는 방식이에요", source: "user", approved: true },
        { id: "f3", text: "식기세척기에 넣어 세척할 수 있어요", source: "description", sourceNote: "상품 상세 설명", approved: true },
      ],
    },
    files,
  );
  console.log(`\n[입력] 프로젝트 ${project.id} · 소재 ${project.assets.length}개`);
  for (const a of project.assets) console.log(`  - ${a.fileName}: ${a.kind} ${a.width}×${a.height} ${a.kind === "video" ? `${a.duration.toFixed(2)}초 ${a.fps.toFixed(0)}fps` : ""}`);

  await draft(project.id);
  const logIndex = await printCalls(project.id);

  console.log("\n[저장 시도 1] 소재 확인 전");
  await doExport(project.id, PLATFORM_IDS);

  console.log("\n[사용자 확인 대행] 소재 4개를 '판매 상품 촬영본'으로 확인 (CLI 가 화면 조작을 대신함)");
  const p = await loadProject(project.id);
  for (const a of p.assets) await applyEdit(project.id, { op: "confirmAsset", assetId: a.id, confirmed: true });

  console.log("\n[저장 시도 2] 공용·유튜브 쇼츠·인스타 릴스");
  await doExport(project.id, PLATFORM_IDS);
  let idx = await printCalls(project.id, logIndex);

  // 수정 비용: 자막 크기 변경은 새 분석·음성 0건, 시작 문구 변경은 시작 음성·시작 컷만
  for (const edit of [{ op: "captionScale", scale: 1.2 }, { op: "newHook" }] as EditOp[]) {
    const t = Date.now();
    const r = await applyEdit(project.id, edit);
    console.log(`\n[수정: ${edit.op}] 계획 v${r.plan.version} · 다시 한 작업: ${r.redo.join(", ")} · ${sec(Date.now() - t)}`);
    console.log(`  미리보기 렌더: 컷 새로 ${r.preview.renderedCuts}/재사용 ${r.preview.reusedCuts}`);
    idx = await printCalls(project.id, idx);
  }
  return project.id;
}

async function main() {
  const [cmd, id, arg] = process.argv.slice(2);
  switch (cmd) {
    case "demo":
      await demo();
      break;
    case "draft":
      await draft(id);
      break;
    case "export": {
      const list = (arg ?? PLATFORM_IDS.join(",")).split(",").filter(isPlatformId);
      await doExport(id, list);
      break;
    }
    case "edit": {
      const t = Date.now();
      const before = (await readLog<CallLogEntry>(id, "calls")).length;
      const r = await applyEdit(id, JSON.parse(arg) as EditOp);
      console.log(`[수정] 계획 v${r.plan.version} · 다시 한 작업: ${r.redo.join(", ")} · ${sec(Date.now() - t)}`);
      console.log(`  미리보기 렌더: 컷 새로 ${r.preview.renderedCuts}/재사용 ${r.preview.reusedCuts}`);
      await printCalls(id, before);
      break;
    }
    case "confirm": {
      const p = await loadProject(id);
      for (const a of p.assets) await applyEdit(id, { op: "confirmAsset", assetId: a.id, confirmed: true });
      console.log("모든 소재를 확인했습니다.");
      break;
    }
    case "doctor": {
      const r = await doctor();
      printDoctor(r);
      if (!r.ok) process.exitCode = 1;
      break;
    }
    case "gemini-check":
      await geminiCheck(id);
      break;
    case "measure":
      await measureProject(id, isPlatformId(arg) ? arg : "common");
      break;
    case "sync-bench":
      await syncBench(id === "gemini" ? "gemini" : "local");
      break;
    case "calibrate":
      await makeCalibrationKit();
      break;
    case "make":
      await makeVideo(id);
      break;
    default:
      console.log("사용법: pnpm shorts demo | draft <id> | export <id> [플랫폼,...] | edit <id> '<json>' | confirm <id> | doctor | gemini-check | measure <id> | sync-bench [local|gemini] | calibrate");
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\n오류: ${err.message}`);
  if (err.stderrTail) console.error(err.stderrTail);
  process.exitCode = 1;
});

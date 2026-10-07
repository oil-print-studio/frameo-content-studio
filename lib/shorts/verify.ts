import { BASE_FONT_SIZE, captionChunks, END_LINE_SIZE, textWidth, wrapLines } from "./captions";
import { ffmpeg, probe } from "./media";
import { endCardLine, FRAME, PLATFORMS } from "./platforms";
import type { EditPlan, PlatformId, ProductCard, ReviewItem, Timeline, VerifyReport } from "./types";

/**
 * 완성본 검사. 파일 존재만으로 완료 판정하지 않는다.
 * 코덱·해상도·재생 시간·오디오 길이, 실제 디코딩, 검은 구간, 음성 잘림, 자막 넘침, 미해결 확인 항목.
 */
export async function verifyOutput(
  file: string,
  expected: { width: number; height: number; timeline: Timeline; plan: EditPlan; platform: PlatformId; review: ReviewItem[]; product: ProductCard; demoVoice: boolean; voice: string },
): Promise<VerifyReport> {
  const checks: VerifyReport["checks"] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const { timeline } = expected;

  let info;
  try {
    info = await probe(file);
  } catch (err) {
    add("파일 읽기", false, (err as Error).message);
    return { ok: false, publishable: false, blockers: ["파일을 읽지 못함"], file, checks };
  }
  const v = info.streams.find((s) => s.codec_type === "video");
  const a = info.streams.find((s) => s.codec_type === "audio");
  const duration = Number(info.format.duration ?? 0);
  add("영상 코덱 H.264", v?.codec_name === "h264", v?.codec_name ?? "영상 없음");
  add("오디오 코덱 AAC", a?.codec_name === "aac", a?.codec_name ?? "오디오 없음");
  add("해상도", v?.width === expected.width && v?.height === expected.height, `${v?.width}×${v?.height}`);
  add("픽셀 형식(yuv420p)", v?.pix_fmt === "yuv420p", v?.pix_fmt ?? "-");
  add("재생 시간", Math.abs(duration - timeline.totalDuration) <= 0.2, `${duration.toFixed(2)}초 (계획 ${timeline.totalDuration.toFixed(2)}초)`);
  const aDur = Number(a?.duration ?? 0);
  add("음성 잘림 없음", aDur + 0.05 >= timeline.speechEnd, `오디오 ${aDur.toFixed(2)}초 ≥ 음성 끝 ${timeline.speechEnd.toFixed(2)}초`);

  // 전체 디코딩 + 검은 구간 + 음량
  const { stderr } = await ffmpeg(["-v", "info", "-i", file, "-vf", "blackdetect=d=0.4:pix_th=0.08", "-af", "volumedetect", "-f", "null", "-"], { allowFail: true });
  const decodeErrors = stderr.split("\n").filter((l) => /error|corrupt|invalid/i.test(l) && !/blackdetect|volumedetect/.test(l));
  add("전체 디코딩", decodeErrors.length === 0, decodeErrors.length ? decodeErrors.slice(0, 3).join(" / ") : "오류 없음");
  const blacks = [...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => `${Number(m[1]).toFixed(1)}~${Number(m[2]).toFixed(1)}초`);
  add("의도하지 않은 검은 구간 없음", blacks.length === 0, blacks.length ? blacks.join(", ") : "없음");
  const meanVol = Number(/mean_volume: (-?[\d.]+) dB/.exec(stderr)?.[1] ?? -99);
  add("음성 신호 있음", meanVol > -40, `평균 ${meanVol} dB`);

  // 자막 동기화: 완성본 음성의 무음 경계(말 시작)와 문장 자막 시작을 비교 (음성 인식이 아닌 무음 검출 기반)
  const sync = await measureSync(file, timeline);
  add(
    "자막 시작 동기화(300ms 이내 90% 이상)",
    sync.within / Math.max(1, sync.total) >= 0.9,
    `${sync.within}/${sync.total}개 문장 300ms 이내 · 최대 오차 ${Math.round(sync.maxErr * 1000)}ms (무음 경계 기준)`,
  );

  // 자막·마지막 안내가 안전 영역 안에 들어가는지(글자 폭 추정 기반)
  const p = PLATFORMS[expected.platform];
  const maxW = FRAME.width - p.marginLeft - p.marginRight;
  const size = BASE_FONT_SIZE * expected.plan.captionStyle.scale;
  const chunks = captionChunks(expected.plan, timeline, expected.platform);
  const overflow = chunks.filter((c) => c.lines.length > 2 || c.lines.some((l) => textWidth(l, size) > maxW + 1));
  const tooTall = chunks.some((c) => p.captionBottomY - c.lines.length * size * 1.25 < p.topSafeY);
  add("자막 두 줄·안전 영역 이내", overflow.length === 0 && !tooTall, overflow.length ? `${overflow.length}개 자막이 넘침` : `${chunks.length}개 자막 확인`);
  const endText = endCardLine(p, expected.product);
  const endLines = wrapLines(endText, maxW, END_LINE_SIZE);
  add("마지막 안내 글자 잘림 없음", endLines.length <= 2 && endLines.every((l) => textWidth(l, END_LINE_SIZE) <= maxW), `${endText} (${endLines.length}줄)`);

  const blocking = expected.review.filter((r) => r.blocking);
  add("미해결 상품·주장 확인 항목 없음", blocking.length === 0, blocking.length ? blocking.map((b) => b.message).join(" / ") : "없음");

  const ok = checks.every((c) => c.ok);
  const blockers = [
    ...(ok ? [] : ["출력 검사 실패"]),
    ...(expected.demoVoice ? [`로컬 데모 음성(${expected.voice}) — 게시용 음성(Gemini TTS 등)으로 다시 만들어야 함`] : []),
  ];
  return { ok, publishable: blockers.length === 0, blockers, file, checks };
}

export async function measureSync(file: string, timeline: Timeline) {
  const { stderr } = await ffmpeg(["-i", file, "-vn", "-af", "silencedetect=noise=-38dB:d=0.12", "-f", "null", "-"], { allowFail: true });
  const onsets = [0, ...[...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))];
  let within = 0;
  let maxErr = 0;
  for (const s of timeline.sentences) {
    const err = Math.min(...onsets.map((o) => Math.abs(o - s.start)));
    maxErr = Math.max(maxErr, err);
    if (err <= 0.3) within++;
  }
  return { within, total: timeline.sentences.length, maxErr };
}

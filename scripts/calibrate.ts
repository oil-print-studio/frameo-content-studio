/**
 * 실제 앱(인스타 릴스·유튜브 쇼츠)에서 자막 안전 영역과 표지 잘림을 확인하는 눈금 키트.
 *   pnpm shorts calibrate → data/shorts/calibration/
 *
 * 영상·표지에 y 좌표 눈금(60px 간격), 현재 자막 하단 위치, 프로필 격자 잘림선(4:5·3:4·1:1)을 그린다.
 * 테스트 계정에 올려 화면을 캡처하면, 가려지는 눈금 값을 platforms.json 에 그대로 옮겨 적을 수 있다.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ffmpeg, filterPath } from "../lib/shorts/media";
import { FRAME, PLATFORMS } from "../lib/shorts/platforms";
import { fontDir } from "../lib/shorts/render";
import { dataRoot, loadPlatformOverrides, platformOverridesFile } from "../lib/shorts/store";

const W = FRAME.width;
const H = FRAME.height;

/** 프로필 격자 비율별 표시 영역(가운데 기준) */
const GRIDS = [
  { name: "4:5", h: Math.round(W * 1.25), color: "0x00c8ff" },
  { name: "3:4", h: Math.round(W * (4 / 3)), color: "0xffb000" },
  { name: "1:1", h: W, color: "0xff4fa3" },
];

function drawGraph(font: string, opts: { showCaptionLines: boolean }) {
  const f = filterPath(font);
  const parts: string[] = [];
  // 60px 눈금, 120px 마다 숫자
  for (let y = 0; y <= H; y += 60) {
    const major = y % 120 === 0;
    parts.push(`drawbox=x=0:y=${Math.min(y, H - 2)}:w=${major ? 140 : 70}:h=2:color=white@0.9:t=fill`);
    parts.push(`drawbox=x=${W - (major ? 140 : 70)}:y=${Math.min(y, H - 2)}:w=${major ? 140 : 70}:h=2:color=white@0.9:t=fill`);
    if (major) {
      parts.push(`drawtext=fontfile='${f}':text='${y}':x=150:y=${Math.max(0, y - 16)}:fontsize=30:fontcolor=white:box=1:boxcolor=black@0.6`);
      parts.push(`drawtext=fontfile='${f}':text='${y}':x=${W - 230}:y=${Math.max(0, y - 16)}:fontsize=30:fontcolor=white:box=1:boxcolor=black@0.6`);
    }
  }
  // 세로 눈금(오른쪽 버튼 영역 확인용)
  for (let x = 60; x < W; x += 60) parts.push(`drawbox=x=${x}:y=${H / 2 - 30}:w=2:h=${x % 120 === 0 ? 60 : 30}:color=white@0.8:t=fill`);
  for (let x = 120; x < W; x += 240) parts.push(`drawtext=fontfile='${f}':text='x${x}':x=${x - 30}:y=${H / 2 + 40}:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.6`);
  // 프로필 격자 잘림선
  GRIDS.forEach((g, i) => {
    const top = Math.round((H - g.h) / 2);
    parts.push(`drawbox=x=${20 + i * 8}:y=${top}:w=${W - 40 - i * 16}:h=${g.h}:color=${g.color}:t=6`);
    // drawtext 안의 ':' 는 옵션 구분자라 이스케이프
    const label = `${g.name} 격자 (${top}~${top + g.h})`.replace(/:/g, "\\:");
    parts.push(`drawtext=fontfile='${f}':text='${label}':x=${300}:y=${top + (i === 0 ? 64 : 14)}:fontsize=34:fontcolor=${g.color}:box=1:boxcolor=black@0.7`);
  });
  if (opts.showCaptionLines) {
    const yt = PLATFORMS.youtube_shorts;
    const ig = PLATFORMS.instagram_reels;
    parts.push(`drawbox=x=${yt.marginLeft}:y=${yt.captionBottomY - 180}:w=${W - yt.marginLeft - yt.marginRight}:h=180:color=red@0.35:t=fill`);
    parts.push(`drawtext=fontfile='${f}':text='유튜브 자막 영역 (아래 ${yt.captionBottomY})':x=${yt.marginLeft + 20}:y=${yt.captionBottomY - 50}:fontsize=32:fontcolor=white`);
    parts.push(`drawbox=x=${ig.marginLeft}:y=${ig.captionBottomY - 180}:w=${W - ig.marginLeft - ig.marginRight}:h=180:color=lime@0.35:t=fill`);
    parts.push(`drawtext=fontfile='${f}':text='인스타 자막 영역 (아래 ${ig.captionBottomY})':x=${ig.marginLeft + 20}:y=${ig.captionBottomY - 170}:fontsize=32:fontcolor=white`);
    parts.push(`drawbox=x=${W - yt.marginRight}:y=0:w=2:h=${H}:color=red@0.8:t=fill`);
    parts.push(`drawtext=fontfile='${f}':text='오른쪽 여백선 x${W - yt.marginRight}':x=${W - yt.marginRight - 330}:y=${H - 300}:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.6`);
  }
  return parts.join(",");
}

export async function makeCalibrationKit() {
  await loadPlatformOverrides();
  const out = path.join(dataRoot(), "calibration");
  await mkdir(out, { recursive: true });
  const font = path.join(fontDir(), "Pretendard-Bold.otf");
  const fFilter = filterPath(font);

  // 1) 영상 12초: 재생 중임을 알 수 있게 초 표시, 무음 오디오 포함(일부 앱은 오디오 없는 영상을 다르게 처리)
  const video = path.join(out, "calibration_reels_shorts_1080x1920.mp4");
  await ffmpeg([
    "-f", "lavfi", "-i", `color=c=0x2d3e50:s=${W}x${H}:d=12:r=30`,
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
    "-vf", `${drawGraph(font, { showCaptionLines: true })},drawtext=fontfile='${fFilter}':text='%{eif\\:t\\:d}초':x=(w-tw)/2:y=${H / 2 - 160}:fontsize=64:fontcolor=white`,
    "-t", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", video,
  ]);
  // 2) 표지(격자 잘림 확인용)
  const cover = path.join(out, "calibration_cover_1080x1920.jpg");
  await ffmpeg([
    "-f", "lavfi", "-i", `color=c=0x3b2a4d:s=${W}x${H}:d=1`,
    "-vf", `${drawGraph(font, { showCaptionLines: false })},drawtext=fontfile='${fFilter}':text='표지 눈금':x=(w-tw)/2:y=${H / 2 - 120}:fontsize=72:fontcolor=white`,
    "-frames:v", "1", "-q:v", "2", cover,
  ]);

  // 3) 조정값 템플릿과 확인 절차
  const template = {
    _설명: "실제 앱 캡처에서 읽은 눈금 값을 적으면 다음 렌더부터 적용됩니다. 쓰지 않는 항목은 지워도 됩니다.",
    instagram_reels: { captionBottomY: PLATFORMS.instagram_reels.captionBottomY, marginRight: PLATFORMS.instagram_reels.marginRight, topSafeY: PLATFORMS.instagram_reels.topSafeY, coverTextArea: PLATFORMS.instagram_reels.coverTextArea },
    youtube_shorts: { captionBottomY: PLATFORMS.youtube_shorts.captionBottomY, marginRight: PLATFORMS.youtube_shorts.marginRight, topSafeY: PLATFORMS.youtube_shorts.topSafeY },
    common: { captionBottomY: PLATFORMS.common.captionBottomY, marginRight: PLATFORMS.common.marginRight, coverTextArea: PLATFORMS.common.coverTextArea },
  };
  await writeFile(path.join(out, "platforms.template.json"), JSON.stringify(template, null, 2));
  console.log(`눈금 영상: ${video}\n눈금 표지: ${cover}\n조정값 템플릿: ${path.join(out, "platforms.template.json")} → 값을 고친 뒤 ${platformOverridesFile()} 로 저장`);
}

/**
 * 검증용 합성 소재 생성기. 실제 상품 촬영본이 아니라 FFmpeg 로 그린 시험 영상이다.
 * 검증 사례 3(가로·세로, 서로 다른 해상도·프레임률 혼합), 4(사진), 6(대본보다 짧은 장면)을 재현한다.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { ffmpeg } from "../lib/shorts/media";

export interface TestSource {
  file: string;
  note: string;
}

export async function makeTestSources(dir: string): Promise<TestSource[]> {
  await mkdir(dir, { recursive: true });
  const out = (n: string) => path.join(dir, n);

  // 1) 세로 1080×1920 30fps 7초: 상품(흰 원통)이 좌우로 움직이고 3.5초에 배경이 바뀐다(장면 전환)
  await ffmpeg([
    "-f", "lavfi", "-i", "gradients=s=1080x1920:c0=0x2b4c7e:c1=0x9fc5e8:speed=0.02:d=3.5:r=30",
    "-f", "lavfi", "-i", "gradients=s=1080x1920:c0=0x6b3e26:c1=0xf2c48d:speed=0.02:d=3.5:r=30",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1[bg];[bg]drawbox=x='300+200*sin(t*1.3)':y=700:w=420:h=620:color=white@0.95:t=fill,drawbox=x='300+200*sin(t*1.3)':y=640:w=420:h=80:color=0x333333:t=fill,format=yuv420p[v]",
    "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-t", "7", out("clip_a_portrait_1080x1920_30fps.mp4"),
  ]);

  // 2) 가로 1920×1080 25fps 8초 (원본 오디오 포함): 흰 원통이 회전하듯 폭이 변한다
  await ffmpeg([
    "-f", "lavfi", "-i", "gradients=s=1920x1080:c0=0x1e3d2f:c1=0x8fd3b6:speed=0.015:d=8:r=25",
    "-f", "lavfi", "-i", "sine=frequency=220:duration=8",
    "-filter_complex",
    "[0:v]drawbox=x='960-(160+80*sin(t*2))':y=260:w='320+160*sin(t*2)':h=560:color=white@0.95:t=fill,drawbox=x=0:y=880:w=1920:h=200:color=0x222222@0.6:t=fill,format=yuv420p[v]",
    "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-t", "8", out("clip_b_landscape_1920x1080_25fps.mp4"),
  ]);

  // 3) 세로 720×1280 60fps 2.5초 (짧은 장면)
  await ffmpeg([
    "-f", "lavfi", "-i", "gradients=s=720x1280:c0=0x4a1942:c1=0xe0a3d8:speed=0.03:d=2.5:r=60",
    "-vf", "drawbox=x=200:y='420+120*sin(t*4)':w=320:h=460:color=white@0.95:t=fill,format=yuv420p",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-t", "2.5", out("clip_c_short_720x1280_60fps.mp4"),
  ]);

  // 4) 상품 기준 사진 1200×1200
  await ffmpeg([
    "-f", "lavfi", "-i", "color=c=0xf4ede2:s=1200x1200:d=1",
    "-vf", "drawbox=x=390:y=300:w=420:h=640:color=white:t=fill,drawbox=x=390:y=240:w=420:h=80:color=0x333333:t=fill,drawbox=x=390:y=300:w=420:h=640:color=0xbba48f:t=6",
    "-frames:v", "1", out("product_photo_1200.jpg"),
  ]);

  return [
    { file: out("clip_a_portrait_1080x1920_30fps.mp4"), note: "세로 1080×1920 30fps 7초, 3.5초 장면 전환" },
    { file: out("clip_b_landscape_1920x1080_25fps.mp4"), note: "가로 1920×1080 25fps 8초, 원본 오디오 포함" },
    { file: out("clip_c_short_720x1280_60fps.mp4"), note: "세로 720×1280 60fps 2.5초(짧은 장면)" },
    { file: out("product_photo_1200.jpg"), note: "상품 기준 사진 1200×1200" },
  ];
}

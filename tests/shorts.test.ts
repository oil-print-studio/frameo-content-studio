import { describe, expect, it } from "vitest";
import { buildAss, textWidth, wrapLines } from "@/lib/shorts/captions";
import { josa } from "@/lib/shorts/korean";
import { checkClaims, rulesScript } from "@/lib/shorts/planner";
import { PLATFORMS } from "@/lib/shorts/platforms";
import { postText } from "@/lib/shorts/postText";
import { buildTimeline } from "@/lib/shorts/timeline";
import type { EditPlan, Project, Segment } from "@/lib/shorts/types";
import { estimateTimings } from "@/lib/shorts/voice";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "ptest-000001",
    title: "t",
    product: {
      id: "prod",
      name: "접이식 텀블러",
      purpose: "affiliate",
      url: "https://example.com",
      confirmedAt: "",
      facts: [
        { id: "f1", text: "접으면 높이가 4cm로 줄어요", source: "description", approved: true },
        { id: "f2", text: "뚜껑을 돌려 잠가요", source: "user", approved: true },
      ],
    },
    assets: [
      { id: "a1", fileName: "a.mp4", path: "sources/a1.mp4", hash: "h1", kind: "video", width: 1080, height: 1920, duration: 3, fps: 30, hasAudio: false },
      { id: "a2", fileName: "b.mp4", path: "sources/a2.mp4", hash: "h2", kind: "video", width: 1920, height: 1080, duration: 6, fps: 25, hasAudio: true },
      { id: "img", fileName: "p.jpg", path: "sources/img.jpg", hash: "h3", kind: "image", width: 1200, height: 1200, duration: 0, fps: 0, hasAudio: false },
    ],
    settings: { voice: { provider: "local", voice: "ko" }, brandColor: "#a8845a", targetSeconds: 20, defaultPlatforms: ["common"], captionScale: 1 },
    createdAt: "",
    ...overrides,
  };
}

const seg = (id: string, assetId: string, start: number, end: number): Segment => ({
  id,
  assetId,
  start,
  end,
  observed: [],
  productMatch: "unverified",
  quality: { orientation: "portrait" },
  status: "usable",
  analyzer: "local",
});

function plan(p: Project, sentences = rulesScript(p)): EditPlan {
  return {
    kind: "edit_plan",
    planSchema: 1,
    version: 1,
    projectId: p.id,
    productId: p.product.id,
    approvedFactIds: ["f1", "f2"],
    sourceHashes: {},
    generator: { provider: "rules", promptVersion: "t" },
    sentences,
    hookHistory: [],
    voice: { provider: "local", voice: "ko" },
    captionStyle: { scale: 1, color: "#ffffff", highlight: "#ffd84d" },
    design: { id: "basic-v1", brandColor: "#a8845a" },
    output: { targetSeconds: 20, endCardSeconds: 2 },
    createdAt: "",
  };
}

describe("한국어 조사", () => {
  it("받침에 따라 조사를 고른다", () => {
    expect(josa("텀블러", "은/는")).toBe("텀블러는");
    expect(josa("수납함", "은/는")).toBe("수납함은");
    expect(josa("수납함", "이에요/예요")).toBe("수납함이에요");
    expect(josa("텀블러", "이에요/예요")).toBe("텀블러예요");
  });
});

describe("자막 줄바꿈", () => {
  it("단어 경계에서 나누고 폭을 넘지 않는다", () => {
    const lines = wrapLines("접으면 높이가 4cm로 줄어 가방에 쏙 들어가요 정말 편하고 가벼워요", 840, 70);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l, 70)).toBeLessThanOrEqual(840);
  });
});

describe("대본 규칙", () => {
  it("규칙 대본은 승인한 사실만 쓰고 검사에 걸리지 않는다", () => {
    const p = project();
    const s = rulesScript(p);
    expect(s.filter((x) => x.role === "benefit").map((x) => x.factIds[0])).toEqual(["f1", "f2"]);
    expect(checkClaims(p, s)).toEqual([]);
  });

  it("근거 없는 숫자·체험 문구·가격을 잡아낸다", () => {
    const p = project();
    const s = rulesScript(p);
    s[1] = { ...s[1], text: "제가 써 보니 30% 더 가볍고 9900원이에요." };
    const items = checkClaims(p, s);
    expect(items).toHaveLength(1);
    expect(items[0].blocking).toBe(true);
    expect(items[0].message).toMatch(/경험/);
    expect(items[0].message).toMatch(/숫자/);
    expect(items[0].message).toMatch(/변동/);
  });
});

describe("타임라인", () => {
  it("음성 길이를 빈틈 없이 덮고, 짧은 장면은 다른 구간으로 잇는다", () => {
    const p = project();
    const pl = plan(p);
    const segments = [seg("a1-s0", "a1", 0, 3), seg("a2-s0", "a2", 0, 3), seg("a2-s1", "a2", 3, 6), { ...seg("img-s0", "img", 0, 0), quality: { orientation: "square" as const } }];
    pl.sentences = pl.sentences.map((s, i) => ({ ...s, segmentIds: [segments[Math.min(i, 2)].id] }));
    const durations = [2, 2.5, 4.5, 2, 2.5];
    let t = 0;
    const timings = pl.sentences.map((s, i) => {
      const r = { sentenceId: s.id, start: t, end: t + durations[i], source: "measured" as const };
      t += durations[i] + 0.2;
      return r;
    });
    const tl = buildTimeline(p, pl, segments, { audioRel: "x.wav", duration: t - 0.2, timings, voice: pl.voice, reusedUnits: 0, synthesizedUnits: 0 });
    let cursor = 0;
    for (const c of tl.cuts) {
      expect(c.outStart).toBeCloseTo(cursor, 2);
      if (c.srcEnd > c.srcStart) expect(c.srcEnd).toBeLessThanOrEqual(p.assets.find((a) => a.id === c.assetId)!.duration + 0.01);
      cursor = c.outEnd;
    }
    expect(cursor).toBeCloseTo(tl.speechEnd, 2);
    expect(tl.totalDuration).toBeCloseTo(tl.speechEnd + 2, 2);
  });

  it("블록 음성의 문장 경계는 추정으로 표시한다", () => {
    const p = project();
    const t = estimateTimings(rulesScript(p).slice(1, 3), 1, 6);
    expect(t.every((x) => x.source === "estimated")).toBe(true);
    expect(t[t.length - 1].end).toBeCloseTo(7, 3);
  });
});

describe("플랫폼별 출력", () => {
  const p = project();
  const pl = plan(p);
  const tl = {
    planVersion: 1,
    audioPath: "",
    audioDuration: 10,
    speechEnd: 10,
    totalDuration: 12,
    sentences: pl.sentences.map((s, i) => ({ sentenceId: s.id, start: i * 2, end: i * 2 + 1.8, source: "measured" as const })),
    cuts: [],
    endCard: { start: 10, end: 12 },
    warnings: [],
  };

  it("자막 위치와 마지막 안내가 플랫폼마다 다르다", () => {
    const yt = buildAss(pl, tl, "youtube_shorts", p.product);
    const ig = buildAss(pl, tl, "instagram_reels", p.product);
    expect(yt).toContain(`,${1920 - PLATFORMS.youtube_shorts.captionBottomY},1\n`);
    expect(ig).toContain(`,${1920 - PLATFORMS.instagram_reels.captionBottomY},1\n`);
    expect(yt).toContain("설명란");
    expect(ig).toContain("프로필 링크");
    expect(yt).toContain("광고 · 제휴");
  });

  it("공용 자막은 두 플랫폼 중 더 안전한 위치를 쓴다", () => {
    expect(PLATFORMS.common.captionBottomY).toBeLessThanOrEqual(Math.min(PLATFORMS.youtube_shorts.captionBottomY, PLATFORMS.instagram_reels.captionBottomY));
    expect(PLATFORMS.common.marginRight).toBeGreaterThanOrEqual(Math.max(PLATFORMS.youtube_shorts.marginRight, PLATFORMS.instagram_reels.marginRight));
  });

  it("게시 문구: 제휴 고지와 플랫폼별 링크 안내", () => {
    const yt = postText(p.product, pl, "youtube_shorts");
    const ig = postText(p.product, pl, "instagram_reels");
    expect(yt.body).toMatch(/^\[광고\]/);
    expect(yt.body).toContain("구매 링크: https://example.com");
    expect(yt.body).toContain("#Shorts");
    expect(ig.body).toContain("프로필 링크");
    expect(yt.title.length).toBeLessThanOrEqual(100);
  });
});

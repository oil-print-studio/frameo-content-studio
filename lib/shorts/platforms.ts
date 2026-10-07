import type { PlatformId, ProductCard } from "./types";

/**
 * 플랫폼별 출력 차이. 영상 본편(컷·음성)은 모든 플랫폼이 공유하고
 * 자막 위치, 마지막 안내 문구, 표지 글자 영역, 게시 문구만 달라진다.
 *
 * 안전 영역 값은 1080×1920 기준 설계값이다. 각 앱의 UI(제목·버튼·설명 영역)는 수시로 바뀌므로
 * 실제 게시 화면에서 확인 후 조정한다.
 */
export interface PlatformProfile {
  id: PlatformId;
  label: string;
  /** 자막 블록 아래쪽이 놓일 위치(화면 위에서부터 y px) */
  captionBottomY: number;
  marginLeft: number;
  /** 오른쪽 좋아요·댓글 버튼 영역을 피하는 여백 */
  marginRight: number;
  /** 상단 UI(검색·카메라 아이콘 등) 아래에서 시작하는 y */
  topSafeY: number;
  /** 표지 제목을 둘 영역(위·아래 y). 릴스는 프로필 격자에서 가운데 4:5 영역만 보인다 */
  coverTextArea: { top: number; bottom: number };
  /** 마지막 안내 문구(구매 링크가 있을 때 / 없을 때) */
  endCardText: { withUrl: string; withoutUrl: string };
}

export function endCardLine(p: PlatformProfile, product: Pick<ProductCard, "url">): string {
  return product.url ? p.endCardText.withUrl : p.endCardText.withoutUrl;
}

const BASE_W = 1080;
const BASE_H = 1920;
/** 릴스 프로필 격자(4:5)로 잘릴 때 남는 가운데 영역 */
const GRID_4x5_TOP = Math.round((BASE_H - BASE_W * 1.25) / 2); // 285

export const PLATFORMS: Record<PlatformId, PlatformProfile> = {
  youtube_shorts: {
    id: "youtube_shorts",
    label: "유튜브 쇼츠",
    captionBottomY: 1380,
    marginLeft: 70,
    marginRight: 170,
    topSafeY: 200,
    coverTextArea: { top: 560, bottom: 1300 },
    endCardText: { withUrl: "구매 정보는 채널 프로필 링크에서 확인하세요", withoutUrl: "자세한 정보는 채널 프로필에서 확인하세요" },
  },
  instagram_reels: {
    id: "instagram_reels",
    label: "인스타 릴스",
    captionBottomY: 1290,
    marginLeft: 70,
    marginRight: 170,
    topSafeY: 240,
    coverTextArea: { top: GRID_4x5_TOP + 160, bottom: BASE_H - GRID_4x5_TOP - 160 },
    endCardText: { withUrl: "구매 링크는 프로필 링크에", withoutUrl: "자세한 정보는 프로필에" },
  },
  common: {
    id: "common",
    label: "쇼츠·릴스 공용",
    // 두 플랫폼 안전 영역의 교집합: 더 높은 자막 위치, 더 넓은 여백
    captionBottomY: 1290,
    marginLeft: 70,
    marginRight: 170,
    topSafeY: 240,
    coverTextArea: { top: GRID_4x5_TOP + 160, bottom: BASE_H - GRID_4x5_TOP - 160 },
    // 유튜브·인스타 모두 채널 프로필에 링크를 둘 수 있으므로 공용 문구도 프로필 기준
    endCardText: { withUrl: "구매 정보는 채널 프로필 링크에서 확인하세요", withoutUrl: "자세한 정보는 채널 프로필에서 확인하세요" },
  },
};

const DEFAULTS: Record<PlatformId, PlatformProfile> = structuredClone(PLATFORMS);

export type PlatformOverride = Partial<Omit<PlatformProfile, "id" | "label">>;

/**
 * 실제 앱 화면 확인 결과로 안전 영역·표지 영역·마지막 안내를 조정한다(서버에서 data/shorts/platforms.json 을 읽어 적용).
 * 기본값 위에 덮어쓰며, 다시 호출하면 이전 조정은 버리고 새 값으로 바꾼다.
 */
export function applyPlatformOverrides(overrides: Partial<Record<PlatformId, PlatformOverride>> | undefined) {
  for (const id of Object.keys(DEFAULTS) as PlatformId[]) {
    const o = overrides?.[id] ?? {};
    PLATFORMS[id] = {
      ...DEFAULTS[id],
      ...o,
      coverTextArea: { ...DEFAULTS[id].coverTextArea, ...o.coverTextArea },
      endCardText: { ...DEFAULTS[id].endCardText, ...o.endCardText },
      id,
      label: DEFAULTS[id].label,
    };
  }
}

export const PLATFORM_IDS: PlatformId[] = ["common", "youtube_shorts", "instagram_reels"];

export const FRAME = { width: BASE_W, height: BASE_H, fps: 30 } as const;

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === "string" && value in PLATFORMS;
}

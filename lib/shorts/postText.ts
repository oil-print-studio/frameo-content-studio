import { PLATFORMS } from "./platforms";
import type { EditPlan, PlatformId, ProductCard } from "./types";

/** 제휴 상품 고지 문구 (설정으로 바꿀 수 있게 상수로 분리) */
export const AFFILIATE_DISCLOSURE = "이 콘텐츠는 제휴 마케팅 활동의 일환으로, 구매 시 수수료를 제공받을 수 있습니다.";

function tag(name: string) {
  return `#${name.replace(/[^\p{L}\p{N}]/gu, "")}`;
}

function factLines(product: ProductCard) {
  return product.facts.filter((f) => f.approved).map((f) => `· ${f.text.replace(/[.]$/, "")}`);
}

export interface PostText {
  title: string;
  body: string;
}

export function postText(product: ProductCard, plan: EditPlan, platform: PlatformId): PostText {
  const hook = plan.sentences.find((s) => s.role === "hook");
  const hookLine = (hook?.caption || hook?.text || "").replace(/[.]$/, "");
  const disclosure = product.purpose === "affiliate" ? [`[광고] ${AFFILIATE_DISCLOSURE}`, ""] : [];
  const tags = [tag(product.name)];

  if (platform === "youtube_shorts") {
    const title = `${product.name} | ${hookLine}`.slice(0, 95);
    const body = [...disclosure, hookLine, "", ...factLines(product), "", product.url ? `구매 링크: ${product.url}` : "", "", [...tags, "#Shorts"].join(" ")].filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
    return { title, body: body.trim() };
  }
  if (platform === "instagram_reels") {
    // 인스타그램 본문 링크는 눌리지 않으므로 프로필 링크로 안내한다
    const body = [...disclosure, hookLine, "", ...factLines(product), "", product.url ? `구매 링크는 프로필 링크에서 확인하세요.\n(${product.url})` : "", "", [...tags, "#릴스"].join(" ")]
      .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
      .join("\n");
    return { title: hookLine, body: body.trim() };
  }
  const yt = postText(product, plan, "youtube_shorts");
  const ig = postText(product, plan, "instagram_reels");
  return {
    title: yt.title,
    body: [`[${PLATFORMS.youtube_shorts.label}]`, `제목: ${yt.title}`, yt.body, "", `[${PLATFORMS.instagram_reels.label}]`, ig.body].join("\n"),
  };
}

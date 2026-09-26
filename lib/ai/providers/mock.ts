import { withBrandLink } from "../format";
import type { Caption, CaptionInput, CaptionProvider } from "../types";

const HOOKS = [
  () => `휴대폰 속 사진 한 장이, 벽에 거는 작품이 되었습니다.`,
  (t: string) => `"${t}" — 그 순간을 오래 남기는 방법.`,
  () => `매일 보는 사진, 이제는 매일 보는 작품으로.`,
  (t: string) => `같은 사진, 전혀 다른 울림. ${t}`,
];

const CTAS = [
  "간직하고 싶은 사진이 있다면, 사진 한 장만 보내주세요. 나머지는 FRAME O가 완성합니다.",
  "소중한 사진을 작품으로 남기고 싶다면 프로필 링크에서 바로 주문하실 수 있어요.",
  "선물로도, 우리 집 한 켠을 위해서도. 지금 frameoart.com 에서 주문해보세요.",
];

const BASE_TAGS = [
  "#FRAMEO",
  "#프레임오",
  "#사진한장작품한점",
  "#사진액자",
  "#맞춤액자",
  "#인테리어액자",
  "#포토아트",
  "#기념일선물",
  "#집들이선물",
  "#갤러리액자",
];

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length) % list.length];
}

/** "유화 캔버스 40×50" → "#유화캔버스" (숫자·사이즈 표기는 태그에서 제외) */
function productTag(productType: string): string[] {
  const t = productType
    .split(/\s+/)
    .filter((word) => word && !/\d/.test(word))
    .join("");
  return t ? [`#${t}`] : [];
}

export function buildMockCaption(input: CaptionInput, random: () => number = Math.random): Caption {
  const topic = input.topic.trim();
  const product = input.productType?.trim();
  const price = input.price?.trim();
  const story = input.story?.trim();

  const lines: string[] = [];
  if (story) {
    lines.push(story.endsWith(".") ? story : `${story}.`);
  }
  lines.push(
    product
      ? `원본 사진의 분위기를 살려 ${product} 작품으로 완성했습니다. 빛과 색을 한 번 더 다듬어, 오래 두고 보아도 편안한 작품이 되도록 작업했어요.`
      : `원본 사진의 분위기를 살려 하나의 작품으로 완성했습니다. 빛과 색을 한 번 더 다듬어, 오래 두고 보아도 편안한 작품이 되도록 작업했어요.`,
  );
  if (price) lines.push(`가격: ${price}`);

  return withBrandLink({
    hook: pick(HOOKS, random)(topic),
    description: lines.join("\n"),
    cta: pick(CTAS, random),
    hashtags: [...BASE_TAGS.slice(0, 3), ...productTag(product ?? ""), ...BASE_TAGS.slice(3)],
  });
}

export function createMockProvider(random: () => number = Math.random): CaptionProvider {
  return {
    name: "mock",
    async generate(input) {
      // 실제 API 호출 느낌을 주기 위한 짧은 지연
      await new Promise((r) => setTimeout(r, 400));
      return buildMockCaption(input, random);
    },
  };
}

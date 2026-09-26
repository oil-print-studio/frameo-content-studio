import { describe, expect, it } from "vitest";
import { composeBody, composeHashtags, normalizeHashtags } from "@/lib/ai/format";
import { getCaptionProvider } from "@/lib/ai";
import { buildMockCaption } from "@/lib/ai/providers/mock";
import { buildUserPrompt } from "@/lib/ai/prompt";
import { captionInputSchema } from "@/lib/ai/schema";
import { BRAND } from "@/lib/brand";

const input = captionInputSchema.parse({
  topic: "부모님 결혼 40주년 사진을 유화로",
  productType: "유화 캔버스 40×50",
  price: "89,000원",
  story: "따님이 선물로 주문해주셨어요",
});

describe("captionInputSchema", () => {
  it("requires a topic", () => {
    expect(captionInputSchema.safeParse({ topic: "   " }).success).toBe(false);
  });

  it("defaults optional fields to empty strings", () => {
    expect(captionInputSchema.parse({ topic: "주제" })).toEqual({
      topic: "주제",
      productType: "",
      price: "",
      story: "",
    });
  });
});

describe("mock provider", () => {
  it("builds a complete caption with brand link", () => {
    const caption = buildMockCaption(input, () => 0);
    expect(caption.hook).not.toBe("");
    expect(caption.description).toContain("유화 캔버스");
    expect(caption.description).toContain("가격: 89,000원");
    expect(caption.description).toContain("따님이 선물로 주문해주셨어요.");
    expect(caption.link).toBe(BRAND.domain);
    expect(caption.hashtags).toContain("#FRAMEO");
    expect(caption.hashtags).toContain("#유화캔버스");
    expect(caption.hashtags.every((t) => t.startsWith("#"))).toBe(true);
  });

  it("is chosen when no API key is configured", () => {
    expect(getCaptionProvider({ NODE_ENV: "test" }).name).toBe("mock");
    expect(getCaptionProvider({ NODE_ENV: "test", AI_PROVIDER: "mock", ANTHROPIC_API_KEY: "x" }).name).toBe("mock");
    expect(getCaptionProvider({ NODE_ENV: "test", ANTHROPIC_API_KEY: "x" }).name).toBe("anthropic");
  });
});

describe("format helpers", () => {
  it("normalizes and dedupes hashtags", () => {
    expect(normalizeHashtags(["#액자", "액자", "## 사진 액자", "", "#FRAMEO", "#frameo"])).toEqual([
      "#액자",
      "#사진액자",
      "#FRAMEO",
    ]);
  });

  it("composes body with link at the end and hashtags on one line", () => {
    const body = composeBody({ hook: "훅", description: "설명", cta: "주문", link: BRAND.domain });
    expect(body).toBe(`훅\n\n설명\n\n주문\n\n🔗 ${BRAND.domain}`);
    expect(composeHashtags(["a", "#b"])).toBe("#a #b");
  });

  it("includes only provided fields in the user prompt", () => {
    const prompt = buildUserPrompt(captionInputSchema.parse({ topic: "주제만" }));
    expect(prompt).toContain("홍보 주제: 주제만");
    expect(prompt).not.toContain("가격");
  });
});

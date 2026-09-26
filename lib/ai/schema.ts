import { z } from "zod";

export const captionInputSchema = z.object({
  topic: z.string().trim().min(1, "홍보 주제를 입력해주세요.").max(200),
  productType: z.string().trim().max(60).optional().default(""),
  price: z.string().trim().max(40).optional().default(""),
  story: z.string().trim().max(600).optional().default(""),
});

/** AI가 돌려주는 게시물 글 구조. link 는 서버에서 고정값으로 채운다. */
export const captionOutputSchema = z.object({
  hook: z.string().describe("피드에서 스크롤을 멈추게 하는 첫 문장 한 줄"),
  description: z.string().describe("작품에 대한 짧은 설명, 2~4문장"),
  cta: z.string().describe("주문을 유도하는 한두 문장"),
  hashtags: z.array(z.string()).describe("# 포함 해시태그 10~15개"),
});

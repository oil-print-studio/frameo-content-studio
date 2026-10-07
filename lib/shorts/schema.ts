import { z } from "zod";
import { PLATFORM_IDS } from "./platforms";

export const productInputSchema = z.object({
  name: z.string().trim().min(1, "상품명을 입력해 주세요.").max(60),
  purpose: z.enum(["own", "affiliate"]),
  url: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || undefined)
    .refine((v) => !v || /^https?:\/\//.test(v), "구매 링크는 http(s):// 로 시작해야 해요."),
  cta: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || undefined),
  facts: z
    .array(
      z.object({
        text: z.string().trim().max(80),
        source: z.enum(["user", "description", "observed"]),
        sourceNote: z.string().trim().max(120).optional(),
      }),
    )
    .max(3, "장점은 최대 3개까지 넣을 수 있어요.")
    .transform((list) => list.filter((f) => f.text.length > 0))
    .refine((list) => list.length > 0, "확인된 장점을 하나 이상 넣어 주세요."),
});

export const editSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("captionScale"), scale: z.number().min(0.8).max(1.5) }),
  z.object({ op: z.literal("editSentence"), sentenceId: z.string(), text: z.string().trim().min(1).max(120), caption: z.string().trim().max(60).optional() }),
  z.object({ op: z.literal("shorter") }),
  z.object({ op: z.literal("newHook") }),
  z.object({ op: z.literal("swapScene"), sentenceId: z.string(), segmentId: z.string() }),
  z.object({ op: z.literal("confirmAsset"), assetId: z.string(), confirmed: z.boolean() }),
  z.object({ op: z.literal("excludeAsset"), assetId: z.string() }),
]);

export const exportSchema = z.object({
  platforms: z.array(z.enum(PLATFORM_IDS as [string, ...string[]])).min(1, "저장할 플랫폼을 하나 이상 골라 주세요."),
});

export const settingsSchema = z.object({
  voice: z.object({ provider: z.enum(["gemini", "local"]), voice: z.string().trim().min(1).max(40), rate: z.number().min(100).max(260).optional() }),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  defaultCta: z.string().trim().max(80).optional(),
  targetSeconds: z.number().min(10).max(60),
  defaultPlatforms: z.array(z.enum(PLATFORM_IDS as [string, ...string[]])).min(1),
  captionScale: z.number().min(0.8).max(1.5),
});

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

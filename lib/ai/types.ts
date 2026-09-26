import type { z } from "zod";
import type { captionInputSchema } from "./schema";

export type CaptionInput = z.infer<typeof captionInputSchema>;

export interface Caption {
  hook: string;
  description: string;
  cta: string;
  link: string;
  hashtags: string[];
}

export type ProviderName = "anthropic" | "mock";

export interface CaptionProvider {
  readonly name: ProviderName;
  generate(input: CaptionInput): Promise<Caption>;
}

export interface CaptionResponse {
  caption: Caption;
  provider: ProviderName;
  /** 실제 provider 실패 등으로 mock 을 대신 쓴 경우 안내 문구 */
  notice?: string;
}

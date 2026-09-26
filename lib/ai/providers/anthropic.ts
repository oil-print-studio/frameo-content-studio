import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { withBrandLink } from "../format";
import { buildUserPrompt, SYSTEM_PROMPT } from "../prompt";
import { captionOutputSchema } from "../schema";
import type { CaptionProvider } from "../types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

export function createAnthropicProvider(options: { apiKey: string; model?: string }): CaptionProvider {
  const client = new Anthropic({ apiKey: options.apiKey, timeout: 60_000 });
  const model = options.model || DEFAULT_ANTHROPIC_MODEL;

  return {
    name: "anthropic",
    async generate(input) {
      const response = await client.messages.parse({
        model,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(input) }],
        output_config: {
          effort: "medium",
          format: zodOutputFormat(captionOutputSchema),
        },
      });

      if (response.stop_reason === "refusal") {
        throw new Error("AI가 요청을 거절했습니다.");
      }
      if (!response.parsed_output) {
        throw new Error(`AI 응답을 해석하지 못했습니다 (stop_reason: ${response.stop_reason}).`);
      }
      return withBrandLink(response.parsed_output);
    },
  };
}

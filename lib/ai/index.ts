import { createAnthropicProvider } from "./providers/anthropic";
import { createMockProvider } from "./providers/mock";
import type { CaptionProvider } from "./types";

/**
 * 환경변수로 AI provider 를 고른다.
 *  - AI_PROVIDER=mock      → 항상 mock
 *  - AI_PROVIDER=anthropic → Anthropic (키 없으면 mock)
 *  - 그 외(auto)           → ANTHROPIC_API_KEY 가 있으면 Anthropic, 없으면 mock
 * 새 provider 는 providers/ 에 CaptionProvider 를 구현하고 여기에 분기를 추가하면 된다.
 */
export function getCaptionProvider(env: NodeJS.ProcessEnv = process.env): CaptionProvider {
  const choice = (env.AI_PROVIDER ?? "auto").toLowerCase();
  const apiKey = env.ANTHROPIC_API_KEY?.trim();

  if (choice !== "mock" && apiKey) {
    return createAnthropicProvider({ apiKey, model: env.ANTHROPIC_MODEL?.trim() });
  }
  return createMockProvider();
}

export { createMockProvider };
export type { Caption, CaptionInput, CaptionProvider, CaptionResponse } from "./types";

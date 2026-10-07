import { GEMINI_MODELS, generateJson, GeminiError, hasGemini } from "./gemini";
import { asSentence, josa, numberTokens } from "./korean";
import type { EditPlan, Project, ProductCard, ReviewItem, Segment, Sentence, SentenceRole, VoiceBlockId } from "./types";

export const PLAN_PROMPT_VERSION = "plan-v1";

/** 직접 사용하지 않았는데 체험처럼 들리는 표현 */
const EXPERIENCE_PATTERNS = [/써\s*보니/, /써\s*봤/, /사용해\s*보니/, /사용해\s*봤/, /제가\s*(직접|써|사용)/, /직접\s*(써|사용)/, /후기/];
/** 가격·재고 등 변동 정보는 명시적으로 확인한 사실에만 근거해야 한다 */
const VOLATILE_PATTERNS = [/\d+\s*원/, /할인/, /최저가/, /품절/, /재고/, /무료\s*배송/];
/** 화면만으로 확인되지 않는 성능·인증 주장 */
const STRONG_CLAIMS = [/최고/, /1위/, /완벽/, /100\s*%/, /인증/, /특허/, /평생/, /절대/];

function blockOf(role: SentenceRole): VoiceBlockId {
  return role === "hook" ? "hook" : role === "cta" ? "outro" : "body";
}

export function defaultCta(product: ProductCard, channelCta?: string): string {
  if (product.cta?.trim()) return asSentence(product.cta);
  if (channelCta?.trim()) return asSentence(channelCta);
  return product.purpose === "affiliate" ? "제품 정보와 구매 링크는 아래 안내를 확인하세요." : "구매는 아래 안내 링크에서 하실 수 있어요.";
}

export function ruleHooks(product: ProductCard): string[] {
  const n = product.name.trim();
  return [
    `${n}, 핵심만 짧게 보여드릴게요.`,
    `이거 보셨어요? ${josa(n, "이에요/예요")}.`,
    `${josa(n, "이/가")} 궁금하셨다면 끝까지 보세요.`,
    `${n}, 어떻게 쓰는지 바로 보여드릴게요.`,
  ];
}

function emphasisOf(text: string): string | undefined {
  const withNum = text.match(/\S*\d\S*/)?.[0];
  if (withNum) return withNum.replace(/[.,!?]$/, "");
  const word = text.split(/\s+/).find((w) => w.replace(/[^\p{L}\p{N}]/gu, "").length >= 2);
  return word?.replace(/[.,!?]$/, "");
}

/** 영상 구간 순서를 소재별로 번갈아 고른다 (같은 소재만 반복되지 않게) */
function interleave(segments: Segment[]): Segment[] {
  const byAsset = new Map<string, Segment[]>();
  for (const s of segments) byAsset.set(s.assetId, [...(byAsset.get(s.assetId) ?? []), s]);
  const queues = [...byAsset.values()];
  const out: Segment[] = [];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) out.push(q.shift()!);
  return out;
}

/**
 * 장면 배정(로컬). 로컬 분석은 장면 내용을 모르므로 소재 순서·길이 기준으로 배정하고 그 사실을 이유에 남긴다.
 * 사용 가능 구간을 먼저 쓰고, 부족할 때만 확인 필요 구간을 쓴다(확인 항목으로 남음).
 */
export function assignScenes(project: Project, sentences: Sentence[], segments: Segment[]): Sentence[] {
  const candidates = segments.filter((s) => s.status !== "excluded");
  const videoSegs = interleave(candidates.filter((s) => s.end > s.start).sort((a, b) => rank(a) - rank(b)));
  const stills = candidates.filter((s) => s.end === s.start);
  const refStill = stills.find((s) => s.assetId === project.product.referenceAssetId) ?? stills[0];
  const used = new Set<string>();
  const pick = (): Segment | undefined => {
    const s = videoSegs.find((x) => !used.has(x.id)) ?? videoSegs[0] ?? stills.find((x) => !used.has(x.id)) ?? refStill;
    if (s) used.add(s.id);
    return s;
  };
  return sentences.map((s) => {
    if (s.locked && s.segmentIds.length) return s;
    let seg: Segment | undefined;
    let reason: string;
    if (s.role === "cta" && refStill) {
      seg = refStill;
      reason = "구매 안내: 상품 기준 사진";
    } else {
      seg = pick();
      reason = seg?.analyzer === "gemini" && seg.observed.length ? `보이는 동작: ${seg.observed.join(", ")}` : "소재 순서대로 배정(로컬 분석은 장면 내용을 판별하지 않음)";
    }
    return { ...s, segmentIds: seg ? [seg.id] : [], sceneReason: reason };
  });
}

function rank(s: Segment): number {
  return s.status === "usable" ? 0 : 1;
}

/** AI 없이 승인된 사실만으로 만드는 대본 */
export function rulesScript(project: Project, hookIndex = 0): Sentence[] {
  const p = project.product;
  const facts = p.facts.filter((f) => f.approved).slice(0, 3);
  const hasVideo = project.assets.some((a) => a.kind === "video" && !a.excluded);
  const hooks = ruleHooks(p);
  const sentences: Omit<Sentence, "segmentIds" | "sceneReason">[] = [
    { id: "s-hook", role: "hook", text: hooks[hookIndex % hooks.length], factIds: [], priority: 1, block: "hook" },
    {
      id: "s-demo",
      role: "demo",
      text: hasVideo ? `${josa(p.name, "은/는")} 이렇게 사용합니다.` : `${josa(p.name, "을/를")} 자세히 보여드릴게요.`,
      factIds: [],
      priority: 2,
      block: "body",
    },
    ...facts.map((f, i) => ({
      id: `s-fact-${f.id}`,
      role: "benefit" as const,
      text: asSentence(f.text),
      emphasis: emphasisOf(f.text),
      factIds: [f.id],
      priority: (i === 0 ? 1 : i === 1 ? 2 : 3) as 1 | 2 | 3,
      block: "body" as const,
    })),
    { id: "s-cta", role: "cta", text: defaultCta(p, project.settings.defaultCta), factIds: [], priority: 1, block: "outro" },
  ];
  return sentences.map((s) => ({ ...s, segmentIds: [], sceneReason: "" }));
}

interface GeminiPlan {
  sentences: { role: SentenceRole; text: string; caption: string; emphasis: string; factIds: string[]; segmentIds: string[]; sceneReason: string; priority: number }[];
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    sentences: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["hook", "demo", "benefit", "cta"] },
          text: { type: "string" },
          caption: { type: "string", description: "화면 자막, 2줄(약 26자) 이내" },
          emphasis: { type: "string", description: "자막에서 강조할 핵심 표현 하나(자막에 포함된 문자열)" },
          factIds: { type: "array", items: { type: "string" } },
          segmentIds: { type: "array", items: { type: "string" } },
          sceneReason: { type: "string" },
          priority: { type: "integer", minimum: 1, maximum: 3 },
        },
        required: ["role", "text", "caption", "emphasis", "factIds", "segmentIds", "sceneReason", "priority"],
      },
    },
  },
  required: ["sentences"],
};

async function geminiScript(project: Project, segments: Segment[], hookOnly?: { avoid: string[] }): Promise<Sentence[]> {
  const p = project.product;
  const facts = p.facts.filter((f) => f.approved);
  const segs = segments.filter((s) => s.status !== "excluded");
  const prompt = [
    "한국어 9:16 쇼핑 쇼츠 대본과 장면 배치를 만든다. 구성: 관심을 끄는 시작(hook) → 실제 사용 장면(demo) → 확인된 장점(benefit) → 구매 안내(cta).",
    `목표 길이: 약 ${project.settings.targetSeconds}초(한국어 1초≈7자). 판매 목적: ${p.purpose === "own" ? "자사 상품 판매" : "제휴 상품 소개"}.`,
    `상품명: ${p.name}`,
    "승인된 상품 사실(이 목록에 없는 성능·가격·재질·인증·효과는 쓰지 말 것):",
    ...facts.map((f) => `- [${f.id}] ${f.text} (출처: ${f.source})`),
    "사용 가능한 소재 구간:",
    ...segs.map((s) => `- [${s.id}] ${(s.end - s.start || 3).toFixed(1)}초, 보이는 것: ${s.observed.join(", ") || "(정보 없음)"}${s.status === "review" ? " (확인 필요)" : ""}`),
    "규칙: 직접 사용하지 않았으므로 '써 보니', '제가 써 보니' 같은 체험 문구 금지. 각 문장은 근거가 된 사실 id 와 장면 구간 id 를 연결.",
    "장면이 없는 장점은 억지로 끼워 넣지 말고 빼거나 표현을 바꿀 것. cta 는 '아래 안내' 처럼 플랫폼 공통 표현을 쓸 것.",
    `cta 문장은 다음을 그대로 사용: "${defaultCta(p, project.settings.defaultCta)}"`,
    hookOnly ? `hook 문장 하나만 새로 만들 것. 이미 쓴 시작 문구와 다르게: ${hookOnly.avoid.join(" / ")}` : "",
  ].join("\n");
  const out = await generateJson<GeminiPlan>({
    projectId: project.id,
    task: hookOnly ? "plan:hook" : "plan:script",
    model: GEMINI_MODELS.plan,
    prompt,
    schema: PLAN_SCHEMA,
  });
  const validSegs = new Set(segs.map((s) => s.id));
  const validFacts = new Set(facts.map((f) => f.id));
  return out.sentences.map((s, i) => ({
    id: s.role === "hook" ? "s-hook" : s.role === "cta" ? "s-cta" : `s-${i}-${s.role}`,
    role: s.role,
    text: asSentence(s.text),
    caption: s.caption || undefined,
    emphasis: s.emphasis || undefined,
    factIds: s.factIds.filter((id) => validFacts.has(id)),
    segmentIds: s.segmentIds.filter((id) => validSegs.has(id)),
    sceneReason: s.sceneReason,
    priority: Math.min(3, Math.max(1, Math.round(s.priority))) as 1 | 2 | 3,
    block: blockOf(s.role),
  }));
}

export interface PlanResult {
  sentences: Sentence[];
  generator: EditPlan["generator"];
  notice?: string;
}

export async function generateScript(project: Project, segments: Segment[]): Promise<PlanResult> {
  if (hasGemini()) {
    try {
      const sentences = assignMissingScenes(project, await geminiScript(project, segments), segments);
      return { sentences, generator: { provider: "gemini", model: GEMINI_MODELS.plan, promptVersion: PLAN_PROMPT_VERSION } };
    } catch (err) {
      // 키·권한·한도 오류는 그대로 알린다. 그 밖의 오류는 규칙 기반 대본으로 이어가되 알린다.
      if (err instanceof GeminiError && (err.kind === "auth" || err.kind === "quota")) throw err;
      return {
        sentences: assignScenes(project, rulesScript(project), segments),
        generator: { provider: "rules", promptVersion: PLAN_PROMPT_VERSION },
        notice: `AI 대본 생성 실패로 규칙 기반 대본을 사용했습니다: ${(err as Error).message}`,
      };
    }
  }
  return {
    sentences: assignScenes(project, rulesScript(project), segments),
    generator: { provider: "rules", promptVersion: PLAN_PROMPT_VERSION },
  };
}

function assignMissingScenes(project: Project, sentences: Sentence[], segments: Segment[]): Sentence[] {
  const missing = sentences.filter((s) => !s.segmentIds.length);
  if (!missing.length) return sentences;
  const assigned = assignScenes(project, sentences, segments.filter((seg) => !sentences.some((s) => s.segmentIds.includes(seg.id))));
  return sentences.map((s, i) => (s.segmentIds.length ? s : assigned[i]));
}

/** 첫 3초 바꾸기: 시작 문장만 새로 만든다 */
export async function newHook(project: Project, plan: EditPlan, segments: Segment[]): Promise<{ text: string; viaAi: boolean }> {
  const used = new Set([...plan.hookHistory, plan.sentences.find((s) => s.role === "hook")?.text ?? ""]);
  if (hasGemini()) {
    const out = await geminiScript(project, segments, { avoid: [...used] });
    const hook = out.find((s) => s.role === "hook");
    if (hook) return { text: hook.text, viaAi: true };
  }
  const options = ruleHooks(project.product);
  const next = options.find((h) => !used.has(h)) ?? options[(plan.hookHistory.length + 1) % options.length];
  return { text: next, viaAi: false };
}

/**
 * 문장 검사: 승인되지 않은 사실, 근거 없는 숫자, 체험 문구, 변동 정보, 강한 주장.
 * 구조화 JSON 이 정상이어도 내용의 진실성은 보장되지 않으므로 AI·사용자 수정 모두에 적용한다.
 */
export function checkClaims(project: Project, sentences: Sentence[]): ReviewItem[] {
  const facts = project.product.facts.filter((f) => f.approved);
  const factText = facts.map((f) => f.text).join(" ") + " " + project.product.name;
  const allowedNumbers = new Set(numberTokens(factText));
  const items: ReviewItem[] = [];
  for (const s of sentences) {
    const text = `${s.text} ${s.caption ?? ""}`;
    const problems: string[] = [];
    if (EXPERIENCE_PATTERNS.some((r) => r.test(text))) problems.push("직접 사용 경험처럼 들리는 표현");
    const unknownNums = numberTokens(text).filter((n) => !allowedNumbers.has(n));
    if (unknownNums.length) problems.push(`승인된 사실에 없는 숫자(${unknownNums.join(", ")})`);
    if (VOLATILE_PATTERNS.some((r) => r.test(text) && !r.test(factText))) problems.push("가격·재고 같은 변동 정보");
    if (STRONG_CLAIMS.some((r) => r.test(text) && !r.test(factText))) problems.push("근거가 확인되지 않은 강한 주장");
    const unknownFacts = s.factIds.filter((id) => !facts.some((f) => f.id === id));
    if (unknownFacts.length) problems.push("승인되지 않은 사실 참조");
    if (problems.length)
      items.push({
        id: `claim-${s.id}`,
        kind: "unsupported_claim",
        blocking: true,
        sentenceId: s.id,
        message: `“${s.text}” — ${problems.join(", ")}`,
      });
  }
  return items;
}

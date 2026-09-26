import { BRAND } from "@/lib/brand";
import type { Caption } from "./types";

/** "#액자", "액자", "# 액자" → "#액자" 로 정리하고 중복 제거 */
export function normalizeHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const body = raw.replace(/^#+/, "").replace(/\s+/g, "").trim();
    if (!body) continue;
    const tag = `#${body}`;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** 인스타 본문(해시태그 제외) */
export function composeBody(caption: Pick<Caption, "hook" | "description" | "cta" | "link">): string {
  return [caption.hook, caption.description, caption.cta, `🔗 ${caption.link}`]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function composeHashtags(tags: string[]): string {
  return normalizeHashtags(tags).join(" ");
}

export function withBrandLink(c: Omit<Caption, "link">): Caption {
  return { ...c, link: BRAND.domain, hashtags: normalizeHashtags(c.hashtags) };
}

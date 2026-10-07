import { FRAME, PLATFORMS } from "./platforms";
import type { CaptionStyle, EditPlan, PlatformId, ProductCard, Timeline } from "./types";

export const CAPTION_FONT = "Pretendard ExtraBold";
export const BASE_FONT_SIZE = 70;
const MAX_LINES = 2;

/** 대략적인 글자 폭(em). 한글·한자는 넓고 영문·숫자·공백은 좁다 */
function charWidth(ch: string): number {
  if (/\s/.test(ch)) return 0.3;
  if (/[ᄀ-ᇿ㄰-㆏가-힣一-鿿]/.test(ch)) return 0.95;
  if (/[A-Z0-9]/.test(ch)) return 0.62;
  if (/[a-z]/.test(ch)) return 0.52;
  return 0.45;
}

export function textWidth(text: string, fontSize: number): number {
  return [...text].reduce((w, ch) => w + charWidth(ch), 0) * fontSize;
}

/** 단어 경계에서 줄을 나눈다. 한 단어가 한 줄보다 길면 글자 단위로 나눈다 */
export function wrapLines(text: string, maxWidth: number, fontSize: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, fontSize) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (textWidth(word, fontSize) <= maxWidth) {
      line = word;
    } else {
      let chunk = "";
      for (const ch of word) {
        if (textWidth(chunk + ch, fontSize) > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface CaptionChunk {
  sentenceId: string;
  start: number;
  end: number;
  lines: string[];
  emphasis?: string;
}

/**
 * 문장별 자막을 화면 단위로 나눈다. 두 줄을 넘으면 글자를 줄이지 않고 여러 화면으로 나누며,
 * 나눈 화면의 시각은 글자 수 비율로 정한다.
 */
export function captionChunks(plan: EditPlan, timeline: Timeline, platform: PlatformId): CaptionChunk[] {
  const p = PLATFORMS[platform];
  const fontSize = BASE_FONT_SIZE * plan.captionStyle.scale;
  const maxWidth = FRAME.width - p.marginLeft - p.marginRight;
  const chunks: CaptionChunk[] = [];
  for (const s of plan.sentences) {
    const t = timeline.sentences.find((x) => x.sentenceId === s.id);
    if (!t) continue;
    const text = (s.caption?.trim() || s.text).replace(/[.]$/, "");
    const lines = wrapLines(text, maxWidth, fontSize);
    const groups: string[][] = [];
    for (let i = 0; i < lines.length; i += MAX_LINES) groups.push(lines.slice(i, i + MAX_LINES));
    const weights = groups.map((g) => g.join("").length);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let cursor = t.start;
    groups.forEach((g, i) => {
      const len = ((t.end - t.start) * weights[i]) / total;
      chunks.push({ sentenceId: s.id, start: cursor, end: cursor + len, lines: g, emphasis: s.emphasis });
      cursor += len;
    });
  }
  // 자막이 끊기지 않도록 다음 자막 시작까지 유지(최대 0.4초)
  for (let i = 0; i < chunks.length - 1; i++) chunks[i].end = Math.min(chunks[i + 1].start, chunks[i].end + 0.4);
  return chunks;
}

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

/** #RRGGBB → ASS &HAABBGGRR */
export function assColor(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? m[1] : "ffffff";
  const [r, g, b] = [v.slice(0, 2), v.slice(2, 4), v.slice(4, 6)];
  return `&H${alpha.toString(16).padStart(2, "0")}${b}${g}${r}`.toUpperCase();
}

function escapeAss(text: string): string {
  return text.replace(/\\/g, "＼").replace(/[{}]/g, "").replace(/\r?\n/g, " ");
}

function withEmphasis(line: string, emphasis: string | undefined, style: CaptionStyle): string {
  const safe = escapeAss(line);
  if (!emphasis) return safe;
  const e = escapeAss(emphasis);
  const idx = safe.indexOf(e);
  if (idx < 0) return safe;
  return `${safe.slice(0, idx)}{\\c${assColor(style.highlight)}&}${e}{\\c${assColor(style.color)}&}${safe.slice(idx + e.length)}`;
}

export const AFFILIATE_LABEL = "광고 · 제휴 링크로 수수료를 받을 수 있어요";

export function buildAss(plan: EditPlan, timeline: Timeline, platform: PlatformId, product: ProductCard): string {
  const p = PLATFORMS[platform];
  const style = plan.captionStyle;
  const size = Math.round(BASE_FONT_SIZE * style.scale);
  const marginV = FRAME.height - p.captionBottomY;
  const outline = Math.max(4, Math.round(size * 0.09));
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${FRAME.width}`,
    `PlayResY: ${FRAME.height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Main,${CAPTION_FONT},${size},${assColor(style.color)},${assColor(style.color)},&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,${outline},2,2,${p.marginLeft},${p.marginRight},${marginV},1`,
    `Style: Label,Pretendard SemiBold,34,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,3,10,0,7,${p.marginLeft},${p.marginRight},${p.topSafeY},1`,
    `Style: EndTitle,${CAPTION_FONT},88,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,6,2,5,${p.marginLeft},${p.marginRight},0,1`,
    `Style: EndLine,Pretendard Bold,54,${assColor(style.highlight)},${assColor(style.highlight)},&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,5,2,5,${p.marginLeft},${p.marginRight},0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events: string[] = [];
  for (const c of captionChunks(plan, timeline, platform)) {
    const text = c.lines.map((l) => withEmphasis(l, c.emphasis, style)).join("\\N");
    events.push(`Dialogue: 1,${assTime(c.start)},${assTime(c.end)},Main,,0,0,0,,${text}`);
  }
  if (product.purpose === "affiliate") {
    events.push(`Dialogue: 2,${assTime(0)},${assTime(Math.min(3, timeline.speechEnd))},Label,,0,0,0,,${escapeAss(AFFILIATE_LABEL)}`);
    events.push(`Dialogue: 2,${assTime(timeline.endCard.start)},${assTime(timeline.endCard.end)},Label,,0,0,0,,${escapeAss(AFFILIATE_LABEL)}`);
  }
  // 마지막 안내: 플랫폼별 링크 위치 안내
  const cx = Math.round((p.marginLeft + FRAME.width - p.marginRight) / 2);
  const titleLines = wrapLines(product.name, FRAME.width - p.marginLeft - p.marginRight, 88).slice(0, 2);
  events.push(`Dialogue: 3,${assTime(timeline.endCard.start)},${assTime(timeline.endCard.end)},EndTitle,,0,0,0,,{\\pos(${cx},860)\\fad(150,0)}${titleLines.map(escapeAss).join("\\N")}`);
  events.push(`Dialogue: 3,${assTime(timeline.endCard.start)},${assTime(timeline.endCard.end)},EndLine,,0,0,0,,{\\pos(${cx},1060)\\fad(250,0)}${escapeAss(p.endCardLine(product))}`);
  return [...header, ...events, ""].join("\n");
}

export function buildSrt(plan: EditPlan, timeline: Timeline, platform: PlatformId): string {
  return captionChunks(plan, timeline, platform)
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.lines.join("\n")}\n`)
    .join("\n");
}

/**
 * 쇼핑 쇼츠 제작기의 데이터 구조.
 * 상품 사실(출처 포함) → 소재 구간 → 대본 문장 → 편집 계획(edit_plan.json) 순으로 서로를 식별자로 참조한다.
 */

export type PlatformId = "common" | "youtube_shorts" | "instagram_reels";

/** 상품 사실의 출처. 소재에 동작이 보인다는 것(observed)은 재질·인증·효과의 근거가 되지 않는다. */
export type FactSource = "user" | "description" | "observed";

export interface ProductFact {
  id: string;
  text: string;
  source: FactSource;
  /** 출처 메모(예: "상세페이지 2번째 이미지", "소재 b.mp4 3~6초") */
  sourceNote?: string;
  approved: boolean;
}

export interface ProductCard {
  id: string;
  name: string;
  /** own: 자사 상품 판매, affiliate: 제휴 상품 소개 */
  purpose: "own" | "affiliate";
  facts: ProductFact[];
  /** 구매 안내 문구(음성·자막에 공통 사용). 비우면 판매 목적에 맞는 기본 문구 */
  cta?: string;
  url?: string;
  /** 기준 사진 소재 id */
  referenceAssetId?: string;
  /** 사용자가 상품 정보를 확인한 시각 */
  confirmedAt: string;
}

export interface SourceAsset {
  id: string;
  fileName: string;
  /** 프로젝트 폴더 기준 상대 경로 */
  path: string;
  hash: string;
  kind: "video" | "image";
  width: number;
  height: number;
  duration: number;
  fps: number;
  hasAudio: boolean;
  /** 사용자 확인: 실제 판매 상품을 촬영한 소재인가. undefined = 아직 확인 안 함 */
  productConfirmed?: boolean;
  excluded?: boolean;
}

export type SegmentStatus = "usable" | "review" | "excluded";

export interface Segment {
  id: string;
  assetId: string;
  start: number;
  end: number;
  /** 보이는 제품 특징·동작 (AI 분석 시) */
  observed: string[];
  productMatch: "matches" | "suspected_different" | "unverified";
  matchNote?: string;
  quality: {
    orientation: "portrait" | "landscape" | "square";
    meanLuma?: number;
    blackRatio?: number;
    burnedCaption?: "none" | "top" | "middle" | "bottom" | "unknown";
  };
  status: SegmentStatus;
  statusReason?: string;
  analyzer: "local" | "gemini";
  thumbnail?: string;
}

export interface AssetAnalysis {
  assetId: string;
  hash: string;
  analyzerKey: string;
  segments: Segment[];
  createdAt: string;
}

export type SentenceRole = "hook" | "demo" | "benefit" | "cta";
export type VoiceBlockId = "hook" | "body" | "outro";

export interface Sentence {
  id: string;
  role: SentenceRole;
  /** 음성으로 읽을 문장 */
  text: string;
  /** 화면 자막(비우면 text) */
  caption?: string;
  /** 자막에서 강조할 핵심 표현(문장당 하나) */
  emphasis?: string;
  factIds: string[];
  segmentIds: string[];
  sceneReason: string;
  /** 1(필수) ~ 3(먼저 줄일 문장) */
  priority: 1 | 2 | 3;
  block: VoiceBlockId;
  /** 사용자가 고정한 문장·컷은 자동 수정에서 보존 */
  locked?: boolean;
}

export interface CaptionStyle {
  /** 1 = 기본, 1.2 = 크게 */
  scale: number;
  color: string;
  highlight: string;
}

export interface VoiceSettings {
  provider: "gemini" | "local";
  voice: string;
  /** 로컬 엔진 말하기 속도(분당 단어) */
  rate?: number;
}

export interface EditPlan {
  kind: "edit_plan";
  planSchema: 1;
  version: number;
  projectId: string;
  productId: string;
  approvedFactIds: string[];
  sourceHashes: Record<string, string>;
  generator: { provider: "rules" | "gemini"; model?: string; promptVersion: string };
  sentences: Sentence[];
  /** 첫 3초 바꾸기에서 이미 쓴 시작 문구 */
  hookHistory: string[];
  voice: VoiceSettings;
  captionStyle: CaptionStyle;
  design: { id: "basic-v1"; brandColor: string };
  output: { targetSeconds: number; endCardSeconds: number };
  createdAt: string;
}

export interface SentenceTiming {
  sentenceId: string;
  start: number;
  end: number;
  /** measured: 문장별 실측 길이, estimated: 블록 음성에서 글자 비율로 추정 */
  source: "measured" | "estimated";
}

export interface Cut {
  sentenceId: string;
  assetId: string;
  segmentId: string;
  srcStart: number;
  srcEnd: number;
  outStart: number;
  outEnd: number;
  /** 원본이 짧아 늘린 경우 */
  fill?: "none" | "slow" | "freeze";
}

export interface Timeline {
  planVersion: number;
  audioPath: string;
  audioDuration: number;
  speechEnd: number;
  totalDuration: number;
  sentences: SentenceTiming[];
  cuts: Cut[];
  endCard: { start: number; end: number; assetId?: string };
  warnings: string[];
}

export type ReviewKind = "asset_unconfirmed" | "product_mismatch" | "unsupported_claim" | "timing_estimated" | "short_scene";

export interface ReviewItem {
  id: string;
  kind: ReviewKind;
  /** true면 해결 전 게시용 완성본 저장 불가 */
  blocking: boolean;
  message: string;
  assetId?: string;
  sentenceId?: string;
}

export interface ChannelSettings {
  voice: VoiceSettings;
  brandColor: string;
  defaultCta?: string;
  targetSeconds: number;
  defaultPlatforms: PlatformId[];
  captionScale: number;
}

export type StepName = "analyze" | "plan" | "voice" | "timeline" | "preview" | "final";

export interface StepState {
  status: "pending" | "running" | "done" | "failed";
  inputKey?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface ProjectState {
  steps: Partial<Record<string, StepState>>;
  /** 현재 진행 중 작업 설명 */
  activity?: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  title: string;
  product: ProductCard;
  assets: SourceAsset[];
  settings: ChannelSettings;
  createdAt: string;
}

export interface VerifyReport {
  ok: boolean;
  file: string;
  checks: { name: string; ok: boolean; detail: string }[];
}

export interface CallLogEntry {
  ts: string;
  provider: string;
  model?: string;
  task: string;
  reused: boolean;
  ok: boolean;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  /** 공급자가 비용을 반환하지 않으면 undefined */
  billedCost?: number;
  error?: string;
}

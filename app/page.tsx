"use client";

import { useRef, useState } from "react";
import { CaptionResult } from "@/components/CaptionResult";
import { PhotoUpload } from "@/components/PhotoUpload";
import { PosterPreview } from "@/components/PosterPreview";
import { EMPTY_FORM, PostForm, type PostFormValues } from "@/components/PostForm";
import type { PosterData } from "@/components/PromoPoster";
import ui from "@/components/ui.module.css";
import type { CaptionResponse } from "@/lib/ai/types";
import { BRAND } from "@/lib/brand";
import type { LoadedImage } from "@/lib/image";
import styles from "./page.module.css";

interface Result {
  poster: PosterData;
  caption?: CaptionResponse;
  captionError?: string;
  id: number;
}

export default function FeedPostMakerPage() {
  const [before, setBefore] = useState<LoadedImage | null>(null);
  const [after, setAfter] = useState<LoadedImage | null>(null);
  const [form, setForm] = useState<PostFormValues>(EMPTY_FORM);
  const [showHeadline, setShowHeadline] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [generating, setGenerating] = useState(false);
  const resultRef = useRef<HTMLElement>(null);

  const missing = [!before && "원본 사진", !after && "완성 작품 사진", !form.topic.trim() && "홍보 주제"].filter(
    Boolean,
  ) as string[];
  const canSubmit = missing.length === 0 && !generating;

  async function requestCaption(values: PostFormValues): Promise<Pick<Result, "caption" | "captionError">> {
    try {
      const res = await fetch("/api/caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) return { captionError: data.error ?? "게시물 글 생성에 실패했어요." };
      return { caption: data as CaptionResponse };
    } catch {
      return { captionError: "서버에 연결하지 못했어요. 네트워크를 확인해주세요." };
    }
  }

  async function handleGenerate() {
    if (!before || !after || !form.topic.trim()) return;
    setGenerating(true);

    const poster: PosterData = {
      beforeUrl: before.dataUrl,
      afterUrl: after.dataUrl,
      headline: showHeadline ? form.topic.trim() : undefined,
      productType: form.productType.trim() || undefined,
    };
    const id = Date.now();
    // 이미지는 즉시 보여주고, 글은 도착하면 채운다.
    setResult({ poster, id });
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

    const caption = await requestCaption(form);
    setResult((prev) => (prev && prev.id === id ? { ...prev, ...caption } : prev));
    setGenerating(false);
  }

  async function handleRegenerateCaption() {
    if (!result) return;
    setGenerating(true);
    const id = result.id;
    setResult((prev) => (prev ? { ...prev, caption: undefined, captionError: undefined } : prev));
    const caption = await requestCaption(form);
    setResult((prev) => (prev && prev.id === id ? { ...prev, ...caption } : prev));
    setGenerating(false);
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.wordmark}>{BRAND.name}</span>
          <span className={styles.product}>Content Studio</span>
        </div>
        <span className={styles.badge}>인스타 피드 게시물</span>
      </header>

      <main className={styles.main}>
        <section className={`${ui.card} ${styles.inputCard}`} aria-labelledby="input-title">
          <h1 id="input-title" className={ui.cardTitle}>
            게시물 재료
          </h1>
          <p className={ui.cardDesc}>사진 두 장과 주제만 넣으면, 이미지와 글이 함께 만들어져요.</p>

          <div className={styles.uploads}>
            <PhotoUpload
              step="1"
              label="원본 사진"
              hint="고객이 보낸 사진"
              value={before}
              onChange={setBefore}
            />
            <PhotoUpload
              step="2"
              label="완성 작품 사진"
              hint="FRAME O 완성 작품"
              value={after}
              onChange={setAfter}
            />
          </div>

          <PostForm values={form} onChange={setForm} />

          <label className={ui.checkbox}>
            <input type="checkbox" checked={showHeadline} onChange={(e) => setShowHeadline(e.target.checked)} />
            이미지 상단에 홍보 주제 문구 넣기
          </label>

          <button type="button" className={ui.primaryButton} disabled={!canSubmit} onClick={handleGenerate}>
            {generating ? "만드는 중…" : "인스타 게시물 만들기"}
          </button>
          {missing.length > 0 && <p className={ui.hint}>{missing.join(", ")}을(를) 입력해주세요.</p>}
        </section>

        <section ref={resultRef} className={styles.resultCol} aria-live="polite">
          {!result ? (
            <div className={`${ui.card} ${styles.empty}`}>
              <div className={styles.emptyFrame} aria-hidden>
                <span>BEFORE</span>
                <span>AFTER</span>
              </div>
              <p>
                왼쪽에 사진과 주제를 입력하고
                <br />
                <strong>인스타 게시물 만들기</strong>를 눌러주세요.
              </p>
            </div>
          ) : (
            <>
              <div className={ui.card}>
                <h2 className={ui.cardTitle}>A. 인스타 홍보 이미지</h2>
                <p className={ui.cardDesc}>세로형 피드(4:5) · 1080×1350</p>
                <PosterPreview key={result.id} {...result.poster} />
              </div>

              <div className={ui.card}>
                <div className={styles.cardHeadRow}>
                  <div>
                    <h2 className={ui.cardTitle}>B. 인스타 게시물 글</h2>
                    <p className={ui.cardDesc}>
                      {result.caption
                        ? result.caption.provider === "mock"
                          ? "예시 템플릿으로 작성됨 (AI 키 미설정)"
                          : "AI가 작성했어요. 필요하면 직접 다듬어 주세요."
                        : "글을 쓰는 중…"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={ui.ghostButton}
                    onClick={handleRegenerateCaption}
                    disabled={generating}
                  >
                    다시 쓰기
                  </button>
                </div>

                {result.caption?.notice && <p className={ui.notice}>{result.caption.notice}</p>}
                {result.captionError && <p className={ui.error}>{result.captionError}</p>}
                {result.caption ? (
                  <CaptionResult key={`${result.id}-${JSON.stringify(result.caption.caption)}`} caption={result.caption.caption} />
                ) : (
                  !result.captionError && <div className={ui.skeleton} aria-label="게시물 글 생성 중" />
                )}
              </div>
            </>
          )}
        </section>
      </main>

      <footer className={styles.footer}>
        {BRAND.name} 내부용 · {BRAND.slogan}
      </footer>
    </div>
  );
}

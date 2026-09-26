import { forwardRef } from "react";
import { BRAND } from "@/lib/brand";
import styles from "./PromoPoster.module.css";

export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1350; // 4:5 인스타 세로 피드

export interface PosterData {
  beforeUrl: string;
  afterUrl: string;
  headline?: string;
  productType?: string;
}

/**
 * 1080×1350 고정 크기로 그리는 Before/After 홍보 이미지.
 * 화면에서는 PosterPreview 가 축소해서 보여주고, 저장 시 이 DOM 을 그대로 PNG 로 변환한다.
 */
export const PromoPoster = forwardRef<HTMLDivElement, PosterData>(function PromoPoster(
  { beforeUrl, afterUrl, headline, productType },
  ref,
) {
  return (
    <div ref={ref} className={styles.poster} style={{ width: POSTER_WIDTH, height: POSTER_HEIGHT }}>
      <header className={styles.header}>
        <div className={styles.wordmark}>{BRAND.name}</div>
        <div className={styles.rule} />
        {headline ? <p className={styles.headline}>{headline}</p> : <p className={styles.kicker}>PHOTO TO ART</p>}
      </header>

      <main className={styles.stage}>
        <figure className={styles.before}>
          <div className={styles.beforeMat}>
            {/* eslint-disable-next-line @next/next/no-img-element -- html-to-image 캡처를 위해 일반 img 사용 */}
            <img src={beforeUrl} alt="원본 사진" className={styles.photo} />
          </div>
          <figcaption className={styles.caption}>
            <span className={styles.captionEn}>BEFORE</span>
            <span className={styles.captionKo}>원본 사진</span>
          </figcaption>
        </figure>

        <div className={styles.arrow} aria-hidden>
          <svg width="44" height="16" viewBox="0 0 44 16" fill="none">
            <path d="M0 8h41M34 1l7 7-7 7" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </div>

        <figure className={styles.after}>
          <div className={styles.frame}>
            <div className={styles.mat}>
              {/* eslint-disable-next-line @next/next/no-img-element -- html-to-image 캡처를 위해 일반 img 사용 */}
              <img src={afterUrl} alt="완성 작품" className={styles.photo} />
            </div>
          </div>
          <figcaption className={styles.caption}>
            <span className={styles.captionEn}>AFTER</span>
            <span className={styles.captionKo}>{productType || "완성 작품"}</span>
          </figcaption>
        </figure>
      </main>

      <footer className={styles.footer}>
        <p className={styles.slogan}>{BRAND.slogan}</p>
        <p className={styles.domain}>{BRAND.domain}</p>
      </footer>
    </div>
  );
});

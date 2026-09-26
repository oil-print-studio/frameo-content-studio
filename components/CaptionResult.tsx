"use client";

import { useState } from "react";
import { composeBody, composeHashtags } from "@/lib/ai/format";
import type { Caption } from "@/lib/ai/types";
import { copyText } from "@/lib/clipboard";
import styles from "./ui.module.css";

interface Props {
  caption: Caption;
}

type CopyTarget = "body" | "hashtags" | "all";

/** 부모에서 key 로 caption 이 바뀔 때마다 새로 마운트해 편집 상태를 초기화한다. */
export function CaptionResult({ caption }: Props) {
  const [body, setBody] = useState(() => composeBody(caption));
  const [hashtags, setHashtags] = useState(() => composeHashtags(caption.hashtags));
  const [copied, setCopied] = useState<CopyTarget | null>(null);

  async function handleCopy(target: CopyTarget) {
    const text = target === "body" ? body : target === "hashtags" ? hashtags : `${body}\n\n${hashtags}`;
    if (await copyText(text)) {
      setCopied(target);
      window.setTimeout(() => setCopied((c) => (c === target ? null : c)), 1600);
    }
  }

  return (
    <div className={styles.caption}>
      <div className={styles.field}>
        <div className={styles.captionHead}>
          <label htmlFor="caption-body" className={styles.subLabel}>
            본문
          </label>
          <span className={styles.counter}>{body.length}자</span>
        </div>
        <textarea
          id="caption-body"
          className={`${styles.textarea} ${styles.captionText}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
        />
        <button type="button" className={styles.secondaryButton} onClick={() => handleCopy("body")}>
          {copied === "body" ? "✓ 복사됨" : "본문 복사"}
        </button>
      </div>

      <div className={styles.field}>
        <div className={styles.captionHead}>
          <label htmlFor="caption-tags" className={styles.subLabel}>
            해시태그
          </label>
          <span className={styles.counter}>{hashtags.split(/\s+/).filter(Boolean).length}개</span>
        </div>
        <textarea
          id="caption-tags"
          className={`${styles.textarea} ${styles.captionText}`}
          value={hashtags}
          onChange={(e) => setHashtags(e.target.value)}
          rows={3}
        />
        <div className={styles.buttonRow}>
          <button type="button" className={styles.secondaryButton} onClick={() => handleCopy("hashtags")}>
            {copied === "hashtags" ? "✓ 복사됨" : "해시태그 복사"}
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => handleCopy("all")}>
            {copied === "all" ? "✓ 복사됨" : "전체 복사"}
          </button>
        </div>
      </div>
    </div>
  );
}

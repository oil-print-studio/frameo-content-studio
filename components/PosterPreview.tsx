"use client";

import { useEffect, useRef, useState } from "react";
import { downloadNodeAsPng } from "@/lib/exportPng";
import { POSTER_HEIGHT, POSTER_WIDTH, PromoPoster, type PosterData } from "./PromoPoster";
import styles from "./ui.module.css";

export function PosterPreview(props: PosterData) {
  const frameRef = useRef<HTMLDivElement>(null);
  const posterRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / POSTER_WIDTH);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  async function handleDownload() {
    if (!posterRef.current) return;
    setSaving(true);
    setError(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      await downloadNodeAsPng(posterRef.current, `frameo-feed-${stamp}.png`);
    } catch (e) {
      console.error(e);
      setError("이미지 저장에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div ref={frameRef} className={styles.posterFrame} style={{ height: POSTER_HEIGHT * scale }}>
        <div className={styles.posterScaler} style={{ transform: `scale(${scale})` }}>
          <PromoPoster ref={posterRef} {...props} />
        </div>
      </div>
      <button type="button" className={styles.primaryButton} onClick={handleDownload} disabled={saving}>
        {saving ? "저장 중…" : "이미지 다운로드 (PNG 1080×1350)"}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

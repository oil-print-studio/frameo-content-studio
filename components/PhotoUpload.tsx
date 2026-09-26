"use client";

import { useId, useRef, useState } from "react";
import { loadImageFile, type LoadedImage } from "@/lib/image";
import styles from "./ui.module.css";

interface Props {
  step: string;
  label: string;
  hint: string;
  value: LoadedImage | null;
  onChange: (image: LoadedImage | null) => void;
}

export function PhotoUpload({ step, label, hint, value, onChange }: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      onChange(await loadImageFile(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "이미지를 불러오지 못했어요.");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className={styles.upload}>
      <div className={styles.fieldLabel}>
        <span className={styles.step}>{step}</span>
        <label htmlFor={inputId}>{label}</label>
      </div>

      <label
        htmlFor={inputId}
        className={`${styles.dropzone} ${value ? styles.dropzoneFilled : ""} ${dragOver ? styles.dropzoneOver : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- 로컬 dataURL 미리보기
          <img src={value.dataUrl} alt={`${label} 미리보기`} className={styles.previewImg} />
        ) : (
          <span className={styles.dropzoneText}>
            {loading ? "불러오는 중…" : "탭하여 사진 선택"}
            <small>{hint}</small>
          </span>
        )}
      </label>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        className={styles.visuallyHidden}
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      {value && (
        <div className={styles.uploadActions}>
          <span className={styles.fileName}>{value.name}</span>
          <button type="button" className={styles.linkButton} onClick={() => inputRef.current?.click()}>
            변경
          </button>
          <button type="button" className={styles.linkButton} onClick={() => onChange(null)}>
            삭제
          </button>
        </div>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

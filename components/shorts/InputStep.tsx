"use client";

import { useState } from "react";
import ui from "@/components/ui.module.css";
import styles from "@/app/shorts/page.module.css";
import type { FactSource } from "@/lib/shorts/types";

interface FactRow {
  text: string;
  source: FactSource;
}

interface FileRow {
  file: File;
  confirmed: boolean;
}

const SOURCE_LABEL: Record<FactSource, string> = {
  user: "직접 확인",
  description: "상품 설명",
  observed: "영상에 보임",
};

/** 1. 상품과 소재 넣기 */
export function InputStep({ busy, onCreated }: { busy: boolean; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState<"own" | "affiliate">("own");
  const [url, setUrl] = useState("");
  const [cta, setCta] = useState("");
  const [facts, setFacts] = useState<FactRow[]>([
    { text: "", source: "user" },
    { text: "", source: "user" },
    { text: "", source: "user" },
  ]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const missing = [!name.trim() && "상품명", !facts.some((f) => f.text.trim()) && "확인된 장점", !files.length && "영상·사진"].filter(Boolean) as string[];

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list).map((file) => ({ file, confirmed: false }))]);
  }

  async function submit() {
    setSubmitting(true);
    setError(undefined);
    const form = new FormData();
    form.set("product", JSON.stringify({ name, purpose, url, cta, facts: facts.filter((f) => f.text.trim()) }));
    form.set("confirmed", JSON.stringify(files.map((f) => f.confirmed)));
    for (const f of files) form.append("files", f.file);
    try {
      const res = await fetch("/api/shorts/projects", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "만들지 못했어요.");
      else onCreated(data.id);
    } catch {
      setError("서버에 연결하지 못했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={ui.card} aria-labelledby="step1">
      <h2 id="step1" className={ui.cardTitle}>
        1. 상품과 소재
      </h2>
      <p className={ui.cardDesc}>확인된 장점과 영상·사진을 넣으면 대본·음성·자막·장면이 연결된 초안 한 편이 나와요.</p>

      <div className={ui.formFields}>
        <label className={ui.field}>
          <span className={ui.fieldLabel}>
            상품명 <span className={ui.required}>필수</span>
          </span>
          <input className={ui.input} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="예: 휴대용 접이식 텀블러" />
        </label>

        <div className={ui.field}>
          <span className={ui.fieldLabel}>판매 방식</span>
          <div className={styles.segmented} role="radiogroup">
            {(["own", "affiliate"] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={purpose === p} className={purpose === p ? styles.segOn : styles.seg} onClick={() => setPurpose(p)}>
                {p === "own" ? "자사 상품 판매" : "제휴 상품 소개"}
              </button>
            ))}
          </div>
          {purpose === "affiliate" && <span className={ui.hint}>영상 시작·끝과 게시 문구에 광고·제휴 고지가 들어가요.</span>}
        </div>

        <div className={ui.field}>
          <span className={ui.fieldLabel}>
            확인된 장점 (최대 3개) <span className={ui.required}>필수</span>
          </span>
          <span className={ui.hint}>대본은 여기 적은 내용만 사용해요. 확인되지 않은 성능·가격·후기는 만들지 않아요.</span>
          {facts.map((f, i) => (
            <div key={i} className={styles.factRow}>
              <input
                className={ui.input}
                value={f.text}
                maxLength={80}
                placeholder={["예: 접으면 높이가 4cm로 줄어요", "예: 뚜껑을 돌려 잠그는 방식이에요", "예: 식기세척기 사용 가능"][i]}
                onChange={(e) => setFacts((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
              />
              <select
                className={styles.select}
                value={f.source}
                aria-label="출처"
                onChange={(e) => setFacts((prev) => prev.map((x, j) => (j === i ? { ...x, source: e.target.value as FactSource } : x)))}
              >
                {(Object.keys(SOURCE_LABEL) as FactSource[]).map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className={ui.field}>
          <span className={ui.fieldLabel}>
            영상·사진 <span className={ui.required}>필수</span>
          </span>
          <label className={styles.drop}>
            <input type="file" multiple accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp" className={ui.visuallyHidden} onChange={(e) => addFiles(e.target.files)} />
            <span>파일 선택 (mp4·mov·webm·jpg·png)</span>
          </label>
          {files.length > 0 && (
            <ul className={styles.fileList}>
              {files.map((f, i) => (
                <li key={`${f.file.name}-${i}`}>
                  <span className={styles.fileName}>{f.file.name}</span>
                  <label className={ui.checkbox}>
                    <input type="checkbox" checked={f.confirmed} onChange={(e) => setFiles((prev) => prev.map((x, j) => (j === i ? { ...x, confirmed: e.target.checked } : x)))} />
                    판매 상품 촬영본 맞음
                  </label>
                  <button type="button" className={ui.linkButton} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                    빼기
                  </button>
                </li>
              ))}
            </ul>
          )}
          <span className={ui.hint}>‘소재 찾기’(외부 탐색·가져오기)는 다음 단계에서 붙여요. 지금은 가진 파일로 만들어요.</span>
        </div>

        <details className={styles.more}>
          <summary>구매 링크·안내 문구 (선택)</summary>
          <label className={ui.field}>
            <span className={ui.subLabel}>구매 링크</span>
            <input className={ui.input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" inputMode="url" />
          </label>
          <label className={ui.field}>
            <span className={ui.subLabel}>구매 안내 문구 (음성·자막 공통)</span>
            <input className={ui.input} value={cta} maxLength={80} onChange={(e) => setCta(e.target.value)} placeholder="비우면 판매 방식에 맞는 기본 문구" />
          </label>
        </details>
      </div>

      {error && <p className={ui.error}>{error}</p>}
      <button type="button" className={ui.primaryButton} disabled={missing.length > 0 || submitting || busy} onClick={submit}>
        {submitting ? "올리는 중…" : "초안 만들기"}
      </button>
      {missing.length > 0 && <p className={ui.hint}>{missing.join(", ")}을(를) 넣어 주세요.</p>}
    </section>
  );
}

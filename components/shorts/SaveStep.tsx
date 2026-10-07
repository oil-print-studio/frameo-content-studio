"use client";

import { useState } from "react";
import ui from "@/components/ui.module.css";
import styles from "@/app/shorts/page.module.css";
import { copyText } from "@/lib/clipboard";
import { PLATFORM_IDS, PLATFORMS } from "@/lib/shorts/platforms";
import type { PlatformId } from "@/lib/shorts/types";
import { fileUrl, postJson, type ExportJobResult, type ProjectViewData } from "./api";

/** 3. 저장: 플랫폼별 최종 MP4 + 자막 + 표지 + 게시 문구 */
export function SaveStep({ view, onChanged }: { view: ProjectViewData; onChanged: () => void }) {
  const [platforms, setPlatforms] = useState<PlatformId[]>(view.project.settings.defaultPlatforms);
  const [error, setError] = useState<string>();
  const [posts, setPosts] = useState<Record<string, string>>({});
  const blocking = view.review.filter((r) => r.blocking);
  const result = view.job?.name === "export" && view.job.status === "done" ? (view.job.result as ExportJobResult) : undefined;
  const failed = view.job?.name === "export" && view.job.status === "failed" ? view.job.error : undefined;
  const id = view.project.id;

  async function save() {
    setError(undefined);
    const r = await postJson(`/api/shorts/projects/${id}/export`, { platforms });
    if (!r.ok) setError(r.error);
    onChanged();
  }

  async function loadPost(rel: string) {
    if (posts[rel]) return;
    const text = await fetch(fileUrl(id, rel)).then((r) => r.text());
    setPosts((p) => ({ ...p, [rel]: text }));
  }

  return (
    <section className={ui.card} aria-labelledby="step3">
      <h2 id="step3" className={ui.cardTitle}>
        3. 저장
      </h2>
      <p className={ui.cardDesc}>본편은 하나로 만들고 플랫폼별로 자막 위치·표지·마지막 안내·게시 문구만 바꿔요.</p>

      <div className={styles.platforms}>
        {PLATFORM_IDS.map((p) => (
          <label key={p} className={ui.checkbox}>
            <input type="checkbox" checked={platforms.includes(p)} onChange={(e) => setPlatforms((prev) => (e.target.checked ? [...prev, p] : prev.filter((x) => x !== p)))} />
            {PLATFORMS[p].label}
          </label>
        ))}
      </div>

      {blocking.length > 0 && <p className={ui.notice}>‘확인할 것’의 필수 항목 {blocking.length}개를 해결하면 저장할 수 있어요.</p>}
      {error && <p className={ui.error}>{error}</p>}
      <button type="button" className={ui.primaryButton} disabled={view.running || !platforms.length || blocking.length > 0 || !view.plan} onClick={save}>
        {view.running && view.job?.name === "export" ? (view.state.activity ?? "저장 중…") : "최종 영상 저장"}
      </button>

      {failed && <pre className={styles.errorBox}>{failed}</pre>}
      {result?.blocked && <p className={ui.error}>저장 전 확인할 항목이 남아 있어요: {result.blocked.map((b) => b.message).join(" / ")}</p>}
      {result && !result.blocked && (
        <div className={styles.outputs}>
          {result.outputs.map((o) => {
            const pkg = o.packageDir;
            const postRel = `${pkg}/post.txt`;
            return (
              <article key={o.platform} className={styles.output}>
                {/* eslint-disable-next-line @next/next/no-img-element -- 로컬 생성 파일 미리보기 */}
                <img src={fileUrl(id, o.coverRel)} alt={`${PLATFORMS[o.platform].label} 표지`} className={styles.cover} />
                <div className={styles.outputBody}>
                  <h3 className={styles.h3}>
                    {PLATFORMS[o.platform].label} <span className={o.verify.ok ? styles.ok : styles.fail}>{o.verify.ok ? "검사 통과" : "검사 실패"}</span>
                  </h3>
                  <div className={styles.downloads}>
                    <a className={ui.ghostButton} href={fileUrl(id, o.videoRel, { download: true })}>
                      MP4
                    </a>
                    <a className={ui.ghostButton} href={fileUrl(id, o.srtRel, { download: true })}>
                      SRT 자막
                    </a>
                    <a className={ui.ghostButton} href={fileUrl(id, o.coverRel, { download: true })}>
                      표지
                    </a>
                    {o.coverGridRel && (
                      <a className={ui.ghostButton} href={fileUrl(id, o.coverGridRel, { download: true })}>
                        격자용 표지(4:5)
                      </a>
                    )}
                    <button type="button" className={ui.ghostButton} onClick={() => loadPost(postRel)}>
                      게시 문구
                    </button>
                  </div>
                  {posts[postRel] && (
                    <div className={styles.postBox}>
                      <pre>{posts[postRel]}</pre>
                      <button type="button" className={ui.linkButton} onClick={() => copyText(posts[postRel])}>
                        복사
                      </button>
                    </div>
                  )}
                  <details className={styles.more}>
                    <summary>출력 검사 {o.verify.checks.filter((c) => c.ok).length}/{o.verify.checks.length}</summary>
                    <ul className={styles.checks}>
                      {o.verify.checks.map((c) => (
                        <li key={c.name} className={c.ok ? styles.ok : styles.fail}>
                          {c.ok ? "✓" : "✗"} {c.name} — {c.detail}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              </article>
            );
          })}
          <p className={ui.hint}>저장 폴더: data/shorts/projects/{id}/{result.folder} (승인한 사실·편집 계획·실행 기록 포함). 게시는 직접 올려 주세요 — 자동 게시는 하지 않아요.</p>
        </div>
      )}
    </section>
  );
}

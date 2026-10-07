"use client";

import { useState } from "react";
import ui from "@/components/ui.module.css";
import styles from "@/app/shorts/page.module.css";
import type { Segment, Sentence } from "@/lib/shorts/types";
import { fileUrl, postJson, type ProjectViewData } from "./api";

const ROLE_LABEL: Record<Sentence["role"], string> = { hook: "시작", demo: "사용 장면", benefit: "장점", cta: "구매 안내" };

/** 2. 초안 확인·필요한 부분 수정 */
export function DraftStep({ view, onChanged }: { view: ProjectViewData; onChanged: () => void }) {
  const { project, plan, timeline, preview, review, segments } = view;
  const busy = view.running;
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const [draftText, setDraftText] = useState("");
  const [swapFor, setSwapFor] = useState<string>();

  async function edit(body: unknown) {
    setError(undefined);
    const r = await postJson(`/api/shorts/projects/${project.id}/edit`, body);
    if (!r.ok) setError(r.error);
    onChanged();
  }

  const lastEdit = view.job?.name.startsWith("edit:") && view.job.status === "done" ? (view.job.result as { redo: string[]; renderedCuts: number; reusedCuts: number }) : undefined;

  if (!plan || !timeline || !preview) {
    return (
      <section className={ui.card}>
        <h2 className={ui.cardTitle}>2. 초안 확인</h2>
        <p className={ui.cardDesc}>{view.state.activity ?? (view.job?.status === "failed" ? "초안 만들기가 멈췄어요." : "준비 중…")}</p>
        {view.job?.status === "failed" && (
          <>
            <pre className={styles.errorBox}>{view.job.error}</pre>
            <button type="button" className={ui.ghostButton} onClick={async () => (await postJson(`/api/shorts/projects/${project.id}/draft`, {}), onChanged())}>
              멈춘 단계부터 다시 하기
            </button>
          </>
        )}
        {busy && <div className={ui.skeleton} aria-label="초안 생성 중" />}
      </section>
    );
  }

  const timingOf = (id: string) => timeline.sentences.find((t) => t.sentenceId === id);
  const usedIds = new Set(timeline.cuts.map((c) => c.segmentId));
  const candidates = (s: Sentence): Segment[] =>
    segments
      .filter((g) => g.status !== "excluded" && !s.segmentIds.includes(g.id))
      .sort((a, b) => Number(usedIds.has(a.id)) - Number(usedIds.has(b.id)) || Number(a.status !== "usable") - Number(b.status !== "usable"))
      .slice(0, 3);
  const assetName = (id?: string) => project.assets.find((a) => a.id === id)?.fileName ?? "";

  return (
    <section className={ui.card} aria-labelledby="step2">
      <div className={styles.headRow}>
        <div>
          <h2 id="step2" className={ui.cardTitle}>
            2. 초안 확인
          </h2>
          <p className={ui.cardDesc}>
            편집 계획 v{plan.version} · {timeline.totalDuration.toFixed(1)}초 · {plan.generator.provider === "gemini" ? `AI 대본(${plan.generator.model})` : "규칙 기반 대본(AI 미사용)"} · {view.voiceLabel}
          </p>
        </div>
        {busy && <span className={styles.badgeBusy}>{view.state.activity ?? "작업 중"}</span>}
      </div>

      {preview.notices?.map((n) => (
        <p key={n} className={ui.notice}>
          {n}
        </p>
      ))}

      <div className={styles.draftGrid}>
        <div className={styles.phone}>
          <video key={`${preview.videoRel}-${plan.version}`} src={fileUrl(project.id, preview.videoRel, { v: plan.version })} controls playsInline className={styles.video} />
          <p className={ui.hint}>미리보기(540×960). 최종 저장은 같은 계획으로 1080×1920 렌더해요.</p>
        </div>

        <div className={styles.side}>
          {review.length > 0 && (
            <div className={styles.review}>
              <h3 className={styles.h3}>확인할 것 {review.filter((r) => r.blocking).length > 0 && <span className={styles.must}>저장 전 필수</span>}</h3>
              <ul>
                {review.map((r) => (
                  <li key={r.id} className={r.blocking ? styles.reviewMust : styles.reviewSoft}>
                    <span>{r.message}</span>
                    {r.assetId && (
                      <span className={styles.inlineActions}>
                        <button type="button" className={ui.ghostButton} disabled={busy} onClick={() => edit({ op: "confirmAsset", assetId: r.assetId, confirmed: true })}>
                          판매 상품 맞음
                        </button>
                        <button type="button" className={ui.ghostButton} disabled={busy} onClick={() => edit({ op: "excludeAsset", assetId: r.assetId })}>
                          이 소재 빼기
                        </button>
                      </span>
                    )}
                    {r.sentenceId && r.kind === "unsupported_claim" && (
                      <button type="button" className={ui.linkButton} onClick={() => (setEditing(r.sentenceId), setDraftText(plan.sentences.find((s) => s.id === r.sentenceId)?.text ?? ""))}>
                        문장 고치기
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.quick}>
            <button type="button" className={ui.ghostButton} disabled={busy} onClick={() => edit({ op: "shorter" })}>
              더 짧게
            </button>
            <button type="button" className={ui.ghostButton} disabled={busy} onClick={() => edit({ op: "captionScale", scale: plan.captionStyle.scale >= 1.15 ? 1 : 1.2 })}>
              {plan.captionStyle.scale >= 1.15 ? "자막 기본 크기" : "자막 크게"}
            </button>
            <button type="button" className={ui.ghostButton} disabled={busy} onClick={() => edit({ op: "newHook" })}>
              첫 3초 바꾸기
            </button>
          </div>
          {lastEdit && (
            <p className={ui.hint}>
              최근 수정에서 다시 한 작업: {lastEdit.redo.join(", ")} · 컷 새로 {lastEdit.renderedCuts}개 / 재사용 {lastEdit.reusedCuts}개
            </p>
          )}
          {error && <p className={ui.error}>{error}</p>}

          <ol className={styles.sentences}>
            {plan.sentences.map((s) => {
              const t = timingOf(s.id);
              const cut = timeline.cuts.find((c) => c.sentenceId === s.id);
              const seg = segments.find((g) => g.id === cut?.segmentId);
              return (
                <li key={s.id} className={styles.sentence}>
                  {seg?.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element -- 로컬 생성 파일 미리보기
                    <img src={fileUrl(project.id, seg.thumbnail)} alt="" className={styles.thumb} />
                  )}
                  <div className={styles.sentenceBody}>
                    <div className={styles.meta}>
                      <span className={styles.role}>{ROLE_LABEL[s.role]}</span>
                      {t && (
                        <span>
                          {t.start.toFixed(1)}–{t.end.toFixed(1)}초{t.source === "estimated" && " · 추정"}
                        </span>
                      )}
                      {s.factIds.length > 0 && <span>근거: {s.factIds.map((id) => project.product.facts.find((f) => f.id === id)?.text.slice(0, 14)).join(", ")}</span>}
                      {s.locked && <span>고정</span>}
                    </div>
                    {editing === s.id ? (
                      <div className={styles.editRow}>
                        <input className={ui.input} value={draftText} maxLength={120} onChange={(e) => setDraftText(e.target.value)} />
                        <button type="button" className={ui.ghostButton} disabled={busy || !draftText.trim()} onClick={() => (edit({ op: "editSentence", sentenceId: s.id, text: draftText }), setEditing(undefined))}>
                          적용
                        </button>
                        <button type="button" className={ui.linkButton} onClick={() => setEditing(undefined)}>
                          취소
                        </button>
                      </div>
                    ) : (
                      <p className={styles.sentenceText}>{s.text}</p>
                    )}
                    <p className={styles.reason}>
                      장면: {assetName(cut?.assetId)} {cut && cut.srcEnd > cut.srcStart ? `${cut.srcStart.toFixed(1)}–${cut.srcEnd.toFixed(1)}초` : ""} · {s.sceneReason}
                    </p>
                    <div className={styles.inlineActions}>
                      <button type="button" className={ui.linkButton} disabled={busy} onClick={() => (setEditing(s.id), setDraftText(s.text))}>
                        문장 수정
                      </button>
                      <button type="button" className={ui.linkButton} disabled={busy} onClick={() => setSwapFor(swapFor === s.id ? undefined : s.id)}>
                        장면 바꾸기
                      </button>
                    </div>
                    {swapFor === s.id && (
                      <div className={styles.candidates}>
                        {candidates(s).map((g) => (
                          <button key={g.id} type="button" className={styles.candidate} disabled={busy} onClick={() => (edit({ op: "swapScene", sentenceId: s.id, segmentId: g.id }), setSwapFor(undefined))}>
                            {g.thumbnail && (
                              // eslint-disable-next-line @next/next/no-img-element -- 로컬 생성 파일 미리보기
                              <img src={fileUrl(project.id, g.thumbnail)} alt="" />
                            )}
                            <span>
                              {assetName(g.assetId)}
                              {g.end > g.start ? ` ${g.start.toFixed(1)}–${g.end.toFixed(1)}초` : " (사진)"}
                              {g.status === "review" ? " · 확인 필요" : ""}
                            </span>
                          </button>
                        ))}
                        {candidates(s).length === 0 && <span className={ui.hint}>바꿀 수 있는 다른 장면이 없어요.</span>}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <p className={ui.hint}>
            처리 기록: 새 작업 {view.usage.fresh}건 · 재사용 {view.usage.reused}건 · AI 호출 {view.usage.ai}건
          </p>
        </div>
      </div>
    </section>
  );
}

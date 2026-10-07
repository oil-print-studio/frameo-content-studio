"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { DraftStep } from "@/components/shorts/DraftStep";
import { InputStep } from "@/components/shorts/InputStep";
import { SaveStep } from "@/components/shorts/SaveStep";
import { SettingsPanel } from "@/components/shorts/SettingsPanel";
import type { Capabilities, ProjectViewData } from "@/components/shorts/api";
import { BRAND } from "@/lib/brand";
import styles from "./page.module.css";
import base from "../page.module.css";

/** 쇼핑 쇼츠 만들기: 상품·소재 넣기 → 초안 확인·수정 → 저장 */
export default function ShortsMakerPage() {
  return (
    <Suspense>
      <ShortsMaker />
    </Suspense>
  );
}

function ShortsMaker() {
  // 진행 중인 프로젝트는 주소(?p=)에 남겨 새로고침·재실행 후에도 이어서 본다
  const projectId = useSearchParams().get("p") ?? undefined;
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useState<ProjectViewData>();
  const [caps, setCaps] = useState<Capabilities>();

  useEffect(() => {
    fetch("/api/shorts/settings")
      .then((r) => r.json())
      .then((d) => setCaps(d.capabilities))
      .catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const res = await fetch(`/api/shorts/projects/${projectId}`);
    if (res.ok) setView(await res.json());
  }, [projectId]);

  // 작업 중에는 상태를 주기적으로 확인
  useEffect(() => {
    if (!projectId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const res = await fetch(`/api/shorts/projects/${projectId}`).catch(() => undefined);
      if (stop) return;
      let running = true;
      if (res?.ok) {
        const data = (await res.json()) as ProjectViewData;
        setView(data);
        running = data.running;
      }
      timer = setTimeout(tick, running ? 1200 : 6000);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [projectId]);

  function onCreated(id: string) {
    router.replace(`${pathname}?p=${id}`);
  }

  function startOver() {
    setView(undefined);
    router.replace(pathname);
  }

  return (
    <div className={base.shell}>
      <header className={base.topbar}>
        <div className={base.brand}>
          <span className={base.wordmark}>{BRAND.name}</span>
          <span className={base.product}>Content Studio</span>
        </div>
        <nav className={styles.nav}>
          <Link href="/">피드 게시물</Link>
          <span className={base.badge}>쇼핑 쇼츠·릴스</span>
        </nav>
      </header>

      <main className={styles.main}>
        {caps && (
          <p className={caps.gemini ? styles.engineOk : styles.engineLocal}>
            {caps.gemini ? "AI 연결됨" : "AI 키 없음 — 로컬 모드"} · 분석: {caps.analysis} · 대본: {caps.script} · 음성: {caps.voice}
          </p>
        )}

        {!projectId ? (
          <>
            <InputStep busy={false} onCreated={onCreated} />
            <SettingsPanel />
          </>
        ) : view?.project.id === projectId ? (
          <>
            <div className={styles.projectBar}>
              <strong>{view.project.product.name}</strong>
              <span>
                소재 {view.project.assets.length}개 · {view.project.product.purpose === "own" ? "자사 상품" : "제휴 상품"}
              </span>
              <button type="button" className={styles.textButton} onClick={startOver}>
                새 영상 만들기
              </button>
            </div>
            <DraftStep view={view} onChanged={refresh} />
            {view.plan && <SaveStep view={view} onChanged={refresh} />}
          </>
        ) : (
          <p className={styles.loading}>불러오는 중…</p>
        )}
      </main>

      <footer className={base.footer}>{BRAND.name} 내부용 · 쇼핑 쇼츠 제작기 (단계 A)</footer>
    </div>
  );
}

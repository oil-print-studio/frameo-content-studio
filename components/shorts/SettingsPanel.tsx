"use client";

import { useEffect, useState } from "react";
import ui from "@/components/ui.module.css";
import styles from "@/app/shorts/page.module.css";
import { PLATFORM_IDS, PLATFORMS } from "@/lib/shorts/platforms";
import type { ChannelSettings, PlatformId } from "@/lib/shorts/types";

/** 처음 한 번 저장하는 채널 기본값 (접힌 고급 설정) */
export function SettingsPanel() {
  const [s, setS] = useState<ChannelSettings>();
  const [msg, setMsg] = useState<string>();

  useEffect(() => {
    fetch("/api/shorts/settings")
      .then((r) => r.json())
      .then((d) => setS(d.settings))
      .catch(() => undefined);
  }, []);

  if (!s) return null;

  async function save() {
    const res = await fetch("/api/shorts/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
    const d = await res.json().catch(() => ({}));
    setMsg(res.ok ? "저장했어요. 다음 영상부터 이 값으로 만들어요." : (d.error ?? "저장하지 못했어요."));
  }

  return (
    <details className={`${ui.card} ${styles.settings}`}>
      <summary className={styles.settingsSummary}>채널 기본값 (고급 설정)</summary>
      <div className={ui.formFields}>
        <label className={ui.field}>
          <span className={ui.subLabel}>목소리</span>
          <select className={styles.select} value={s.voice.provider} onChange={(e) => setS({ ...s, voice: { ...s.voice, provider: e.target.value as "gemini" | "local", voice: e.target.value === "gemini" ? "Kore" : "ko" } })}>
            <option value="gemini">Gemini TTS (API 키 필요)</option>
            <option value="local">로컬 테스트 음성 (espeak-ng)</option>
          </select>
        </label>
        {s.voice.provider === "gemini" && (
          <label className={ui.field}>
            <span className={ui.subLabel}>Gemini 목소리 이름</span>
            <input className={ui.input} value={s.voice.voice} onChange={(e) => setS({ ...s, voice: { ...s.voice, voice: e.target.value } })} />
          </label>
        )}
        <label className={ui.field}>
          <span className={ui.subLabel}>기본 구매 안내 문구</span>
          <input className={ui.input} value={s.defaultCta ?? ""} maxLength={80} placeholder="비우면 판매 방식에 맞는 기본 문구" onChange={(e) => setS({ ...s, defaultCta: e.target.value })} />
        </label>
        <div className={styles.inlineFields}>
          <label className={ui.field}>
            <span className={ui.subLabel}>목표 길이(초)</span>
            <input className={ui.input} type="number" min={10} max={60} value={s.targetSeconds} onChange={(e) => setS({ ...s, targetSeconds: Number(e.target.value) })} />
          </label>
          <label className={ui.field}>
            <span className={ui.subLabel}>브랜드 색</span>
            <input className={styles.color} type="color" value={s.brandColor} onChange={(e) => setS({ ...s, brandColor: e.target.value })} />
          </label>
        </div>
        <div className={ui.field}>
          <span className={ui.subLabel}>기본 출력 (첫 번째가 미리보기 기준)</span>
          <div className={styles.platforms}>
            {PLATFORM_IDS.map((p) => (
              <label key={p} className={ui.checkbox}>
                <input
                  type="checkbox"
                  checked={s.defaultPlatforms.includes(p)}
                  onChange={(e) => setS({ ...s, defaultPlatforms: e.target.checked ? [...s.defaultPlatforms, p] : s.defaultPlatforms.filter((x: PlatformId) => x !== p) })}
                />
                {PLATFORMS[p].label}
              </label>
            ))}
          </div>
        </div>
        <p className={ui.hint}>Gemini API 키는 화면이 아니라 .env.local 의 GEMINI_API_KEY 로 등록해요(브라우저·로그·내보내기에 포함되지 않음).</p>
        <button type="button" className={ui.ghostButton} onClick={save}>
          기본값 저장
        </button>
        {msg && <p className={ui.hint}>{msg}</p>}
      </div>
    </details>
  );
}

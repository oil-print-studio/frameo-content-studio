/** 한국어 조사 선택: 마지막 글자의 받침 유무로 결정 (한글이 아니면 숫자·영문 읽기를 대략 반영) */
function hasFinalConsonant(word: string): boolean {
  const trimmed = word.trim().replace(/[\s.,!?)\]"'”’]+$/, "");
  const last = trimmed.at(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(last)) return "013678".includes(last);
  if (/[a-z]/i.test(last)) return "lmnr".includes(last.toLowerCase());
  return false;
}

type Pair = "은/는" | "이/가" | "을/를" | "과/와" | "이에요/예요" | "으로/로";

export function josa(word: string, pair: Pair): string {
  const [withBatchim, without] = pair.split("/");
  if (pair === "으로/로") {
    const last = word.trim().at(-1) ?? "";
    const code = last.charCodeAt(0);
    // ㄹ 받침은 '로'
    if (code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8) return word + without;
  }
  return word + (hasFinalConsonant(word) ? withBatchim : without);
}

/** 문장 끝 마침표 보정 */
export function asSentence(text: string): string {
  const t = text.trim();
  return /[.!?…~]$/.test(t) ? t : `${t}.`;
}

/** 숫자 토큰(단위 포함) 추출: "3분", "1.5L", "20%" */
export function numberTokens(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(",", ""));
}

import { toPng } from "html-to-image";

/** 화면에 그려진 포스터 DOM 을 실제 크기(1080×1350) PNG 로 저장 */
export async function downloadNodeAsPng(node: HTMLElement, fileName: string): Promise<void> {
  if (document.fonts?.ready) await document.fonts.ready;

  const options = {
    pixelRatio: 1,
    cacheBust: true,
    width: node.offsetWidth,
    height: node.offsetHeight,
    // 미리보기용 축소(transform)를 무시하고 원본 크기로 렌더링
    style: { transform: "none", transformOrigin: "top left", margin: "0" },
  };

  // Safari 는 첫 호출에서 이미지가 빠지는 경우가 있어 한 번 예열한다.
  await toPng(node, options).catch(() => undefined);
  const dataUrl = await toPng(node, options);

  const link = document.createElement("a");
  link.download = fileName;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

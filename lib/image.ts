export interface LoadedImage {
  dataUrl: string;
  width: number;
  height: number;
  name: string;
}

const MAX_EDGE = 2000;

/**
 * 업로드된 사진을 브라우저에서 읽어 긴 변 기준 MAX_EDGE 로 줄인 JPEG dataURL 로 만든다.
 * - 휴대폰 원본(10MB+)도 미리보기·PNG 합성이 가볍게 동작
 * - createImageBitmap 이 EXIF 회전을 반영
 */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("이미지 파일만 업로드할 수 있어요.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("이 이미지 형식은 열 수 없어요. JPG 또는 PNG로 올려주세요.");
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 처리할 수 없어요.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return { dataUrl: canvas.toDataURL("image/jpeg", 0.92), width, height, name: file.name };
}

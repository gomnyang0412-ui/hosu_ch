// 업로드한 이미지를 브라우저 canvas로 축소해 저장 용량을 줄이는 유틸

const MAX_EDGE = 320;

/** 파일을 받아 긴 변이 MAX_EDGE를 넘지 않도록 축소한 뒤 base64 dataURL로 반환한다 */
export function resizeImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지를 읽을 수 없어요."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("이미지 형식을 처리할 수 없어요."));
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("이미지를 축소할 수 없어요."));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

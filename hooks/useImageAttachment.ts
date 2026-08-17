import { useState, type ChangeEvent } from "react";
import { resizeImageFile } from "@/lib/image";

/**
 * 사진 첨부 처리(선택 → 리사이즈 → 전송 대기 상태로 들고 있기). 1:1
 * 채팅과 멀티 대화방이 완전히 동일한 로직을 각자 그대로 갖고 있던 걸
 * 하나로 모은 것 — 동작은 그대로다.
 */
export function useImageAttachment(onError: (message: string) => void) {
  const [pendingImage, setPendingImage] = useState<string | undefined>(undefined);
  const [pendingImageLoading, setPendingImageLoading] = useState(false);

  async function handleAttachImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPendingImageLoading(true);
    try {
      // 중간 화질로 — 원본 그대로 저장하면 방마다 용량이 금방 불어난다
      const dataUrl = await resizeImageFile(file, 768, 0.7);
      setPendingImage(dataUrl);
    } catch (err) {
      onError(err instanceof Error ? err.message : "이미지 처리에 실패했어요.");
    } finally {
      setPendingImageLoading(false);
    }
  }

  function clearPendingImage() {
    setPendingImage(undefined);
  }

  return { pendingImage, pendingImageLoading, handleAttachImage, clearPendingImage };
}

import {
  ChatBubbleIcon,
  PersonIcon,
  SparkleIcon,
  TheaterMasksIcon,
} from "@/components/icons";

/** Sidebar와 BottomNav가 공유하는 하단 탭 4개. 렌더링(레이아웃, 활성
 *  스타일)은 두 컴포넌트가 서로 달라서 그대로 각자 갖고, 데이터만
 *  여기 하나로 모은다. */
export const TABS = [
  { href: "/", label: "캐릭터", Icon: PersonIcon },
  { href: "/chats", label: "채팅", Icon: ChatBubbleIcon },
  { href: "/au", label: "AU", Icon: SparkleIcon },
  { href: "/observe", label: "관찰", Icon: TheaterMasksIcon },
] as const;

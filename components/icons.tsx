// 이모지 대신 쓰는 얇은 선 아이콘 세트. 폰트·OS마다 다르게 보이는 이모지 대신
// 앱 색(currentColor)에 맞춰 통일된 톤으로 그려진다. 크기는 1em이라 감싸는
// 요소의 text-* 클래스로 그대로 조절된다(예전 이모지 문자와 같은 방식).
import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill">;

function base(props: IconProps) {
  const { className, ...rest } = props;
  return {
    viewBox: "0 0 20 20",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: `inline-block h-[1em] w-[1em] align-[-0.125em] ${className ?? ""}`,
    "aria-hidden": true,
    ...rest,
  };
}

export function WarningIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 3.4 17.3 16.3H2.7Z" strokeLinejoin="round" />
      <path d="M10 8.2v4" />
      <circle cx="10" cy="14.3" r="0.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 16.5 5 13 13.6 4.4a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L7.9 15l-3.6 1Z" />
      <path d="M11.6 5.9l2.5 2.5" />
    </svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 2.5c.45 3 1.9 4.5 4.9 4.9-3 .45-4.45 1.9-4.9 4.9-.45-3-1.9-4.45-4.9-4.9 3-.4 4.45-1.9 4.9-4.9Z" strokeLinejoin="round" />
      <path d="M16 12.3c.15 1 .8 1.65 1.8 1.8-1 .15-1.65.8-1.8 1.8-.15-1-.8-1.65-1.8-1.8 1-.15 1.65-.8 1.8-1.8Z" strokeLinejoin="round" />
    </svg>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="7.2" />
      <path d="M2.8 10h14.4" />
      <path d="M10 2.8c2.6 2 2.6 12.4 0 14.4c-2.6-2-2.6-12.4 0-14.4Z" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7.5 5l5 5-5 5" />
    </svg>
  );
}

export function BackArrowIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M16 10H4" />
      <path d="M9 5l-5 5 5 5" />
    </svg>
  );
}

export function StarIcon(props: IconProps & { filled?: boolean }) {
  const { filled, ...rest } = props;
  return (
    <svg {...base(rest)} fill={filled ? "currentColor" : "none"}>
      <path d="M10 3.3l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
    </svg>
  );
}

export function ClapperIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 8.4l1.1-3.7a1 1 0 0 1 1-.7h9.8a1 1 0 0 1 1 .7l1.1 3.7" />
      <path d="M6.3 4.3 5.2 7.9M10.2 4l-1 3.9M14 4.3l-1 3.6" />
      <rect x="3" y="8.4" width="14" height="7.3" rx="1.2" />
    </svg>
  );
}

export function ChatBubbleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 5.7A2 2 0 0 1 5.5 3.7h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9L5.5 16v-2.3H5.5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

export function BookmarkRibbonIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 4h10a1 1 0 0 1 1 1v10.3a.7.7 0 0 1-1.1.55L11 13.3l-3.9 2.55A.7.7 0 0 1 6 15.3V5a1 1 0 0 1 1-1z" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6.5h12" />
      <path d="M8.3 6.5V5a1 1 0 0 1 1-1h1.4a1 1 0 0 1 1 1v1.5" />
      <path d="M7 6.5l.6 8.4c.05.7.65 1.3 1.4 1.3h2c.75 0 1.35-.6 1.4-1.3l.6-8.4" />
    </svg>
  );
}

export function SettingsGearIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 3.5v2M10 14.5v2M16.5 10h-2M5.5 10h-2M14.6 5.4l-1.4 1.4M6.8 13.2l-1.4 1.4M14.6 14.6l-1.4-1.4M6.8 6.8L5.4 5.4" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" />
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 6.3a1.3 1.3 0 0 1 1.3-1.3h3.6l1.4 1.6h6.4A1.3 1.3 0 0 1 17 7.9v6.8a1.3 1.3 0 0 1-1.3 1.3H4.3A1.3 1.3 0 0 1 3 14.7Z" />
    </svg>
  );
}

export function DoorExitIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="3.5" width="8" height="13" rx="1" />
      <path d="M12.5 10h4.3" />
      <path d="M14.8 7.6l2.4 2.4-2.4 2.4" />
    </svg>
  );
}

export function TheaterMasksIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="7.4" cy="10" r="5" />
      <circle cx="12.6" cy="10" r="5" />
      <path d="M5.4 12q2 1.5 4 0" />
      <path d="M10.6 8q2-1.5 4 0" />
    </svg>
  );
}

export function PersonIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="7" r="3.2" />
      <path d="M3.8 17c.7-3.6 3.4-5.6 6.2-5.6s5.5 2 6.2 5.6" />
    </svg>
  );
}

export function PeopleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="7.3" cy="7.3" r="2.7" />
      <path d="M2.8 16c.5-3 2.5-4.5 4.5-4.5" />
      <circle cx="13" cy="7.8" r="2.2" />
      <path d="M10.3 11.8c2.4 0 4.9 1.5 5.7 4.2" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 15V5M6 9l4-4 4 4" />
    </svg>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 5v10M6 11l4 4 4-4" />
    </svg>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5.2 6.6A6.5 6.5 0 1 1 4.3 11" />
      <path d="M5.2 3v3.6H8.8" />
    </svg>
  );
}

export function ScissorsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="14" r="2" />
      <path d="M7.6 7.3 16 15.5M7.6 12.7 16 4.5" />
    </svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="4.5" width="13" height="12" rx="1.5" />
      <path d="M3.5 8.3h13M7 3v3M13 3v3" />
    </svg>
  );
}

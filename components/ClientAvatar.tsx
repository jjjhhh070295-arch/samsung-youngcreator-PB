import Image from "next/image";
import type { ClientType } from "@/lib/types";

const PROFILE_IMAGES: Record<string, string> = {
  김서진: "/avatars/kim-seojin.png",
  박도윤: "/avatars/park-doyun.png",
  이채원: "/avatars/lee-chaewon.png",
};

const SIZE_CLASS = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-xl",
} as const;

export default function ClientAvatar({ name, type, size = "md" }: { name: string; type: ClientType | string; size?: keyof typeof SIZE_CLASS }) {
  const corporate = type === "corporate";
  const imageSrc = corporate ? undefined : PROFILE_IMAGES[name];
  const className = `${SIZE_CLASS[size]} relative inline-flex shrink-0 overflow-hidden ring-1 ring-[#DCE3EC]`;

  if (imageSrc) {
    return (
      <span role="img" aria-label={`${name} 고객 프로필`} className={`${className} rounded-full bg-slate-100`}>
        <Image src={imageSrc} alt="" fill sizes={size === "lg" ? "64px" : size === "sm" ? "32px" : "40px"} className="object-cover" />
      </span>
    );
  }

  if (corporate) {
    return (
      <span role="img" aria-label={`${name} 법인 고객`} className={`${className} items-center justify-center rounded-md bg-[#EAF2FF] text-[#0D57BA]`}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-1/2 w-1/2 fill-none stroke-current" strokeWidth="1.8">
          <path d="M4.5 20V5.5A1.5 1.5 0 0 1 6 4h8a1.5 1.5 0 0 1 1.5 1.5V20M15.5 9H19a1 1 0 0 1 1 1v10M8 8h1m3 0h1M8 11.5h1m3 0h1M8 15h1m3 0h1M3 20h18" />
        </svg>
      </span>
    );
  }

  return (
    <span role="img" aria-label={`${name} 고객`} className={`${className} items-center justify-center rounded-full bg-[#1769D2] font-black text-white`}>
      {name.trim()[0] || "?"}
    </span>
  );
}

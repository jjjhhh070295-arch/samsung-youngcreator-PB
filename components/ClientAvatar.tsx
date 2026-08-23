import type { ClientType } from "@/lib/types";

export default function ClientAvatar({ name, type, size = "md" }: { name: string; type: ClientType | string; size?: "sm" | "md" | "lg" }) {
  const corporate = type === "corporate";
  const dimensions = size === "lg" ? "h-16 w-16 text-xl" : size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";
  const initial = corporate ? "▦" : (name.trim()[0] || "?");
  return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center ${corporate ? "rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-white" : "rounded-full bg-gradient-to-br from-[#315DEB] to-[#1428A0] text-white"} ${dimensions} font-black shadow-sm`}>{initial}</span>;
}

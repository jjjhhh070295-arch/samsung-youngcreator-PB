"use client";

import { useTheme } from "./ThemeProvider";

export default function ThemeToggle() {
  const { mode, toggle } = useTheme();
  const isDark = mode === "dark";

  return (
    <button
      onClick={toggle}
      className="btn-ghost h-9 w-9 rounded-full p-0 text-lg"
      title={isDark ? "화이트 모드로" : "다크 모드로"}
      aria-label="테마 전환"
    >
      {isDark ? "☀️" : "🌙"}
    </button>
  );
}

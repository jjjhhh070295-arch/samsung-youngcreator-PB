"use client";

interface Props<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}

// 세그먼트형 토글 (PB기준↔고객기준, PB화면↔고객화면 등 공용)
export default function ViewToggle<T extends string>({
  options,
  value,
  onChange,
}: Props<T>) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface-2 p-1">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-navy-800 text-white shadow-sm dark:bg-navy-600"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

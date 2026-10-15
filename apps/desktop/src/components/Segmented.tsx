import type { ReactNode } from "react";

/** ปุ่มเลือกแบบสลับ (ที่กักกัน/ธีม) — ใช้ร่วมกันหลายหน้า */
export function Segmented<T extends string | number>({
  value,
  options,
  onPick,
  label,
}: {
  value: T;
  options: { id: T; label: string; icon?: ReactNode }[];
  onPick: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full bg-field p-[3px]">
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onPick(o.id)}
          className={`inline-flex min-h-10 min-w-16 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors ${value === o.id ? "bg-primary text-white shadow-primary" : "text-ink-soft hover:bg-surface"}`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

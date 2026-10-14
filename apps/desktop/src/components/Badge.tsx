import type { ReactNode } from "react";

export type Tone = "safe" | "warn" | "danger" | "info";

const TONES: Record<Tone, string> = {
  safe: "bg-safe-bg text-safe-fg",
  warn: "bg-warn-bg text-warn-fg",
  danger: "bg-danger-bg text-danger-fg",
  info: "bg-info-bg text-info-fg",
};

/** ป้ายความเสี่ยง/สถานะ — สีตามระดับ (ปลอดภัย / ตรวจสอบก่อน / ห้ามลบ / ข้อมูล) */
export function Badge({ tone, children, className = "" }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

import { Check } from "lucide-react";
import type { ReactNode } from "react";

type Props = { title: string; text: string; children?: ReactNode };

/** แถบสรุปผลหลังทำเสร็จ (ล้างขยะ / ใช้โปรไฟล์) */
export function ResultBanner({ title, text, children }: Props) {
  return (
    <div
      role="status"
      className="flex items-center gap-4 rounded-3xl bg-banner px-[22px] py-[18px] shadow-glass"
    >
      <span
        className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full text-white"
        style={{ background: "linear-gradient(150deg, #22B07D, #2BB7EE)" }}
      >
        <Check size={22} strokeWidth={2.6} aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-display text-[19px] font-medium">{title}</span>
        <span className="text-sm text-info-fg">{text}</span>
      </div>
      {children}
    </div>
  );
}

import type { ReactNode } from "react";

/** แถวตั้งค่า: หัวข้อ + คำอธิบายทางซ้าย ตัวควบคุมทางขวา — ใช้ในหน้า ตั้งค่า และ ประวัติ & กู้คืน */
export function Row({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-t border-rowline px-[22px] py-4 first:border-t-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-medium">{title}</span>
        {text && <span className="text-[13px] leading-relaxed text-muted">{text}</span>}
      </div>
      {children}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { background } from "../lib/tauri";
import { l, useI18n } from "../i18n";

/** ปล่อยการ์ดค้างไว้นานสุดเท่านี้ก่อนปิดเอง (กดปุ่มใดก็ได้ตลอดเวลา) */
const AUTO_DISMISS_MS = 25_000;

/**
 * การ์ดเตือนให้ล้างไฟล์ขยะ — วาดในหน้าต่างแยกขนาดเท่าการ์ดพอดี (ดู `src-tauri/src/background.rs`)
 *
 * เหตุผลการออกแบบ
 * - ไอคอน Sparkles คือไอคอนเดียวกับหน้า ล้างขยะ ในเมนูซ้าย จึงรู้ทันทีว่าการ์ดนี้พาไปทำอะไร
 * - แถบไล่สีบางๆ ด้านบนคือลวดลายประจำตัวของ WeakClean (เดียวกับ hero) การ์ดจึงยังเป็นแอปเดียวกัน
 * - สไลด์เข้าจากขอบขวา เพราะการ์ดมาจากขอบจอด้านนั้น จึงเข้าจากทางที่มันมา (และปิดเมื่อผู้ใช้ตั้ง reduced motion)
 * - ตัวการ์ดไม่ลบอะไรเอง: กด "ล้างตอนนี้" แล้วเปิดหน้า ล้างขยะ ให้ผู้ใช้ยืนยันในแอปอีกครั้ง
 */
export function ReminderCard() {
  const { tr } = useI18n();
  const [days, setDays] = useState(7);

  useEffect(() => {
    void background.status().then((s) => setDays(s.days)).catch(() => {});
  }, []);

  // ปิดเองใน 25 วินาที กันการ์ดค้างบังมุมจอ
  useEffect(() => {
    const timer = window.setTimeout(() => void background.dismiss(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") void background.dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div role="region" aria-labelledby="reminder-title" className="wc-reminder-in flex h-screen w-screen flex-col overflow-hidden bg-surface text-ink">
      <span aria-hidden="true" className="bg-hero h-[3px] w-full" />
      <div className="flex flex-1 items-center gap-3 px-4 py-3">
        <span className="tile-blue flex h-11 w-11 shrink-0 items-center justify-center rounded-tile text-white">
          <Sparkles size={20} strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 id="reminder-title" className="m-0 font-display text-[17px] leading-snug font-medium">
            {tr(l("ถึงเวลาล้างไฟล์ขยะ", "Time to clean junk files"))}
          </h1>
          <p role="alert" className="m-0 text-[13px] leading-relaxed text-muted">
            {tr(l(`ครบ ${days} วันนับจากครั้งล่าสุด · ดูว่ามีอะไรล้างได้บ้าง ไม่ลบถาวร กู้คืนได้`, `${days} days since your last clean · See what can be cleaned, nothing is deleted for good`))}
          </p>
          <span className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void background.cleanNow()}
              className="inline-flex min-h-10 items-center rounded-full bg-primary px-[18px] text-sm font-semibold text-white shadow-primary transition hover:brightness-105"
            >
              {tr(l("ล้างตอนนี้", "Clean now"))}
            </button>
            <button
              type="button"
              onClick={() => void background.dismiss()}
              className="inline-flex min-h-10 items-center rounded-full px-3.5 text-sm text-ink-soft transition-colors hover:bg-hover"
            >
              {tr(l("ไว้ทีหลัง", "Later"))}
            </button>
          </span>
        </div>
        <button
          type="button"
          aria-label={tr(l("ปิดการแจ้งเตือน", "Dismiss the reminder"))}
          onClick={() => void background.dismiss()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <X size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

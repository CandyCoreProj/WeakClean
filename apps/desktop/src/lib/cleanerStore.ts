import { useSyncExternalStore } from "react";
import { cleaner, type CategorySize, type CleanCategory } from "./tauri";

/*
 * ขนาดของแต่ละหมวดขยะ — อยู่นอก component เพื่อให้ป้ายบนเมนูซ้าย หน้าแรก และหน้า ล้างขยะ ใช้ตัวเลขชุดเดียวกัน
 * สแกนครั้งแรกอัตโนมัติเมื่อมี component ใดใช้งาน (อ่านอย่างเดียว ไม่แก้ไขไฟล์)
 */

export type CleanerState = {
  status: "idle" | "scanning" | "ready" | "error";
  catalog: CleanCategory[];
  sizes: Record<string, CategorySize>;
};

let state: CleanerState = { status: "idle", catalog: [], sizes: {} };
const listeners = new Set<() => void>();
let started = false;

function set(next: Partial<CleanerState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export async function rescanCleaner() {
  set({ status: "scanning" });
  try {
    const catalog = state.catalog.length ? state.catalog : await cleaner.catalog();
    const list = await cleaner.scan();
    set({ status: "ready", catalog, sizes: Object.fromEntries(list.map((s) => [s.id, s])) });
  } catch {
    set({ status: "error" });
  }
}

export function useCleaner(): CleanerState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      if (!started) {
        started = true;
        void rescanCleaner();
      }
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

/** ขนาดรวมของหมวดที่ติ๊กไว้ตั้งต้น (ปลอดภัยทั้งหมด) — ใช้เป็นตัวเลข "ล้างขยะได้" */
export function defaultCleanableBytes(s: CleanerState): number {
  return s.catalog.filter((c) => c.defaultOn).reduce((sum, c) => sum + (s.sizes[c.id]?.bytes ?? 0), 0);
}

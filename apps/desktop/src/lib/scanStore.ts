import { useSyncExternalStore } from "react";
import { scanner, type ScanProgress, type ScanSummary } from "./tauri";

/*
 * สถานะการสแกนแบบ global — อยู่นอก component เพื่อให้สแกนต่อได้แม้ผู้ใช้สลับไปหน้าอื่น
 * แล้วกลับมาเจอผลเดิม (ตัว tree อยู่ฝั่ง Rust ส่วนนี้เก็บแค่สรุปและความคืบหน้า)
 */

export type ScanState = {
  status: "idle" | "scanning" | "done" | "error";
  /** path ที่กำลังสแกน/สแกนล่าสุด */
  target: string | null;
  progress: ScanProgress | null;
  summary: ScanSummary | null;
  error: string | null;
};

let state: ScanState = { status: "idle", target: null, progress: null, summary: null, error: null };
/** ผลสแกนล่าสุดที่สำเร็จ ใช้กลับไปแสดงเมื่อผู้ใช้ยกเลิกสแกนครั้งใหม่ */
let lastGood: ScanSummary | null = null;
const listeners = new Set<() => void>();
let inited: Promise<unknown> | null = null;

function set(next: Partial<ScanState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function init() {
  inited ??= Promise.all([
    scanner.onProgress((p) => set({ progress: p })),
    scanner.onDone((d) => {
      if ("error" in d) {
        set({ status: lastGood ? "done" : "error", error: d.error, summary: lastGood });
      } else if (d.cancelled) {
        set({ status: lastGood ? "done" : "idle", summary: lastGood, target: lastGood?.rootPath ?? null, progress: null, error: null });
      } else {
        lastGood = d;
        set({ status: "done", summary: d, target: d.rootPath, progress: null, error: null });
      }
    }),
  ]);
  return inited;
}

export async function startScan(path: string) {
  await init();
  set({ status: "scanning", target: path, progress: null, error: null });
  try {
    await scanner.start(path);
  } catch (e) {
    set({ status: lastGood ? "done" : "error", summary: lastGood, error: String(e) });
  }
}

export function cancelScan() {
  void scanner.cancel();
}

export function useScan(): ScanState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      void init();
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

import { useSyncExternalStore } from "react";
import { scanner, type DupeDone, type DupeProgress } from "./tauri";

/*
 * สถานะการหาไฟล์ซ้ำ — อยู่นอก component เพื่อให้ทำงานต่อได้เมื่อสลับแท็บ/หน้า
 * `forKey` คือสแกนที่ผลนี้เป็นของ ถ้าสแกนใหม่ ผลเก่าจะถูกมองว่าไม่เกี่ยวข้อง
 */

export type DupeState = { status: "idle" | "running" | "done"; forKey: string | null; progress: DupeProgress | null; summary: DupeDone | null };

let state: DupeState = { status: "idle", forKey: null, progress: null, summary: null };
const listeners = new Set<() => void>();
let inited: Promise<unknown> | null = null;

function set(next: Partial<DupeState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function init() {
  inited ??= Promise.all([
    scanner.onDupesProgress((p) => set({ progress: p })),
    scanner.onDupesDone((d) => set(d.cancelled ? { status: "idle", progress: null, summary: null, forKey: null } : { status: "done", progress: null, summary: d })),
  ]);
  return inited;
}

export async function startDupes(scanKey: string) {
  await init();
  set({ status: "running", forKey: scanKey, progress: null, summary: null });
  try {
    await scanner.dupesStart();
  } catch {
    set({ status: "idle", forKey: null });
  }
}

export function cancelDupes() {
  void scanner.dupesCancel();
}

export function useDupes(): DupeState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      void init();
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

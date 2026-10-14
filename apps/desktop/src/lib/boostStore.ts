import { useSyncExternalStore } from "react";
import { boost, cleaner, type TweakMeta, type TweakState } from "./tauri";
import { l, type L } from "../i18n";

/*
 * สถานะจริงของ tweak ทั้งหมด (อ่านจาก registry/services) — ใช้ร่วมกันระหว่างหน้า เร่งความเร็ว, ประวัติ & กู้คืน และหน้าแรก
 * สถานะอ่านอย่างเดียว ไม่แก้ไขอะไรในเครื่อง
 */

export type BoostState = {
  status: "idle" | "loading" | "ready" | "error";
  catalog: TweakMeta[];
  elevated: boolean;
  states: Record<string, TweakState>;
  /** รหัสรายการปรับแต่งล่าสุดที่ยังใช้อยู่ ของแต่ละ tweak — ใช้ย้อนกลับ */
  activeChange: Record<string, number>;
};

let state: BoostState = { status: "idle", catalog: [], elevated: false, states: {}, activeChange: {} };
const listeners = new Set<() => void>();
let started = false;

function set(next: Partial<BoostState>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

export async function refreshBoost() {
  set({ status: "loading" });
  try {
    const catalog = state.catalog.length ? state.catalog : await boost.catalog();
    const [st, overview] = await Promise.all([boost.status(), cleaner.overview()]);
    const activeChange: Record<string, number> = {};
    for (const c of overview.changes) if (c.state === "applied" && !(c.tweakId in activeChange)) activeChange[c.tweakId] = c.id; // เรียงใหม่สุดก่อน
    set({ status: "ready", catalog, elevated: st.elevated, states: Object.fromEntries(st.tweaks.map((x) => [x.id, x.state])), activeChange });
  } catch {
    set({ status: "error" });
  }
}

export function useBoost(): BoostState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      if (!started) {
        started = true;
        void refreshBoost();
      }
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

/** ข้อความอธิบายเหตุที่ tweak ใช้/ย้อนไม่สำเร็จ */
export function failureText(reason: string): L {
  switch (reason) {
    case "needs_admin":
      return l("ต้องเปิดแอปแบบผู้ดูแล", "Needs the app to run as administrator");
    case "verify_failed":
      return l("Windows ไม่ยอมรับค่านี้ (อาจถูกนโยบายของเครื่องบล็อก) — คืนค่าเดิมให้แล้ว", "Windows didn't accept this value (it may be blocked by policy) — the previous value was restored");
    case "unavailable":
      return l("เครื่องนี้ไม่รองรับ", "Not supported on this PC");
    default:
      return l(`ทำไม่สำเร็จ: ${reason}`, `Failed: ${reason}`);
  }
}

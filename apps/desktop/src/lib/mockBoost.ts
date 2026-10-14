import { mockChanges, mockEvents, nextMockId } from "./mockCleaner";
import type { ApplyResult, BoostStatus, RevertResult, TweakMeta, TweakState } from "./tauri";

/*
 * Boost จำลองสำหรับเปิดหน้าตาในเบราว์เซอร์ (npm run dev) ที่ไม่มี Rust — ในแอปจริงไม่ถูกใช้
 * ชุดนี้เล็กกว่าแคตตาล็อกจริงใน data/tweaks/catalog.toml เพื่อดูหน้าตาเท่านั้น
 */

const t = (id: string, category: string, risk: TweakMeta["risk"], profiles: string[], th: string, en: string, o: Partial<TweakMeta> = {}): TweakMeta => ({
  id, category, risk, profiles, nameTh: th, nameEn: en, descTh: "ตัวอย่างสำหรับดูหน้าตา", descEn: "Sample for the browser preview", reboot: false, requiresAdmin: false, ...o,
});

const CATALOG: TweakMeta[] = [
  t("transp", "sys", "safe", ["balanced", "gaming"], "ปิดเอฟเฟกต์โปร่งใส", "Turn off transparency"),
  t("widgets", "sys", "safe", ["balanced", "gaming"], "ปิดปุ่ม Widgets", "Turn off Widgets"),
  t("gamedvr", "game", "safe", ["balanced", "gaming"], "ปิด Game DVR", "Turn off Game DVR"),
  t("mouse", "game", "safe", ["gaming"], "ปิด Enhance Pointer Precision", "Turn off Enhance Pointer Precision"),
  t("prio", "game", "recommended", ["gaming"], "ให้โปรแกรมด้านหน้าได้ CPU ก่อน", "Foreground CPU priority", { requiresAdmin: true }),
  t("net", "net", "recommended", ["gaming"], "ปิด Network Throttling", "Turn off Network Throttling", { requiresAdmin: true, reboot: true }),
  t("sysmain", "svc", "recommended", ["gaming"], "ปิด SysMain", "Turn off SysMain", { requiresAdmin: true }),
  t("vbs", "expert", "expert", [], "ปิด VBS / HVCI", "Turn off VBS / HVCI", { requiresAdmin: true, reboot: true }),
];

const states: Record<string, TweakState> = Object.fromEntries(CATALOG.map((c) => [c.id, "off" as TweakState]));
states.widgets = "external";

export const mockBoost = {
  catalog: async (): Promise<TweakMeta[]> => CATALOG,
  status: async (): Promise<BoostStatus> => ({ elevated: true, tweaks: CATALOG.map((c) => ({ id: c.id, state: states[c.id] })) }),
  apply: async (ids: string[], profile: string): Promise<ApplyResult> => {
    const todo = ids.filter((id) => states[id] === "off" || states[id] === "drifted");
    if (todo.length === 0) return { eventId: null, applied: [], skipped: ids, failed: [], restorePoint: "skipped" };
    const eventId = nextMockId();
    mockEvents.unshift({ id: eventId, ts: Math.floor(Date.now() / 1000), kind: "boost", state: "active", heldFiles: 0, heldBytes: 0, params: { profile, tweaks: todo, restorePoint: "created" } });
    for (const id of todo) {
      states[id] = "on";
      mockChanges.unshift({ id: nextMockId(), eventId, tweakId: id, ts: Math.floor(Date.now() / 1000), state: "applied", diffs: [`${id}: 1 → 0`] });
    }
    return { eventId, applied: todo, skipped: ids.filter((i) => !todo.includes(i)), failed: [], restorePoint: "created" };
  },
  revertChange: async (changeId: number): Promise<RevertResult> => {
    const c = mockChanges.find((x) => x.id === changeId);
    if (!c || c.state !== "applied") return { reverted: 0, failed: [] };
    c.state = "reverted";
    states[c.tweakId] = "off";
    const own = mockChanges.filter((x) => x.eventId === c.eventId);
    const ev = mockEvents.find((e) => e.id === c.eventId);
    if (ev) ev.state = own.every((x) => x.state === "reverted") ? "undone" : "partial";
    return { reverted: 1, failed: [] };
  },
  revertEvent: async (eventId: number): Promise<RevertResult> => {
    let n = 0;
    for (const c of mockChanges.filter((x) => x.eventId === eventId && x.state === "applied")) n += (await mockBoost.revertChange(c.id)).reverted;
    return { reverted: n, failed: [] };
  },
  relaunchAdmin: async () => {},
};

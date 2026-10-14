import type { CategorySize, CleanCategory, CleanProgress, CleanResult, RestoreResult, SafetyEvent, SafetyOverview, TweakChange, UndoAll } from "./tauri";

/*
 * cleaner จำลองสำหรับเปิดหน้าตาในเบราว์เซอร์ (npm run dev) ที่ไม่มี Rust — ในแอปจริงไม่ถูกใช้
 * เก็บประวัติไว้ในหน่วยความจำ เพื่อให้ลองกด ล้าง → กู้คืน ได้ครบวงจร
 */

const GB = 1024 ** 3;

const CATS: (CleanCategory & { gb: number })[] = [
  { id: "temp", group: "safe", defaultOn: true, gb: 2.27, nameTh: "ไฟล์ชั่วคราวของผู้ใช้", nameEn: "User temporary files", descTh: "%TEMP% — ไฟล์ที่โปรแกรมสร้างไว้แล้วไม่ได้ลบ", descEn: "%TEMP% — files programs created and never removed", requiresAdmin: false },
  { id: "wu", group: "safe", defaultOn: true, gb: 1.92, nameTh: "แคช Windows Update", nameEn: "Windows Update cache", descTh: "ไฟล์อัปเดตที่ติดตั้งเสร็จแล้ว", descEn: "Updates that are already installed", requiresAdmin: true },
  { id: "browser", group: "safe", defaultOn: true, gb: 0.58, nameTh: "แคชเบราว์เซอร์", nameEn: "Browser cache", descTh: "Chrome, Edge, Firefox — ไม่แตะรหัสผ่านและคุกกี้", descEn: "Chrome, Edge, Firefox — passwords and cookies untouched", requiresAdmin: false },
  { id: "thumb", group: "safe", defaultOn: true, gb: 0.31, nameTh: "แคชรูปตัวอย่าง (Thumbnail)", nameEn: "Thumbnail cache", descTh: "Windows จะสร้างใหม่ให้อัตโนมัติ", descEn: "Windows rebuilds it automatically", requiresAdmin: false },
  { id: "shader", group: "safe", defaultOn: false, gb: 1.35, nameTh: "Shader cache (DirectX / NVIDIA / AMD)", nameEn: "Shader cache (DirectX / NVIDIA / AMD)", descTh: "เกมจะโหลดช้าลงนิดหน่อยเฉพาะครั้งแรกหลังล้าง", descEn: "Games load a bit slower, only the first time after cleaning", requiresAdmin: false },
  { id: "installers", group: "check", defaultOn: false, gb: 3.1, nameTh: "ตัวติดตั้งเก่าใน Downloads", nameEn: "Old installers in Downloads", descTh: ".exe .msi .iso ที่เก่ากว่า 90 วัน", descEn: ".exe .msi .iso older than 90 days", requiresAdmin: false },
];

/** ประวัติจำลอง — mockBoost เขียนรายการปรับแต่งลงที่นี่ด้วย */
export const mockEvents: SafetyEvent[] = [];
export const mockChanges: TweakChange[] = [];
export const nextMockId = (() => {
  let n = 1;
  return () => n++;
})();
const events = mockEvents;
let onProgress: ((p: CleanProgress) => void) | null = null;

const now = () => Math.floor(Date.now() / 1000);

export const mockCleaner = {
  catalog: async (): Promise<CleanCategory[]> => CATS.map(({ gb: _gb, ...c }) => c),
  scan: async (): Promise<CategorySize[]> => CATS.map((c) => ({ id: c.id, files: Math.round(c.gb * 900), bytes: Math.round(c.gb * GB), errors: 0 })),
  files: async (id: string) => {
    const c = CATS.find((x) => x.id === id);
    return { total: 3, files: [1, 2, 3].map((i) => ({ path: `C:\\Users\\demo\\AppData\\Local\\${id}\\file${i}.tmp`, size: Math.round(((c?.gb ?? 1) * GB) / (i * 4)) })) };
  },
  clean: async (ids: string[]): Promise<CleanResult> => {
    const cats = CATS.filter((c) => ids.includes(c.id));
    const categories = cats.map((c) => ({ id: c.id, movedFiles: Math.round(c.gb * 900), movedBytes: Math.round(c.gb * GB), skippedFiles: 0, skippedBytes: 0 }));
    const movedBytes = categories.reduce((s, c) => s + c.movedBytes, 0);
    const movedFiles = categories.reduce((s, c) => s + c.movedFiles, 0);
    onProgress?.({ category: ids[0] ?? "", files: movedFiles, bytes: movedBytes });
    if (movedFiles === 0) return { eventId: null, movedFiles, movedBytes, skippedFiles: 0, skippedBytes: 0, categories };
    const id = nextMockId();
    events.unshift({ id, ts: now(), kind: "clean", state: "active", heldFiles: movedFiles, heldBytes: movedBytes, params: { files: movedFiles, bytes: movedBytes, skippedFiles: 0, categories: ids } });
    return { eventId: id, movedFiles, movedBytes, skippedFiles: 0, skippedBytes: 0, categories };
  },
  onProgress: async (cb: (p: CleanProgress) => void) => {
    onProgress = cb;
    return () => {
      onProgress = null;
    };
  },
  overview: async (): Promise<SafetyOverview> => {
    const held = events.filter((e) => e.state === "active");
    return {
      events: events.map((e) => ({ ...e })),
      changes: mockChanges.map((c) => ({ ...c })),
      quarantine: {
        files: held.reduce((s, e) => s + e.heldFiles, 0),
        bytes: held.reduce((s, e) => s + e.heldBytes, 0),
        nextExpiry: held.length ? Math.min(...held.map((e) => e.ts)) + 7 * 86400 : null,
        retentionDays: 7,
        lifetimeFreed: events.filter((e) => e.state !== "undone").reduce((s, e) => s + (e.params.bytes ?? 0), 0),
      },
    };
  },
  restore: async (eventId: number): Promise<RestoreResult> => {
    const e = events.find((x) => x.id === eventId);
    if (!e) throw new Error("event not found");
    const r = { restoredFiles: e.heldFiles, restoredBytes: e.heldBytes, conflicts: 0, failed: 0 };
    e.state = "undone";
    e.heldFiles = 0;
    e.heldBytes = 0;
    return r;
  },
  undoAll: async (): Promise<UndoAll> => {
    const total: RestoreResult = { restoredFiles: 0, restoredBytes: 0, conflicts: 0, failed: 0 };
    for (const e of events.filter((x) => x.kind === "clean" && x.state === "active")) {
      const r = await mockCleaner.restore(e.id);
      total.restoredFiles += r.restoredFiles;
      total.restoredBytes += r.restoredBytes;
    }
    let reverted = 0;
    for (const c of mockChanges.filter((x) => x.state === "applied")) {
      c.state = "reverted";
      reverted++;
    }
    for (const e of events.filter((x) => x.kind === "boost")) e.state = "undone";
    return { restore: total, revert: { reverted, failed: [] } };
  },
};

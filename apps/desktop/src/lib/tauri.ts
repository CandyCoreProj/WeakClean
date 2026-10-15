import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { check as checkUpdate, type Update } from "@tauri-apps/plugin-updater";
import { mockScanner } from "./mockScanner";
import { mockCleaner, mockQuarantine } from "./mockCleaner";
import { mockBoost } from "./mockBoost";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** ปุ่มหน้าต่าง — ถ้าเปิดในเบราว์เซอร์ธรรมดา (npm run dev) จะไม่ทำอะไร */
export const appWindow = {
  minimize: () => {
    if (isTauri()) void getCurrentWindow().minimize();
  },
  toggleMaximize: () => {
    if (isTauri()) void getCurrentWindow().toggleMaximize();
  },
  close: () => {
    if (isTauri()) void getCurrentWindow().close();
  },
};

export type AppInfo = { version: string; os: string; arch: string };

/** เรียกคำสั่ง Rust `app_info` (ทดสอบสะพาน React ↔ Rust) */
export async function getAppInfo(): Promise<AppInfo | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<AppInfo>("app_info");
  } catch {
    return null;
  }
}

/* ───────── Scanner (Phase 1) — คู่กับ src-tauri/src/scan_cmd.rs ───────── */

export type DriveInfo = {
  letter: string;
  root: string;
  kind: "fixed" | "removable" | "network" | "cdrom" | "ramdisk";
  total: number;
  free: number;
};

export type ScanProgress = { files: number; dirs: number; bytes: number; errors: number; current: string };

export type ScanSummary = {
  rootPath: string;
  size: number;
  allocated: number;
  files: number;
  dirs: number;
  cloudSize: number;
  cloudFiles: number;
  errors: number;
  hardlinkDupes: number;
  clusterSize: number;
  elapsedMs: number;
  cancelled: boolean;
};

export type NodeView = {
  name: string;
  size: number;
  allocated: number;
  files: number;
  dirs: number;
  ownSize: number;
  ownFiles: number;
  cloudSize: number;
  cloudFiles: number;
  hasChildren: boolean;
};

export type OldFile = { path: string; size: number; allocated: number; modified: number };
export type DupFile = { path: string; modified: number };
export type DupGroup = { size: number; wasted: number; files: DupFile[] };
/** stage: 0 = จัดกลุ่มตามขนาด · 1 = hash ส่วนหัว · 2 = hash เต็มไฟล์ */
export type DupeProgress = { stage: number; done: number; total: number; bytes: number };
export type DupeDone = { groups: number; wasted: number; cancelled: boolean };
export type Snapshot = { id: number; ts: number; size: number; allocated: number; files: number; dirs: number };
export type Growth = { since: number; delta: number; drivers: { path: string; delta: number }[] };
export type History = { snapshots: Snapshot[]; growth: Growth | null };

export type Children = { node: NodeView; children: NodeView[]; rest: NodeView | null };
export type FileEntry = { path: string; size: number; allocated: number };
export type ExtStat = { ext: string; files: number; size: number; allocated: number };
export type Overview = { topFiles: FileEntry[]; extensions: ExtStat[] };

/** `scan://done` ส่งเป็น ScanSummary เมื่อสำเร็จ หรือ { error } เมื่อสแกนไม่ได้ */
export type ScanDone = ScanSummary | { error: string };

/** ขนาดไบต์เป็นข้อความอ่านง่าย (1024 ฐาน เหมือน Windows Explorer / TreeSize) */
export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

const real = {
  listDrives: () => invoke<DriveInfo[]>("list_drives"),
  /** เริ่มสแกนเบื้องหลัง — ติดตามด้วย onProgress / onDone */
  start: (path: string) => invoke<void>("start_scan", { path }),
  cancel: () => invoke<void>("cancel_scan"),
  /** path = รายชื่อโฟลเดอร์ไล่จากราก ([] = ราก) */
  children: (path: string[]) => invoke<Children>("scan_children", { path }),
  overview: () => invoke<Overview>("scan_overview"),
  /** ไฟล์ที่ไม่ได้แก้ไขมานานที่สุดในกลุ่มที่ใหญ่สุด */
  oldFiles: () => invoke<OldFile[]>("scan_old_files"),
  /** หาไฟล์ซ้ำจากผลสแกนล่าสุด (เบื้องหลัง) — ติดตามด้วย onDupesProgress / onDupesDone */
  dupesStart: () => invoke<void>("dupes_start"),
  dupesCancel: () => invoke<void>("dupes_cancel"),
  dupesResult: () => invoke<DupGroup[]>("dupes_result"),
  onDupesProgress: (cb: (p: DupeProgress) => void): Promise<UnlistenFn> => listen<DupeProgress>("dupes://progress", (e) => cb(e.payload)),
  onDupesDone: (cb: (d: DupeDone) => void): Promise<UnlistenFn> => listen<DupeDone>("dupes://done", (e) => cb(e.payload)),
  /** ย้ายไฟล์ที่เลือกจากรายการ "old" หรือ "dupes" เข้าที่กักกัน — path ต้องอยู่ในผลสแกน */
  quarantine: (list: "old" | "dupes", paths: string[]) => invoke<CleanResult>("quarantine_listed", { list, paths }),
  /** ย้ายโฟลเดอร์/ไฟล์ที่ผู้ใช้เลือกเองจากหน้า พื้นที่ดิสก์ เข้าที่กักกัน — path ต้องตรงกับผลสแกนล่าสุด */
  removePaths: (paths: string[]) => invoke<CleanResult>("quarantine_scan_paths", { paths }),
  /** ประวัติการสแกนของ path นี้ + การเติบโตเทียบครั้งก่อน */
  history: (root: string) => invoke<History>("scan_history", { root }),
  /** เปิดใน Explorer (ไฟล์จะถูกเลือกให้) */
  reveal: (path: string) => invoke<void>("reveal_in_explorer", { path }),
  /** กล่องเลือกโฟลเดอร์ของ Windows — คืน null ถ้ายกเลิก */
  pickFolder: async (): Promise<string | null> => {
    const r = await openDialog({ directory: true, multiple: false });
    return typeof r === "string" ? r : null;
  },
  onProgress: (cb: (p: ScanProgress) => void): Promise<UnlistenFn> => listen<ScanProgress>("scan://progress", (e) => cb(e.payload)),
  onDone: (cb: (d: ScanDone) => void): Promise<UnlistenFn> => listen<ScanDone>("scan://done", (e) => cb(e.payload)),
};

/** ในแอปจริงเรียก Rust; เปิดในเบราว์เซอร์ธรรมดา (npm run dev) จะใช้ข้อมูลจำลอง */
export const scanner: typeof real = isTauri() ? real : mockScanner;

/* ───────── Cleaner + Safety Center (Phase 3) — คู่กับ src-tauri/src/clean_cmd.rs ───────── */

export type CleanCategory = {
  id: string;
  group: "safe" | "check";
  defaultOn: boolean;
  nameTh: string;
  nameEn: string;
  descTh: string;
  descEn: string;
  requiresAdmin: boolean;
};
export type CategorySize = { id: string; files: number; bytes: number; errors: number };
export type CleanCategoryResult = { id: string; movedFiles: number; movedBytes: number; skippedFiles: number; skippedBytes: number };
export type CleanResult = {
  /** null = ไม่มีไฟล์ถูกย้ายเลย จึงไม่มีรายการในประวัติ */
  eventId: number | null;
  movedFiles: number;
  movedBytes: number;
  skippedFiles: number;
  skippedBytes: number;
  categories: CleanCategoryResult[];
};
export type CleanProgress = { category: string; files: number; bytes: number };
export type Preview = { files: { path: string; size: number }[]; total: number };

export type SafetyEvent = {
  id: number;
  /** วินาทีตั้งแต่ 1970 */
  ts: number;
  kind: string;
  params: { files?: number; bytes?: number; skippedFiles?: number; categories?: string[]; profile?: string; tweaks?: string[]; restorePoint?: string; failed?: number };
  state: "active" | "undone" | "partial" | "expired";
  heldFiles: number;
  heldBytes: number;
};
export type Quarantine = { files: number; bytes: number; nextExpiry: number | null; retentionDays: number; lifetimeFreed: number };
export type SafetyOverview = { events: SafetyEvent[]; quarantine: Quarantine; changes: TweakChange[] };
export type RestoreResult = { restoredFiles: number; restoredBytes: number; conflicts: number; failed: number };

const cleanerReal = {
  catalog: () => invoke<CleanCategory[]>("cleaner_catalog"),
  /** วัดขนาดทุกหมวด (อ่านอย่างเดียว) */
  scan: () => invoke<CategorySize[]>("cleaner_scan"),
  files: (id: string, limit: number) => invoke<Preview>("cleaner_files", { id, limit }),
  /** ย้ายไฟล์ของหมวดที่เลือกเข้าที่กักกัน 7 วัน (ไม่ลบถาวร) */
  clean: (ids: string[]) => invoke<CleanResult>("cleaner_clean", { ids }),
  /** จำหมวดที่ผู้ใช้ยืนยันไว้ก่อนขอสิทธิ์ผู้ดูแล (UAC ครั้งเดียว) แล้วเปิดแอปใหม่ */
  setPending: (ids: string[]) => invoke<void>("cleaner_pending_set", { ids }),
  /** หมวดที่ค้างไว้จากรอบที่เปิดใหม่แบบผู้ดูแล — อ่านแล้วลบทิ้งในตัว (คืน [] ถ้าไม่มีหรือหมดอายุ) */
  takePending: () => invoke<string[]>("cleaner_pending_take"),
  onProgress: (cb: (p: CleanProgress) => void): Promise<UnlistenFn> => listen<CleanProgress>("cleaner://progress", (e) => cb(e.payload)),
  overview: () => invoke<SafetyOverview>("safety_overview"),
  restore: (eventId: number) => invoke<RestoreResult>("safety_restore", { eventId }),
  /** คืนค่าทุกอย่าง: กู้ไฟล์จากที่กักกัน + ย้อนทุกการปรับแต่ง */
  undoAll: () => invoke<UndoAll>("safety_undo_all"),
};

export const cleaner: typeof cleanerReal = isTauri() ? cleanerReal : mockCleaner;

/* ───────── Boost (Phase 4) — คู่กับ src-tauri/src/boost_cmd.rs ───────── */

export type TweakMeta = {
  id: string;
  category: string;
  risk: "safe" | "recommended" | "expert";
  reboot: boolean;
  /** "balanced" | "gaming" */
  profiles: string[];
  nameTh: string;
  nameEn: string;
  descTh: string;
  descEn: string;
  requiresAdmin: boolean;
};
/** on = เราตั้งไว้และยังอยู่ · external = ตั้งอยู่แล้วโดยไม่ใช่เรา · drifted = เคยตั้งแต่ถูก Windows คืนค่า */
export type TweakState = "off" | "on" | "external" | "drifted" | "unavailable";
export type BoostStatus = { elevated: boolean; tweaks: { id: string; state: TweakState }[] };
export type TweakFailure = { id: string; reason: string };
export type ApplyResult = { eventId: number | null; applied: string[]; skipped: string[]; failed: TweakFailure[]; restorePoint: "created" | "failed" | "skipped" };
export type RevertResult = { reverted: number; failed: TweakFailure[] };
export type TweakChange = { id: number; eventId: number; tweakId: string; ts: number; state: "applied" | "reverted"; diffs: string[] };
export type UndoAll = { restore: RestoreResult; revert: RevertResult };

const boostReal = {
  catalog: () => invoke<TweakMeta[]>("boost_catalog"),
  /** อ่านสถานะจริงของทุก tweak (ไม่แก้ไขอะไร) */
  status: () => invoke<BoostStatus>("boost_status"),
  /** ใช้ tweak ที่เลือก — ค่าเดิมถูกบันทึกก่อน และย้อนกลับเองถ้าเขียนไม่สำเร็จ */
  apply: (ids: string[], profile: string) => invoke<ApplyResult>("boost_apply", { ids, profile }),
  revertChange: (changeId: number) => invoke<RevertResult>("boost_revert_change", { changeId }),
  revertEvent: (eventId: number) => invoke<RevertResult>("boost_revert_event", { eventId }),
  /** เปิดแอปใหม่ด้วยสิทธิ์ผู้ดูแล (ขึ้น UAC) — reject "cancelled" ถ้าผู้ใช้ไม่อนุญาต */
  relaunchAdmin: () => invoke<void>("boost_relaunch_admin"),
};

export const boost: typeof boostReal = isTauri() ? boostReal : mockBoost;

/* ───────── ข้อมูลเครื่อง (หน้าแรก) ───────── */

export type SystemInfo = { os: string; cpu: string; gpus: string[]; ramBytes: number; threads: number };

/** อ่านอย่างเดียว — ในเบราว์เซอร์ธรรมดา (npm run dev) จะได้ข้อมูลตัวอย่าง */
export const systemInfo = (): Promise<SystemInfo> =>
  isTauri()
    ? invoke<SystemInfo>("system_info")
    : Promise.resolve({ os: "Windows 11 Pro 24H2", cpu: "Sample CPU @ 3.6GHz", gpus: ["Sample GPU"], ramBytes: 32 * 1024 ** 3, threads: 16 });

/* ───────── ตั้งค่า — คู่กับ src-tauri/src/settings_cmd.rs ───────── */

export type Settings = { retentionDays: number; dataDir: string; quarantineFiles: number; quarantineBytes: number };
export type Purged = { files: number; bytes: number };

const settingsReal = {
  get: () => invoke<Settings>("settings_get"),
  /** ตั้งจำนวนวันที่กักกัน (1–365) — ชุดที่เก่ากว่าค่าใหม่ถูกลบถาวรทันที */
  setRetention: (days: number) => invoke<Purged>("settings_set_retention", { days }),
  /** ลบถาวรทุกอย่างในที่กักกัน */
  purgeQuarantine: () => invoke<Purged>("quarantine_purge_all"),
};
const settingsMock: typeof settingsReal = {
  get: async () => ({ retentionDays: mockQuarantine.retentionDays, dataDir: "C:\\Users\\demo\\AppData\\Local\\WeakClean", quarantineFiles: 0, quarantineBytes: 0 }),
  setRetention: async (days) => {
    mockQuarantine.retentionDays = days;
    return { files: 0, bytes: 0 };
  },
  purgeQuarantine: async () => ({ files: 0, bytes: 0 }),
};
export const settings: typeof settingsReal = isTauri() ? settingsReal : settingsMock;

/* ───────── ตัวช่วยเบื้องหลัง — คู่กับ src-tauri/src/background.rs ───────── */

export type BackgroundStatus = {
  /** ลงทะเบียนเปิดพร้อม Windows อยู่ไหม */
  autostart: boolean;
  /** เปิดการเตือนอยู่ไหม */
  remind: boolean;
  /** รอบการเตือน (วัน) */
  days: number;
  /** เวลาของการล้างขยะครั้งล่าสุด (วินาทีตั้งแต่ 1970) — null ถ้ายังไม่เคยล้าง */
  lastCleanTs: number | null;
  /** เวลาที่จะเตือนครั้งถัดไป (วินาทีตั้งแต่ 1970) */
  nextReminderTs: number;
};

const backgroundReal = {
  status: () => invoke<BackgroundStatus>("background_status"),
  setAutostart: (enabled: boolean) => invoke<void>("background_set_autostart", { enabled }),
  setRemind: (enabled: boolean) => invoke<void>("background_set_remind", { enabled }),
  /** ปุ่มลองในหน้าตั้งค่า: ขึ้นการ์ดเตือนเดี๋ยวนี้ แล้วเริ่มนับรอบใหม่ */
  remindNow: () => invoke<void>("background_remind_now"),
  /** ภาษาของเมนูในถาดระบบ */
  setLang: (lang: string) => invoke<void>("background_lang", { lang }),
  /** ผู้ใช้กด "ล้างตอนนี้" บนการ์ดเตือน: เปิดโปรแกรมไปหน้า ล้างขยะ */
  cleanNow: () => invoke<void>("reminder_action", { action: "clean" }),
  /** ปิดการ์ดเตือน (กด "ไว้ทีหลัง", กดกากบาท หรือปล่อยทิ้งไว้จนครบเวลา) */
  dismiss: () => invoke<void>("reminder_action", { action: "later" }),
  /** การ์ดเตือนสั่งให้เปิดหน้า ล้างขยะ */
  onCleanRequested: (cb: () => void): Promise<UnlistenFn> => listen("reminder://clean", () => cb()),
};

const backgroundMock: typeof backgroundReal = {
  status: async () => ({ autostart: false, remind: true, days: 7, lastCleanTs: null, nextReminderTs: Math.floor(Date.now() / 1000) + 7 * 86_400 }),
  setAutostart: async () => {},
  setRemind: async () => {},
  remindNow: async () => {},
  setLang: async () => {},
  cleanNow: async () => {},
  dismiss: async () => {},
  onCleanRequested: async () => () => {},
};

export const background: typeof backgroundReal = isTauri() ? backgroundReal : backgroundMock;

/* ───────── อัปเดตอัตโนมัติ — ดึงจาก GitHub เฉพาะตอนผู้ใช้กด "ตรวจหาอัปเดต" ───────── */

export type UpdateInfo = { version: string; notes: string; date: string | null };

let pendingUpdate: Update | null = null;

export const updater = {
  /** ตรวจหาเวอร์ชันใหม่ — null = เป็นเวอร์ชันล่าสุดแล้ว (เชื่อมต่ออินเทอร์เน็ตเฉพาะตอนเรียกนี้) */
  check: async (): Promise<UpdateInfo | null> => {
    if (!isTauri()) return null;
    pendingUpdate = await checkUpdate();
    return pendingUpdate ? { version: pendingUpdate.version, notes: pendingUpdate.body ?? "", date: pendingUpdate.date ?? null } : null;
  },
  /** ดาวน์โหลด (ตรวจลายเซ็นอัปเดตให้อัตโนมัติ) แล้วติดตั้ง — บน Windows แอปจะปิดตัวเองระหว่างติดตั้ง */
  install: async (onProgress: (downloaded: number, total: number | null) => void): Promise<void> => {
    if (!pendingUpdate) throw new Error("no update checked yet");
    let downloaded = 0;
    let total: number | null = null;
    await pendingUpdate.download((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? null;
      else if (e.event === "Progress") downloaded += e.data.chunkLength;
      onProgress(downloaded, total);
    });
    await pendingUpdate.install();
  },
};

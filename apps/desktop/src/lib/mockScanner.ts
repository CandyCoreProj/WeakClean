import { mockEvents, nextMockId } from "./mockCleaner";
import type { Children, CleanResult, DupeDone, DupeProgress, DupGroup, DriveInfo, History, NodeView, OldFile, Overview, ScanDone, ScanProgress, ScanSummary } from "./tauri";

/*
 * สแกนเนอร์จำลองสำหรับเปิดหน้าตาในเบราว์เซอร์ (npm run dev) ที่ไม่มี Rust
 * ข้อมูลเป็นตัวอย่างของ C: จากภาพ TreeSize — ในแอปจริงจะไม่ถูกใช้
 */

const GB = 1024 ** 3;
const MB = 1024 ** 2;

type MNode = { name: string; size: number; own?: number; kids?: MNode[] };

const n = (name: string, size: number, kids?: MNode[], own = 0): MNode => ({ name, size, own, kids });

const TREE: MNode = n("C:\\", 232.3 * GB, [
  n("Users", 88.7 * GB, [
    n("ArmZ", 88.7 * GB, [
      n("AppData", 41.2 * GB, [n("Local", 33 * GB, [n("Temp", 2.27 * GB), n("Docker", 12 * GB), n("Google", 6 * GB)]), n("Roaming", 8.2 * GB)]),
      n("Downloads", 21.4 * GB),
      n("Videos", 14.8 * GB),
      n("Documents", 6.1 * GB),
      n("Pictures", 5.2 * GB),
    ]),
  ]),
  n("Program Files", 65.1 * GB, [n("Steam", 30 * GB), n("Adobe", 18 * GB), n("Microsoft Office", 5 * GB), n("Common Files", 1.2 * GB)]),
  n("Windows", 38.1 * GB, [n("WinSxS", 9.1 * GB), n("System32", 10.4 * GB), n("Temp", 0.86 * GB), n("SoftwareDistribution", 3.2 * GB)]),
  n("ProgramData", 14.8 * GB, [n("Package Cache", 4 * GB), n("NVIDIA Corporation", 2.5 * GB)]),
  n("Program Files (x86)", 5.8 * GB, [n("Steam", 3 * GB), n("Microsoft", 1.5 * GB)]),
  n("$Recycle.Bin", 2.7 * GB),
  n("adobeTemp", 657.3 * MB),
  n("Python312", 223 * MB),
], 35.1 * GB);

const find = (path: string[]): MNode | null => {
  let cur: MNode | undefined = TREE;
  for (const name of path) cur = cur?.kids?.find((k) => k.name.toLowerCase() === name.toLowerCase());
  return cur ?? null;
};

const view = (x: MNode): NodeView => ({
  name: x.name,
  size: Math.round(x.size),
  allocated: Math.round(x.size * 1.006),
  files: Math.round(x.size / (300 * 1024)),
  dirs: x.kids ? x.kids.length * 12 : 0,
  ownSize: Math.round(x.own ?? (x.kids ? 0 : x.size)),
  ownFiles: x.kids ? 0 : Math.round(x.size / (300 * 1024)),
  cloudSize: 0,
  cloudFiles: 0,
  hasChildren: !!x.kids?.length,
});

const SUMMARY: ScanSummary = {
  rootPath: "C:\\",
  size: Math.round(TREE.size),
  allocated: Math.round(TREE.size * 1.006),
  files: 816_792,
  dirs: 235_903,
  cloudSize: 0,
  cloudFiles: 0,
  errors: 0,
  hardlinkDupes: 3526,
  clusterSize: 4096,
  elapsedMs: 7400,
  cancelled: false,
};

const DUPES: DupGroup[] = [
  { size: Math.round(1.4 * GB), wasted: Math.round(1.4 * GB), files: [{ path: "C:\\Users\\demo\\Downloads\\movie.mkv", modified: 1700000000 }, { path: "C:\\Users\\demo\\Videos\\movie copy.mkv", modified: 1710000000 }] },
  { size: Math.round(600 * MB), wasted: Math.round(1200 * MB), files: [{ path: "C:\\Games\\a\\pack.pak", modified: 1690000000 }, { path: "C:\\Games\\b\\pack.pak", modified: 1695000000 }, { path: "D:\\backup\\pack.pak", modified: 1699000000 }] },
];
let dupeGroups: DupGroup[] | null = null;
let dupeTimer: number | undefined;
let onDupeProgress: ((p: DupeProgress) => void) | null = null;
let onDupeDone: ((d: DupeDone) => void) | null = null;

let timer: number | undefined;
let last = false;
let onProgress: ((p: ScanProgress) => void) | null = null;
let onDone: ((d: ScanDone) => void) | null = null;

export const mockScanner = {
  listDrives: async (): Promise<DriveInfo[]> => [
    { letter: "C", root: "C:\\", kind: "fixed", total: 952 * GB, free: 690 * GB },
    { letter: "I", root: "I:\\", kind: "fixed", total: 1014 * GB, free: 351 * GB },
    { letter: "R", root: "R:\\", kind: "fixed", total: 1014 * GB, free: 351 * GB },
  ],
  start: async (path: string) => {
    let i = 0;
    window.clearInterval(timer);
    timer = window.setInterval(() => {
      i++;
      const f = i / 12;
      onProgress?.({ files: Math.round(f * 816_792), dirs: Math.round(f * 235_903), bytes: Math.round(f * TREE.size), errors: 0, current: `${path}Users\\ArmZ\\AppData\\Local\\Temp\\${i}` });
      if (i >= 12) {
        window.clearInterval(timer);
        last = true;
        onDone?.({ ...SUMMARY, rootPath: path });
      }
    }, 150);
  },
  cancel: async () => {
    window.clearInterval(timer);
    onDone?.({ ...SUMMARY, cancelled: true });
  },
  children: async (path: string[]): Promise<Children> => {
    const node = find(path);
    if (!last || !node) throw new Error("no scan result yet");
    return { node: view(node), children: (node.kids ?? []).map(view), rest: null };
  },
  overview: async (): Promise<Overview> => ({
    topFiles: [
      { path: "C:\\hiberfil.sys", size: 12.45 * GB, allocated: 12.45 * GB },
      { path: "C:\\Users\\ArmZ\\AppData\\Roaming\\Claude\\vm_bundles\\rootfs.vhdx", size: 8.46 * GB, allocated: 8.46 * GB },
      { path: "C:\\pagefile.sys", size: 5 * GB, allocated: 5 * GB },
      { path: "C:\\Users\\ArmZ\\Videos\\render.mp4", size: 3.1 * GB, allocated: 3.1 * GB },
    ].map((f) => ({ ...f, size: Math.round(f.size), allocated: Math.round(f.allocated) })),
    extensions: [
      { ext: "dll", files: 60566, size: 61.3 * GB, allocated: 61.5 * GB },
      { ext: "exe", files: 8428, size: 28.8 * GB, allocated: 28.9 * GB },
      { ext: "vhdx", files: 10, size: 23.5 * GB, allocated: 23.5 * GB },
      { ext: "sys", files: 2903, size: 18.8 * GB, allocated: 18.8 * GB },
      { ext: "mp4", files: 120, size: 14.8 * GB, allocated: 14.8 * GB },
      { ext: "", files: 82785, size: 10.7 * GB, allocated: 11 * GB },
    ].map((e) => ({ ...e, size: Math.round(e.size), allocated: Math.round(e.allocated) })),
  }),
  oldFiles: async (): Promise<OldFile[]> => {
    const yr = 365 * 86400;
    const now = Math.floor(Date.now() / 1000);
    return [
      { path: "C:\\Users\\demo\\Videos\\2021-trip.mp4", size: 4.2 * GB, modified: now - 3.4 * yr },
      { path: "C:\\Users\\demo\\Downloads\\old-installer.iso", size: 2.9 * GB, modified: now - 2.1 * yr },
      { path: "C:\\Users\\demo\\Documents\\backup-2022.zip", size: 1.1 * GB, modified: now - 1.6 * yr },
    ].map((f) => ({ ...f, size: Math.round(f.size), allocated: Math.round(f.size), modified: Math.round(f.modified) }));
  },
  dupesStart: async () => {
    let i = 0;
    window.clearInterval(dupeTimer);
    dupeTimer = window.setInterval(() => {
      i++;
      onDupeProgress?.({ stage: i < 4 ? 1 : 2, done: i * 20, total: 120, bytes: i * 400 * MB });
      if (i >= 6) {
        window.clearInterval(dupeTimer);
        dupeGroups = DUPES;
        onDupeDone?.({ groups: DUPES.length, wasted: DUPES.reduce((s, g) => s + g.wasted, 0), cancelled: false });
      }
    }, 250);
  },
  dupesCancel: async () => {
    window.clearInterval(dupeTimer);
    onDupeDone?.({ groups: 0, wasted: 0, cancelled: true });
  },
  dupesResult: async (): Promise<DupGroup[]> => {
    if (!dupeGroups) throw new Error("no duplicate search result yet");
    return dupeGroups;
  },
  onDupesProgress: async (cb: (p: DupeProgress) => void) => {
    onDupeProgress = cb;
    return () => {
      onDupeProgress = null;
    };
  },
  onDupesDone: async (cb: (d: DupeDone) => void) => {
    onDupeDone = cb;
    return () => {
      onDupeDone = null;
    };
  },
  quarantine: async (list: "old" | "dupes", paths: string[]): Promise<CleanResult> => {
    const id = nextMockId();
    const bytes = paths.length * 700 * MB;
    mockEvents.unshift({ id, ts: Math.floor(Date.now() / 1000), kind: "clean", state: "active", heldFiles: paths.length, heldBytes: bytes, params: { files: paths.length, bytes, skippedFiles: 0, categories: [list === "old" ? "old_files" : "duplicates"] } });
    return { eventId: id, movedFiles: paths.length, movedBytes: bytes, skippedFiles: 0, skippedBytes: 0, categories: [] };
  },
  history: async (_root: string): Promise<History> => {
    const now = Math.floor(Date.now() / 1000);
    return {
      snapshots: [
        { id: 3, ts: now - 600, size: 232.3 * GB, allocated: 233 * GB, files: 816792, dirs: 235903 },
        { id: 2, ts: now - 7 * 86400, size: 224.1 * GB, allocated: 225 * GB, files: 800120, dirs: 231000 },
        { id: 1, ts: now - 21 * 86400, size: 230.9 * GB, allocated: 231 * GB, files: 811000, dirs: 233500 },
      ].map((s) => ({ ...s, size: Math.round(s.size), allocated: Math.round(s.allocated) })),
      growth: { since: now - 7 * 86400, delta: Math.round(8.2 * GB), drivers: [{ path: "Users\\ArmZ\\Downloads", delta: Math.round(5.1 * GB) }, { path: "ProgramData", delta: Math.round(2.4 * GB) }] },
    };
  },
  reveal: async (_path: string) => {},
  pickFolder: async (): Promise<string | null> => null,
  onProgress: async (cb: (p: ScanProgress) => void) => {
    onProgress = cb;
    return () => {
      onProgress = null;
    };
  },
  onDone: async (cb: (d: ScanDone) => void) => {
    onDone = cb;
    return () => {
      onDone = null;
    };
  },
};

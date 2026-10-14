import { l, type L } from "../i18n";

export type Kind = "safe" | "check" | "lock" | "info";
export type Label = { kind: Kind; badge: L; note: L; canDelete: boolean };

/** กฎป้าย ลบได้ / ตรวจสอบก่อน / ห้ามลบ (WeClean_Plan.md 4.1 ข้อ 4) — ข้อแรกที่ตรงจะถูกใช้ */
const RULES: [RegExp, Label][] = [
  [
    /^[a-z]:\\windows\\(temp|softwaredistribution\\download|minidump)(\\|$)/,
    { kind: "safe", canDelete: true, badge: l("ลบได้", "Safe to delete"), note: l("ไฟล์ชั่วคราว/แคชของ Windows — ลบได้ ระบบจะสร้างใหม่เองเมื่อจำเป็น (แนะนำให้ล้างผ่านหน้า ล้างขยะ)", "Temporary files and caches of Windows — safe to delete, they are rebuilt when needed (cleaning from the Cleaner page is recommended)") },
  ],
  [
    /^[a-z]:\\windows(\\|$)/,
    { kind: "lock", canDelete: false, badge: l("ห้ามลบ", "Protected"), note: l("ไฟล์ของระบบปฏิบัติการ — ส่วนที่ลบได้อย่างปลอดภัย (เช่นแคช Windows Update) ล้างได้ที่หน้า ล้างขยะ", "Operating system files — the parts that are safe to remove (like the Windows Update cache) can be cleaned on the Cleaner page") },
  ],
  [
    /^[a-z]:\\(system volume information|recovery|boot|efi|\$winreagent|config\.msi)(\\|$)/,
    { kind: "lock", canDelete: false, badge: l("ห้ามลบ", "Protected"), note: l("โฟลเดอร์ที่ระบบใช้ (กู้คืน/บูต/จุดคืนค่า) — การลบอาจทำให้เปิดเครื่องไม่ติด", "A folder Windows relies on (recovery, boot, restore points) — deleting it may stop the PC from starting") },
  ],
  [
    /^[a-z]:\\\$recycle\.bin(\\|$)/,
    { kind: "safe", canDelete: true, badge: l("ลบได้", "Safe to delete"), note: l("ถังขยะของ Windows — ล้างได้เลยถ้าแน่ใจว่าไม่ต้องการไฟล์ข้างในแล้ว", "The Windows Recycle Bin — empty it if you are sure you no longer need what is inside") },
  ],
  [
    /\\appdata\\local\\temp(\\|$)/,
    { kind: "safe", canDelete: true, badge: l("ลบได้", "Safe to delete"), note: l("ไฟล์ชั่วคราวของโปรแกรมต่างๆ — ปิดโปรแกรมก่อนแล้วลบได้ ไฟล์ที่ยังใช้งานอยู่จะถูกข้าม", "Temporary files from your programs — close them first, then it is safe to delete; files in use are skipped") },
  ],
  [
    /\\appdata\\local\\(google\\chrome|microsoft\\edge|mozilla)\\.*\\(cache|code cache|gpucache)$/,
    { kind: "safe", canDelete: true, badge: l("ลบได้", "Safe to delete"), note: l("แคชเบราว์เซอร์ — ลบแล้วเว็บอาจโหลดช้าลงครั้งแรก ไม่แตะรหัสผ่านและคุกกี้", "Browser cache — sites may load slower once; passwords and cookies are untouched") },
  ],
  [
    /^[a-z]:\\[^\\]*temp$/,
    { kind: "safe", canDelete: true, badge: l("ลบได้", "Safe to delete"), note: l("โฟลเดอร์ไฟล์ชั่วคราว — ปิดโปรแกรมที่เกี่ยวข้องก่อนแล้วลบได้อย่างปลอดภัย", "A temporary-files folder — close the related programs first, then it is safe to delete") },
  ],
  [
    /^[a-z]:\\program files( \(x86\))?(\\|$)/,
    { kind: "info", canDelete: false, badge: l("ถอนการติดตั้งแทน", "Uninstall instead"), note: l("ลบโฟลเดอร์โปรแกรมตรงๆ จะทำให้โปรแกรมพัง — ใช้ \"ถอนการติดตั้ง\" ของ Windows แทน", "Deleting a program folder directly breaks the program — use Windows \"Uninstall\" instead") },
  ],
  [
    /\\downloads$/,
    { kind: "check", canDelete: true, badge: l("ตรวจสอบก่อน", "Check first"), note: l("ไฟล์ที่ดาวน์โหลดมา — ดูก่อนว่ามีตัวติดตั้งหรือไฟล์ใหญ่ที่ไม่ใช้แล้วหรือเปล่า แล้วลบทีละไฟล์", "Files you downloaded — look for installers or big files you no longer need, then delete them one by one") },
  ],
  [
    /^[a-z]:\\users(\\[^\\]+)?$/,
    { kind: "check", canDelete: false, badge: l("ตรวจสอบก่อน", "Check first"), note: l("มีไฟล์ส่วนตัว เช่น Downloads, Videos, AppData — ซูมเข้าไปหาไฟล์ใหญ่ที่ไม่ใช้แล้ว แล้วลบทีละไฟล์", "Holds personal files such as Downloads, Videos and AppData — zoom in, find big files you no longer use and delete them one by one") },
  ],
  [
    /^[a-z]:\\programdata(\\|$)/,
    { kind: "check", canDelete: false, badge: l("ตรวจสอบก่อน", "Check first"), note: l("ข้อมูลที่โปรแกรมใช้ร่วมกัน บางส่วนเป็นแคชที่ล้างได้ — แสดงเฉพาะส่วนที่ปลอดภัยในหน้า ล้างขยะ", "Data shared by programs, partly caches that can be cleared — only the safe parts are listed on the Cleaner page") },
  ],
];

const GENERIC: Label = {
  kind: "info",
  canDelete: true,
  badge: l("ทั่วไป", "General"),
  note: l("WeakClean ยังไม่รู้จักโฟลเดอร์นี้ — ถ้าลบ จะย้ายลงถังขยะให้ก่อนเสมอ เปลี่ยนใจกู้คืนได้", "WeakClean doesn't recognize this folder — if you delete it, it goes to the Recycle Bin first so you can restore it"),
};

/** ป้ายของ path เต็ม (เช่น C:\Users\ArmZ\Downloads) */
export function classify(fullPath: string): Label {
  const p = fullPath.toLowerCase().replace(/\\+$/, "");
  return RULES.find(([re]) => re.test(p))?.[1] ?? GENERIC;
}

/** ต่อ path เต็มจาก root + รายชื่อโฟลเดอร์ (root ของไดรฟ์ได้ "C:\\" เสมอ) */
export function joinPath(root: string, names: string[]): string {
  const base = root.replace(/\\+$/, "");
  if (names.length > 0) return [base, ...names].join("\\");
  return /^[a-z]:$/i.test(base) ? base + "\\" : base;
}

import { l, type L } from "../i18n";
import { formatBytes, type DriveInfo } from "./tauri";

/*
 * คะแนนสุขภาพเครื่อง 0–100 (WeClean_Plan.md หัวข้อ 4.5) คิดจากของจริงในเครื่อง ไม่ใช่ตัวเลขสุ่ม
 * เริ่มที่ 100 แล้วหักตามปัจจัย แต่ละปัจจัยบอกได้ว่าหักเท่าไรและเพราะอะไร
 */

export type Factor = { id: "space" | "junk" | "tweaks" | "drift"; label: L; detail: L; lost: number; max: number };

export type HealthInput = {
  drive: DriveInfo | undefined;
  /** ขนาดขยะที่ล้างได้อย่างปลอดภัย (ไบต์) — undefined = ยังตรวจไม่เสร็จ */
  cleanableBytes: number | undefined;
  /** รายการปรับแต่งในโปรไฟล์ "สมดุล" ที่ยังไม่ได้ใช้ */
  unappliedBalanced: number | undefined;
  /** รายการที่เคยใช้แต่ถูก Windows คืนค่า */
  drifted: number | undefined;
};

const GB = 1024 ** 3;

export function computeHealth(i: HealthInput): { score: number; factors: Factor[]; ready: boolean } {
  const factors: Factor[] = [];

  if (i.drive) {
    const freePct = (i.drive.free / i.drive.total) * 100;
    const lost = freePct >= 30 ? 0 : freePct >= 20 ? 5 : freePct >= 10 ? 15 : 30;
    const p = Math.round(freePct);
    factors.push({ id: "space", max: 30, lost, label: l(`พื้นที่ว่างในไดรฟ์ ${i.drive.letter}:`, `Free space on drive ${i.drive.letter}:`), detail: l(`ว่าง ${p}% (${formatBytes(i.drive.free)})`, `${p}% free (${formatBytes(i.drive.free)})`) });
  }
  if (i.cleanableBytes !== undefined) {
    const b = i.cleanableBytes;
    const lost = b < 0.5 * GB ? 0 : b < 2 * GB ? 5 : b < 5 * GB ? 10 : b < 10 * GB ? 15 : 20;
    factors.push({ id: "junk", max: 20, lost, label: l("ขยะที่ล้างได้อย่างปลอดภัย", "Junk that can be safely cleaned"), detail: l(`${formatBytes(b)}`, `${formatBytes(b)}`) });
  }
  if (i.unappliedBalanced !== undefined) {
    const n = i.unappliedBalanced;
    factors.push({ id: "tweaks", max: 20, lost: Math.min(20, n * 3), label: l("การปรับแต่งที่ปลอดภัยและยังไม่ได้ใช้", "Safe tweaks you haven't applied yet"), detail: l(`${n} รายการ`, `${n} items`) });
  }
  if (i.drifted !== undefined) {
    const n = i.drifted;
    factors.push({ id: "drift", max: 10, lost: Math.min(10, n * 5), label: l("การปรับแต่งที่ Windows คืนค่า", "Tweaks reverted by Windows"), detail: l(`${n} รายการ`, `${n} items`) });
  }

  const score = Math.max(0, 100 - factors.reduce((s, f) => s + f.lost, 0));
  // ต้องรู้ครบทุกปัจจัยก่อน ถึงจะแสดงคะแนน (ไม่โชว์ 100 ปลอมระหว่างกำลังตรวจ)
  return { score, factors, ready: factors.length === 4 };
}

export function healthTone(score: number): { tone: "safe" | "warn" | "danger"; label: L; title: L } {
  if (score >= 85) return { tone: "safe", label: l("สุขภาพดี", "Healthy"), title: l("เครื่องของคุณอยู่ในเกณฑ์ดี", "Your PC is in good shape") };
  if (score >= 65) return { tone: "warn", label: l("พอใช้", "Fair"), title: l("เครื่องยังปรับปรุงได้อีก", "Your PC can still be improved") };
  return { tone: "danger", label: l("ควรดูแล", "Needs care"), title: l("เครื่องควรได้รับการดูแล", "Your PC needs some care") };
}

import { useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { classify } from "../../lib/classify";
import { formatBytes, scanner, type CleanResult } from "../../lib/tauri";
import { l, useI18n } from "../../i18n";

export type DeleteTarget = { path: string; name: string; size: number };

type Props = {
  /** null = ไม่ได้เปิดอยู่ */
  target: DeleteTarget | null;
  onClose: () => void;
  /** เรียกเมื่อย้ายสำเร็จจริง — หน้าจอที่เรียกต้องเอารายการนั้นออกจากลิสต์และยอดรวม */
  onDone: (target: DeleteTarget, result: CleanResult) => void;
};

/**
 * กล่องยืนยันก่อนลบในหน้า พื้นที่ดิสก์ — ผู้ใช้กดลบเองได้ แต่ต้องยืนยันทุกครั้ง
 * ของจะถูก "ย้าย" เข้าที่กักกันของ WeakClean (ไม่ได้ลบถาวร) จึงกู้คืนได้เสมอ
 */
export function ConfirmDelete({ target, onClose, onDone }: Props) {
  const { t, tr } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const label = target ? classify(target.path) : null;
  // ป้ายที่ควรเตือนก่อนลบ เช่น โฟลเดอร์โปรแกรม (ควรถอนการติดตั้งแทน) หรือโฟลเดอร์ที่ต้องตรวจสอบก่อน
  const warn = !!label && (label.kind === "check" || (label.kind === "info" && !label.canDelete));

  const run = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const r = await scanner.removePaths([target.path]);
      if (r.movedFiles === 0) {
        toast(tr(l(`ย้าย "${target.name}" ไม่ได้ · อาจถูกใช้งานอยู่ หรือไม่มีสิทธิ์`, `Couldn't move "${target.name}" · it may be in use, or needs admin rights`)));
      } else {
        toast(tr(l(`ย้าย "${target.name}" (${formatBytes(r.movedBytes)}) เข้าที่กักกันแล้ว · กู้คืนได้ที่หน้า ประวัติ & กู้คืน`, `Moved "${target.name}" (${formatBytes(r.movedBytes)}) to quarantine · restore it from History & Restore`)));
        onDone(target, r);
      }
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <Dialog open={!!target} onClose={() => !busy && onClose()} labelledBy="delete-title">
      <h2 id="delete-title" className="m-0 font-display text-2xl font-medium break-words">
        {target ? tr(l(`ต้องการลบ "${target.name}" จริงๆ ใช่ไหม`, `Really delete "${target.name}"?`)) : ""}
      </h2>
      <p className="m-0 text-sm leading-relaxed text-info-fg">
        {target
          ? tr(
              l(
                `${formatBytes(target.size)} จะถูก "ย้าย" เข้าที่กักกันของ WeakClean · ไม่ได้ลบถาวร กู้คืนได้ที่หน้า ประวัติ & กู้คืน · พื้นที่บนดิสก์จะคืนก็ต่อเมื่อครบกำหนดเก็บ หรือกด "ล้างที่กักกัน" ในหน้าตั้งค่า`,
                `${formatBytes(target.size)} moves into WeakClean's quarantine · nothing is deleted for good. Restore it from History & Restore. Disk space comes back after the retention period, or when you purge the quarantine in Settings.`,
              ),
            )
          : ""}
      </p>
      {warn && label && <p className="m-0 rounded-2xl bg-warn-bg px-4 py-3 text-sm leading-relaxed text-warn-fg">{tr(label.note)}</p>}
      <div className="mt-1 flex justify-end gap-2.5">
        <button type="button" onClick={onClose} className="min-h-[50px] rounded-full border border-edge bg-surface px-6 text-[15px] transition-colors hover:bg-hover">
          {t.cancel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run()}
          className="inline-flex min-h-[50px] items-center gap-2 rounded-full bg-danger-fg px-[26px] text-[15px] font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {busy ? <LoaderCircle size={17} strokeWidth={2.2} className="animate-spin" aria-hidden="true" /> : <Trash2 size={17} strokeWidth={2.1} aria-hidden="true" />}
          {tr(l("ลบ (ย้ายเข้าที่กักกัน)", "Delete (move to quarantine)"))}
        </button>
      </div>
    </Dialog>
  );
}

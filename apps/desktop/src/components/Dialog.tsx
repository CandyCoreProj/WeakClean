import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  /** id ของหัวข้อภายใน dialog (aria-labelledby) */
  labelledBy: string;
  children: ReactNode;
};

/** หน้าต่างยืนยัน — ใช้ <dialog> ของเบราว์เซอร์ จึงได้ focus trap, ปุ่ม Esc และฉากหลังมาฟรี */
export function Dialog({ open, onClose, labelledBy, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto w-[520px] max-w-[calc(100vw-48px)] rounded-[30px] border-0 bg-surface p-0 text-ink shadow-[0_30px_70px_rgba(20,60,140,0.35)] backdrop:bg-[rgba(26,60,120,0.35)] backdrop:backdrop-blur-sm"
    >
      {open && <div className="flex flex-col gap-4 p-7">{children}</div>}
    </dialog>
  );
}

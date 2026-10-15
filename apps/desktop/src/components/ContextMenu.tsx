import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type MenuAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** บรรทัดอธิบายใต้ชื่อ — ใช้บอกว่าทำไมรายการนี้กดไม่ได้ */
  hint?: string;
  /** การกระทำที่เอาของออกจากเครื่อง */
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

type Props = {
  /** ตำแหน่งเคอร์เซอร์ตอนคลิกขวา (พิกัดหน้าจอ) */
  x: number;
  y: number;
  /** ชื่อของสิ่งที่คลิกขวา — ใช้เป็น aria-label ของเมนู */
  label: string;
  actions: MenuAction[];
  onClose: () => void;
};

/**
 * เมนูคลิกขวาของแอป — ใช้แทนเมนูของ WebView2 (Back / Refresh / Save as) ที่ไม่เกี่ยวกับงานเราเลย
 * ลูกศรขึ้น-ลงเลือก · Enter ยืนยัน · Esc หรือคลิกนอกเมนูปิด · ลอยอยู่ใน portal จึงไม่ถูกกรอบที่เลื่อนอยู่ตัด
 */
export function ContextMenu({ x, y, label, actions, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  // วัดขนาดจริงก่อน จึงค่อยขยับไม่ให้ล้นจอ — ยังไม่วัดคือซ่อนไว้ กันเมนูโผล่ผิดที่แล้วกระโดด
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAt({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y, actions.length]);

  useEffect(() => {
    const el = box.current;
    el?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const bail = () => close.current();
    /** คลิกที่อื่น (รวมคลิกขวาที่อื่น) = ปิดเมนูนี้ */
    const outside = (ev: PointerEvent) => {
      if (!(ev.target instanceof Node) || !el?.contains(ev.target)) bail();
    };
    const esc = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === "Escape") bail();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", esc);
    // เลื่อน/ย่อ/สลับหน้าต่าง = เมนูค้างจะชี้ไปผิดที่
    window.addEventListener("resize", bail);
    window.addEventListener("blur", bail);
    document.addEventListener("scroll", bail, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("resize", bail);
      window.removeEventListener("blur", bail);
      document.removeEventListener("scroll", bail, true);
    };
  }, []);

  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const step = ev.key === "ArrowDown" ? 1 : -1;
      items[(i + step + items.length) % items.length].focus();
    } else if (ev.key === "Home" || ev.key === "End") {
      ev.preventDefault();
      items[ev.key === "Home" ? 0 : items.length - 1].focus();
    } else if (ev.key === "Tab") {
      ev.preventDefault();
      close.current();
    }
  };

  return createPortal(
    <div
      ref={box}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      onContextMenu={(ev) => ev.preventDefault()}
      style={{ left: at?.left ?? x, top: at?.top ?? y, visibility: at ? "visible" : "hidden" }}
      className="fixed z-[70] flex min-w-[248px] max-w-[330px] flex-col gap-0.5 rounded-[20px] border border-edge bg-surface p-1.5 shadow-[0_18px_44px_rgba(10,50,140,0.3)]"
    >
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          role="menuitem"
          disabled={a.disabled}
          title={a.hint}
          onClick={() => {
            a.onSelect();
            close.current();
          }}
          className={`flex w-full items-start gap-2.5 rounded-[13px] px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
            a.danger ? "text-danger-fg hover:bg-danger-bg disabled:hover:bg-transparent" : "text-ink hover:bg-hover disabled:hover:bg-transparent"
          }`}
        >
          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center ${a.danger ? "" : "text-muted"}`} aria-hidden="true">
            {a.icon}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-medium">{a.label}</span>
            {a.hint && <span className="text-xs leading-snug text-muted">{a.hint}</span>}
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

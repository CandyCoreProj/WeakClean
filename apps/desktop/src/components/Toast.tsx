import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";

const ToastContext = createContext<(msg: string) => void>(() => {});

/** ข้อความลอยสั้นๆ ด้านล่างจอ — หายเองใน 3 วินาที */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 3000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-6">
        {msg && <div className="rounded-full border border-white/10 bg-toast px-5 py-3 text-sm font-medium text-toast-fg shadow-float">{msg}</div>}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** handler สำหรับปุ่มที่ยังไม่มีฝั่ง Rust รองรับ */
export function useSoon() {
  const show = useToast();
  const { t } = useI18n();
  return useCallback(() => show(t.soon), [show, t.soon]);
}

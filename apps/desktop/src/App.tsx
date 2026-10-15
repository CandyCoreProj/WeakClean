import { useEffect, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { HomePage } from "./pages/HomePage";
import { SpacePage } from "./pages/SpacePage";
import { CleanerPage } from "./pages/CleanerPage";
import { BoostPage } from "./pages/BoostPage";
import { SafetyPage } from "./pages/SafetyPage";
import { SettingsPage } from "./pages/SettingsPage";
import { CommandPalette } from "./components/CommandPalette";
import { rescanCleaner } from "./lib/cleanerStore";
import { background } from "./lib/tauri";
import type { PageId } from "./i18n";
import { PAGES } from "./pages";

function readPage(): PageId {
  try {
    const v = localStorage.getItem("weakclean.page");
    return PAGES.some((p) => p.id === v) || v === "settings" ? (v as PageId) : "home";
  } catch {
    return "home";
  }
}

export default function App() {
  const [page, setPage] = useState<PageId>(readPage);
  const mainRef = useRef<HTMLElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  // Ctrl+K เปิด/ปิดช่องค้นหาจากทุกหน้า
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // เมนูคลิกขวาของเบราว์เซอร์ (Back / Refresh / Save as / Print) ไม่เกี่ยวกับงานในแอปนี้เลย —
  // ปิดทั้งแอปแล้วให้แต่ละหน้าเปิดเมนูของตัวเอง (ดู components/ContextMenu.tsx)
  // ยกเว้นช่องกรอกข้อความ ที่ยังต้องใช้เมนู วาง/คัดลอก ของระบบ
  useEffect(() => {
    const onMenu = (ev: MouseEvent) => {
      if (ev.target instanceof Element && ev.target.closest("input, textarea, [contenteditable='true']")) return;
      ev.preventDefault();
    };
    document.addEventListener("contextmenu", onMenu);
    return () => document.removeEventListener("contextmenu", onMenu);
  }, []);

  // การ์ดเตือน (หรือเมนูในถาดระบบ) สั่งให้พาไปหน้า ล้างขยะ แล้วสแกนหาขยะใหม่ให้เลย
  useEffect(() => {
    let off: (() => void) | undefined;
    void background
      .onCleanRequested(() => {
        setPage("cleaner");
        void rescanCleaner();
      })
      .then((unlisten) => (off = unlisten));
    return () => off?.();
  }, []);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    try {
      localStorage.setItem("weakclean.page", page);
    } catch {
      /* ไม่เป็นไร */
    }
  }, [page]);

  return (
    <div className="flex h-full flex-col bg-app">
      <TitleBar onOpenSearch={() => setSearchOpen(true)} />
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} onNavigate={setPage} />
      <div className="flex min-h-0 flex-1">
        <Sidebar current={page} onNavigate={setPage} />
        <main ref={mainRef} className="scroll min-w-0 flex-1 overflow-y-auto">
          {page === "home" && <HomePage onNavigate={setPage} />}
          {page === "space" && <SpacePage onNavigate={setPage} />}
          {page === "cleaner" && <CleanerPage onNavigate={setPage} />}
          {page === "boost" && <BoostPage onNavigate={setPage} />}
          {page === "safety" && <SafetyPage />}
          {page === "settings" && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { background } from "./lib/tauri";

export type Lang = "th" | "en";
export type PageId = "home" | "space" | "cleaner" | "boost" | "safety" | "settings";

/** ข้อความสองภาษาในที่เดียว — ใช้กับข้อมูลที่อยู่ในไฟล์หน้า/ข้อมูลตัวอย่าง แล้วแปลด้วย tr() */
export type L = { th: string; en: string };
export const l = (th: string, en: string): L => ({ th, en });
/** ข้อความที่ภาษาไทยกับอังกฤษเหมือนกัน เช่น ชื่อโฟลเดอร์ */
export const same = (s: string): L => ({ th: s, en: s });

type PageText = { nav: string; title: string; subtitle: string };

export type Dict = {
  search: string;
  minimize: string;
  maximize: string;
  close: string;
  language: string;
  menu: string;
  settings: string;
  /** แสดงเมื่อกดปุ่มที่ฝั่ง Rust ยังไม่พร้อม (ระหว่างพัฒนา) */
  soon: string;
  cancel: string;
  pages: Record<PageId, PageText>;
};

const th: Dict = {
  search: "ค้นหาไฟล์หรือฟีเจอร์ · Ctrl+K",
  minimize: "ย่อหน้าต่าง",
  maximize: "ขยายหน้าต่าง",
  close: "ปิดโปรแกรม",
  language: "ภาษา",
  menu: "เมนูหลัก",
  settings: "ตั้งค่า",
  soon: "ปุ่มนี้ยังเป็นแค่หน้าตา — จะใช้งานได้เมื่อทำฝั่ง Rust เสร็จ",
  cancel: "ยกเลิก",
  pages: {
    home: { nav: "หน้าแรก", title: "ภาพรวมเครื่อง", subtitle: "คะแนนสุขภาพ ไดรฟ์ และสิ่งที่ควรทำ" },
    space: { nav: "พื้นที่ดิสก์", title: "พื้นที่ดิสก์", subtitle: "ดูว่าอะไรกินพื้นที่ แล้วจัดการได้ในคลิกเดียว" },
    cleaner: {
      nav: "ล้างขยะ",
      title: "ล้างขยะ",
      subtitle: "สแกนเสร็จแล้ว · เราเลือกเฉพาะหมวดที่ปลอดภัยไว้ให้ ติ๊กเพิ่มหรือเอาออกได้ตามใจ",
    },
    boost: { nav: "เร่งความเร็ว", title: "เร่งความเร็ว", subtitle: "เลือกโปรไฟล์เดียวจบ หรือปรับเองทีละสวิตช์ — ทุกอย่างย้อนกลับได้" },
    safety: { nav: "ประวัติ & กู้คืน", title: "ประวัติ & กู้คืน", subtitle: "ทุกอย่างที่ WeakClean เคยทำอยู่ที่นี่ — ย้อนกลับได้ทีละรายการ" },
    settings: { nav: "ตั้งค่า", title: "ตั้งค่า", subtitle: "ภาษา ธีม และข้อมูลของโปรแกรม" },
  },
};

const en: Dict = {
  search: "Search files or features · Ctrl+K",
  minimize: "Minimize",
  maximize: "Maximize",
  close: "Close",
  language: "Language",
  menu: "Main menu",
  settings: "Settings",
  soon: "This button is UI only for now — it will work once the Rust side is built",
  cancel: "Cancel",
  pages: {
    home: { nav: "Home", title: "PC overview", subtitle: "Health score, drives and what to do next" },
    space: { nav: "Disk space", title: "Disk space", subtitle: "See what takes up space and act on it in one click" },
    cleaner: {
      nav: "Cleaner",
      title: "Cleaner",
      subtitle: "Scan complete · only safe categories are pre-selected — tick or untick as you like",
    },
    boost: { nav: "Boost", title: "Boost", subtitle: "Pick one profile or tune each switch — everything is reversible" },
    safety: { nav: "History & Restore", title: "History & Restore", subtitle: "Everything WeakClean has done — undo any item" },
    settings: { nav: "Settings", title: "Settings", subtitle: "Language, theme and app data" },
  },
};

const DICTS: Record<Lang, Dict> = { th, en };

type I18nValue = { lang: Lang; t: Dict; tr: (x: L) => string; setLang: (l: Lang) => void };
const I18nContext = createContext<I18nValue | null>(null);

function readLang(): Lang {
  try {
    const v = localStorage.getItem("weakclean.lang");
    return v === "en" ? "en" : "th";
  } catch {
    return "th";
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(readLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem("weakclean.lang", lang);
    } catch {
      /* ไม่เป็นไร ใช้ค่าในหน่วยความจำต่อ */
    }
    // เมนูในถาดระบบของตัวช่วยเบื้องหลังวาดฝั่ง Rust จึงต้องบอกให้มันเปลี่ยนตามภาษา
    void background.setLang(lang);
  }, [lang]);

  const value = useMemo<I18nValue>(() => ({ lang, t: DICTS[lang], tr: (x) => x[lang], setLang }), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

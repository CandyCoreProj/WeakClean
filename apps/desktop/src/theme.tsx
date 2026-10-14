import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/** auto = ตามธีมของ Windows (ค่าเริ่มต้น) */
export type ThemePref = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "weakclean.theme";
const query = () => window.matchMedia("(prefers-color-scheme: dark)");

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

const resolve = (pref: ThemePref): Theme => (pref === "auto" ? (query().matches ? "dark" : "light") : pref);

type ThemeValue = { pref: ThemePref; theme: Theme; cycle: () => void; setPref: (p: ThemePref) => void };
const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<ThemePref>(readPref);
  const [theme, setTheme] = useState<Theme>(() => resolve(readPref()));

  // ติดตามธีมของ Windows เมื่อเป็นโหมดอัตโนมัติ
  useEffect(() => {
    setTheme(resolve(pref));
    if (pref !== "auto") return;
    const q = query();
    const on = () => setTheme(resolve("auto"));
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, [pref]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const value = useMemo<ThemeValue>(() => {
    const apply = (next: ThemePref) => {
      setPref(next);
      try {
        if (next === "auto") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, next);
      } catch {
        /* ไม่เป็นไร ใช้ค่าในหน่วยความจำต่อ */
      }
    };
    return { pref, theme, setPref: apply, cycle: () => apply(pref === "auto" ? "light" : pref === "light" ? "dark" : "auto") };
  }, [pref, theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

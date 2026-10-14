import { Minus, Monitor, Moon, Search, Square, Sun, X } from "lucide-react";
import { l, useI18n, type Lang } from "../i18n";
import { useTheme } from "../theme";
import { appWindow } from "../lib/tauri";
import { Logo } from "./Logo";

const winBtn =
  "flex h-9 w-11 items-center justify-center rounded-[10px] text-muted transition-colors hover:bg-hover";

export function TitleBar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const { t, tr, lang, setLang } = useI18n();
  const theme = useTheme();
  const ThemeIcon = theme.pref === "auto" ? Monitor : theme.pref === "light" ? Sun : Moon;
  const themeLabel = theme.pref === "auto" ? l("ธีม: ตามระบบ", "Theme: follow system") : theme.pref === "light" ? l("ธีม: สว่าง", "Theme: light") : l("ธีม: มืด", "Theme: dark");

  return (
    // data-tauri-drag-region = จุดที่ลากย้ายหน้าต่างได้ (ดับเบิลคลิก = ขยาย/คืนขนาด)
    <header
      data-tauri-drag-region
      className="flex h-[52px] shrink-0 items-center gap-4 border-b border-line bg-surface pl-5 pr-3"
    >
      <div data-tauri-drag-region className="flex w-[260px] items-center gap-2.5">
        <Logo />
        <span data-tauri-drag-region className="font-display text-[17px] font-medium">
          WeakClean
        </span>
      </div>

      <button
        type="button"
        onClick={onOpenSearch}
        aria-label={t.search}
        aria-keyshortcuts="Control+K"
        className="mx-auto flex h-9 max-w-[460px] flex-1 items-center gap-2.5 rounded-full bg-field px-4 text-left text-sm text-muted transition-colors hover:bg-hover"
      >
        <Search size={16} strokeWidth={2} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{t.search}</span>
      </button>

      <div data-tauri-drag-region className="flex w-[260px] items-center justify-end gap-1">
        <div role="group" aria-label={t.language} className="mr-2 flex rounded-full bg-field p-[3px]">
          {(["th", "en"] as Lang[]).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
              className={`h-[30px] min-w-11 rounded-full text-[13px] font-semibold transition-colors ${
                lang === l ? "bg-primary text-white shadow-primary" : "text-ink-soft hover:bg-surface"
              }`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <button type="button" aria-label={tr(themeLabel)} title={tr(themeLabel)} className={winBtn} onClick={theme.cycle}>
          <ThemeIcon size={16} strokeWidth={2} />
        </button>
        <button type="button" aria-label={t.minimize} className={winBtn} onClick={appWindow.minimize}>
          <Minus size={16} strokeWidth={2} />
        </button>
        <button type="button" aria-label={t.maximize} className={winBtn} onClick={appWindow.toggleMaximize}>
          <Square size={13} strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label={t.close}
          className={`${winBtn} hover:bg-[#E81123] hover:text-white`}
          onClick={appWindow.close}
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>
    </header>
  );
}

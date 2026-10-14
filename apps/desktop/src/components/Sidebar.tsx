import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useI18n, l, type PageId } from "../i18n";
import { PAGES } from "../pages";
import { getAppInfo } from "../lib/tauri";
import { defaultCleanableBytes, useCleaner } from "../lib/cleanerStore";
import { systemDrive, useDrives } from "../lib/drives";
import { formatBytes } from "../lib/tauri";

type Props = { current: PageId; onNavigate: (id: PageId) => void };

export function Sidebar({ current, onNavigate }: Props) {
  const { t, tr } = useI18n();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getAppInfo().then((info) => setVersion(info ? `v${info.version} · ${info.arch}` : "dev · browser"));
  }, []);

  const d = systemDrive(useDrives());
  const usedPct = d ? Math.round(((d.total - d.free) / d.total) * 100) : 0;
  const freePct = 100 - usedPct;
  const cleaner = useCleaner();
  const cleanBytes = defaultCleanableBytes(cleaner);
  const cleanBadge = cleaner.status === "ready" && cleanBytes > 0 ? formatBytes(cleanBytes) : null;

  return (
    <nav aria-label={t.menu} className="flex w-[236px] shrink-0 flex-col gap-1.5 border-r border-line bg-surface px-3.5 py-5">
      {PAGES.map(({ id, icon: Icon }) => {
        const active = id === current;
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onNavigate(id)}
            className={`flex min-h-[50px] items-center gap-3 rounded-2xl px-3.5 text-left text-[15px] transition-colors ${
              active ? "bg-primary font-semibold text-white shadow-primary" : "font-medium text-ink-soft hover:bg-hover"
            }`}
          >
            <Icon size={20} strokeWidth={1.9} aria-hidden="true" />
            <span className="flex-1">{t.pages[id].nav}</span>
            {id === "cleaner" && cleanBadge && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  active ? "bg-white/20 text-white" : "bg-warn-bg text-warn-fg"
                }`}
              >
                {cleanBadge}
              </span>
            )}
          </button>
        );
      })}

      <div className="flex-1" />

      {d && (
        <div className="flex flex-col gap-2 rounded-[20px] bg-soft p-4">
          <div className="flex justify-between text-[13px]">
            <span className="font-semibold">{tr(l(`ไดรฟ์ ${d.letter}:`, `Drive ${d.letter}:`))}</span>
            <span className="text-ink-soft">{tr(l(`ว่าง ${freePct}%`, `${freePct}% free`))}</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-track">
            <div className="h-full rounded bg-meter" style={{ width: `${usedPct}%` }} />
          </div>
          <span className="text-xs text-ink-soft">
            {tr(l(`ว่าง ${formatBytes(d.free)} จาก ${formatBytes(d.total)}`, `${formatBytes(d.free)} free of ${formatBytes(d.total)}`))}
          </span>
        </div>
      )}

      <button
        type="button"
        aria-current={current === "settings" ? "page" : undefined}
        onClick={() => onNavigate("settings")}
        className={`flex min-h-12 items-center gap-3 rounded-2xl px-3.5 text-left text-[15px] transition-colors ${
          current === "settings" ? "bg-primary font-semibold text-white shadow-primary" : "font-medium text-ink-soft hover:bg-hover"
        }`}
      >
        <SlidersHorizontal size={20} strokeWidth={1.9} aria-hidden="true" />
        {t.settings}
      </button>
      <span className="px-3.5 text-[11px] text-muted">{version ?? "…"}</span>
    </nav>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { Dialog } from "./Dialog";
import { useBoost } from "../lib/boostStore";
import { useCleaner } from "../lib/cleanerStore";
import { systemDrive, useDrives } from "../lib/drives";
import { startScan } from "../lib/scanStore";
import { l, useI18n, type L, type PageId } from "../i18n";
import { PAGES } from "../pages";
import { useTheme } from "../theme";

type Item = { id: string; title: string; hint: string; keywords: string; run: () => void };

type Props = { open: boolean; onClose: () => void; onNavigate: (id: PageId) => void };

/** ค้นหาฟีเจอร์ (Ctrl+K): หน้า, การกระทำที่ใช้บ่อย, หมวดขยะ และการปรับแต่งทุกรายการ — Enter เพื่อไป */
export function CommandPalette({ open, onClose, onNavigate }: Props) {
  const { t, tr, lang, setLang } = useI18n();
  const theme = useTheme();
  const cleaner = useCleaner();
  const boost = useBoost();
  const sys = systemDrive(useDrives());
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (id: PageId) => () => onNavigate(id);
    const both = (x: L) => `${x.th} ${x.en}`;
    const out: Item[] = [];
    for (const p of [...PAGES.map((x) => x.id), "settings" as PageId]) {
      out.push({ id: `page:${p}`, title: t.pages[p].nav, hint: tr(l("ไปที่หน้า", "Go to page")), keywords: `${t.pages[p].subtitle} ${p}`, run: go(p) });
    }
    const actions: { id: string; label: L; run: () => void }[] = [
      {
        id: "scan",
        label: sys ? l(`สแกนไดรฟ์ ${sys.letter}:`, `Scan drive ${sys.letter}:`) : l("สแกนพื้นที่ดิสก์", "Scan disk space"),
        run: () => {
          onNavigate("space");
          if (sys) void startScan(sys.root);
        },
      },
      { id: "dupes", label: l("หาไฟล์ซ้ำ", "Find duplicate files"), run: go("space") },
      { id: "old", label: l("หาไฟล์เก่า", "Find old files"), run: go("space") },
      { id: "undo", label: l("ย้อนกลับ / กู้คืนไฟล์", "Undo / restore files"), run: go("safety") },
      { id: "theme", label: l("สลับธีม (ตามระบบ / สว่าง / มืด)", "Switch theme (system / light / dark)"), run: theme.cycle },
      { id: "lang", label: l("เปลี่ยนภาษา (ไทย / English)", "Change language (ไทย / English)"), run: () => setLang(lang === "th" ? "en" : "th") },
    ];
    for (const a of actions) out.push({ id: `act:${a.id}`, title: tr(a.label), hint: tr(l("การกระทำ", "Action")), keywords: both(a.label), run: a.run });
    for (const c of cleaner.catalog) out.push({ id: `clean:${c.id}`, title: lang === "th" ? c.nameTh : c.nameEn, hint: tr(l("ล้างขยะ", "Cleaner")), keywords: `${c.nameTh} ${c.nameEn} ${c.descTh} ${c.descEn}`, run: go("cleaner") });
    for (const c of boost.catalog) out.push({ id: `tweak:${c.id}`, title: lang === "th" ? c.nameTh : c.nameEn, hint: tr(l("เร่งความเร็ว", "Boost")), keywords: `${c.nameTh} ${c.nameEn} ${c.descTh} ${c.descEn}`, run: go("boost") });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, t, cleaner.catalog, boost.catalog, sys, theme.cycle]);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = words.length === 0 ? items.filter((i) => i.id.startsWith("page:") || i.id.startsWith("act:")) : items.filter((i) => words.every((w) => `${i.title} ${i.keywords}`.toLowerCase().includes(w)));
    return hit.slice(0, 12);
  }, [items, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="palette-title">
      <h2 id="palette-title" className="sr-only">
        {t.search}
      </h2>
      <label className="flex h-12 items-center gap-3 rounded-full bg-field px-4 text-muted focus-within:ring-3 focus-within:ring-[#7CC4FF]">
        <Search size={18} strokeWidth={2} aria-hidden="true" />
        <input
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
          aria-label={t.search}
          placeholder={tr(l("ค้นหาหน้า ฟีเจอร์ หรือการปรับแต่ง…", "Search pages, features or tweaks…"))}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(results[active]);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
        />
      </label>
      <ul id="palette-list" ref={listRef} role="listbox" className="scroll m-0 flex max-h-[340px] list-none flex-col gap-1 overflow-y-auto p-0">
        {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{tr(l("ไม่พบรายการที่ตรงกัน", "No matches"))}</li>}
        {results.map((r, i) => (
          <li
            key={r.id}
            id={`palette-${r.id}`}
            role="option"
            aria-selected={i === active}
            onMouseMove={() => setActive(i)}
            onClick={() => choose(r)}
            className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-3.5 text-sm ${i === active ? "bg-sel" : ""}`}
          >
            <span className="min-w-0 flex-1 truncate">{r.title}</span>
            <span className="shrink-0 text-xs text-muted">{r.hint}</span>
            {i === active && <CornerDownLeft size={14} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

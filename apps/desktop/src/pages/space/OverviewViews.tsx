import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { ContextMenu, type MenuAction } from "../../components/ContextMenu";
import { useSoon } from "../../components/Toast";
import { canDeleteHere } from "../../lib/classify";
import { formatBytes, scanner, type ExtStat, type FileEntry, type Overview } from "../../lib/tauri";
import { l, useI18n, type L } from "../../i18n";
import { ConfirmDelete, type DeleteTarget } from "./DeleteDialog";

function useOverview(scanKey: string) {
  const [data, setData] = useState<{ k: string; value: Overview } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    scanner
      .overview()
      .then((value) => alive && setData({ k: scanKey, value }))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [scanKey]);
  return { value: data && data.k === scanKey ? data.value : null, failed };
}

function Box({ children }: { children: ReactNode }) {
  return <div className="rounded-card bg-surface px-6 py-14 text-center text-sm text-muted shadow-card">{children}</div>;
}

/* ───────── ประเภทไฟล์ ───────── */

type Category = { id: string; name: L; exts: string[]; color: string };

const CATEGORIES: Category[] = [
  { id: "video", name: l("วิดีโอ", "Video"), color: "#5A94F0", exts: ["mp4", "mkv", "avi", "mov", "wmv", "webm", "flv", "m4v", "ts", "mpg"] },
  { id: "audio", name: l("เสียง", "Audio"), color: "#F48FB1", exts: ["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"] },
  { id: "image", name: l("รูปภาพ", "Images"), color: "#3FC79A", exts: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "heic", "psd", "raw", "cr2", "svg", "tif", "tiff"] },
  { id: "doc", name: l("เอกสาร", "Documents"), color: "#39B5E6", exts: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "odt"] },
  { id: "installer", name: l("ตัวติดตั้งและไฟล์บีบอัด", "Installers & archives"), color: "#F2A46B", exts: ["iso", "msi", "zip", "rar", "7z", "cab", "gz", "tar", "msix", "appx", "img"] },
  { id: "vm", name: l("ดิสก์เสมือนและ Virtual Machine", "Virtual disks & VMs"), color: "#8C7CF0", exts: ["vhd", "vhdx", "vmdk", "vdi", "wim", "esd", "qcow2"] },
  { id: "system", name: l("โปรแกรมและไฟล์ระบบ", "Programs & system files"), color: "#9DAAC0", exts: ["exe", "dll", "sys", "drv", "mui", "ocx", "winmd", "cpl", "efi"] },
  { id: "dev", name: l("ไฟล์โค้ดและข้อมูลโปรเจกต์", "Code & project data"), color: "#E5C34D", exts: ["js", "mjs", "map", "json", "py", "pyc", "rs", "cs", "java", "class", "jar", "h", "cpp", "c", "lib", "obj", "pdb", "o", "a", "node", "log", "db", "sqlite", "dat"] },
];
const OTHER: Category = { id: "other", name: l("อื่นๆ", "Other"), color: "#C9D5E6", exts: [] };
const BY_EXT = new Map(CATEGORIES.flatMap((c) => c.exts.map((e) => [e, c] as const)));

export function TypesView({ scanKey }: { scanKey: string }) {
  const { tr } = useI18n();
  const { value, failed } = useOverview(scanKey);

  const rows = useMemo(() => {
    if (!value) return [];
    const acc = new Map<Category, { size: number; files: number; top: ExtStat[] }>();
    for (const e of value.extensions) {
      const cat = BY_EXT.get(e.ext) ?? OTHER;
      const a = acc.get(cat) ?? { size: 0, files: 0, top: [] };
      a.size += e.size;
      a.files += e.files;
      if (a.top.length < 3 && e.ext) a.top.push(e);
      acc.set(cat, a);
    }
    return [...acc.entries()].map(([cat, a]) => ({ cat, ...a })).sort((a, b) => b.size - a.size);
  }, [value]);

  if (failed) return <Box>{tr(l("อ่านผลสแกนไม่ได้ ลองสแกนใหม่อีกครั้ง", "Couldn't read the scan result — try scanning again"))}</Box>;
  if (!value) return <Box>{tr(l("กำลังโหลด…", "Loading…"))}</Box>;
  const max = rows[0]?.size ?? 0;

  return (
    <section aria-label={tr(l("ประเภทไฟล์", "File types"))} className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card">
      <div className="px-[22px] pt-[18px] pb-2.5">
        <h2 className="m-0 font-display text-lg font-medium">{tr(l("พื้นที่แยกตามประเภทไฟล์", "Space by file type"))}</h2>
      </div>
      {rows.map(({ cat, size, files, top }) => (
        <div key={cat.id} className="grid min-h-[60px] grid-cols-[minmax(0,2.2fr)_minmax(0,2fr)_96px_96px] items-center gap-4 border-t border-rowline px-[22px] py-2">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2.5">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: cat.color }} />
              <span className="truncate text-[15px] font-medium">{tr(cat.name)}</span>
            </span>
            {top.length > 0 && <span className="truncate pl-[22px] font-mono text-xs text-muted">{top.map((t) => `.${t.ext}`).join("  ")}</span>}
          </span>
          <span className="h-2 overflow-hidden rounded bg-track">
            <span className="block h-full rounded" style={{ width: `${max ? Math.max(0.5, (size / max) * 100) : 0}%`, background: cat.color }} />
          </span>
          <span className="text-right text-[15px] font-semibold">{formatBytes(size)}</span>
          <span className="text-right text-[13px] text-muted">{tr(l(`${files.toLocaleString("th-TH")} ไฟล์`, `${files.toLocaleString("en-US")} files`))}</span>
        </div>
      ))}
    </section>
  );
}

/* ───────── ไฟล์ใหญ่สุด ───────── */

export function TopFilesView({ scanKey }: { scanKey: string }) {
  const { tr } = useI18n();
  const soon = useSoon();
  const { value, failed } = useOverview(scanKey);
  /** เมนูคลิกขวาที่เปิดอยู่ (ตำแหน่งเคอร์เซอร์ + ไฟล์ที่คลิก) */
  const [menu, setMenu] = useState<{ x: number; y: number; file: FileEntry } | null>(null);
  /** ไฟล์ที่กำลังรอผู้ใช้ยืนยันลบ */
  const [pending, setPending] = useState<DeleteTarget | null>(null);
  /** ไฟล์ที่เพิ่งลบไปแล้ว — เอาออกจากลิสต์ทันที ไม่ต้องรอสแกนใหม่ */
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  if (failed) return <Box>{tr(l("อ่านผลสแกนไม่ได้ ลองสแกนใหม่อีกครั้ง", "Couldn't read the scan result — try scanning again"))}</Box>;
  if (!value) return <Box>{tr(l("กำลังโหลด…", "Loading…"))}</Box>;

  const files = value.topFiles.filter((f) => !removed.has(f.path));
  const nameOf = (p: string) => p.slice(p.lastIndexOf("\\") + 1);

  const menuFor = (f: FileEntry): MenuAction[] => {
    const allowed = canDeleteHere(f.path);
    return [
      { id: "reveal", label: tr(l("เปิดใน File Explorer", "Show in File Explorer")), icon: <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />, onSelect: () => void scanner.reveal(f.path).catch(soon) },
      {
        id: "delete",
        label: tr(l("ลบ…", "Delete…")),
        icon: <Trash2 size={16} strokeWidth={2} aria-hidden="true" />,
        danger: true,
        disabled: !allowed,
        hint: allowed ? tr(l("ย้ายเข้าที่กักกัน · ไม่ได้ลบถาวร", "Moves to quarantine · not permanently deleted")) : tr(l("ไฟล์ของระบบที่ลบไม่ได้", "A system file that can't be deleted")),
        onSelect: () => setPending({ path: f.path, name: nameOf(f.path), size: f.size }),
      },
    ];
  };

  return (
    <section aria-label={tr(l("ไฟล์ใหญ่สุด", "Largest files"))} className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card">
      <div className="px-[22px] pt-[18px] pb-2.5">
        <h2 className="m-0 font-display text-lg font-medium">{tr(l(`ไฟล์ใหญ่สุด ${files.length} อันดับ`, `Top ${files.length} largest files`))}</h2>
        <span className="text-[13px] text-muted">{tr(l("คลิกขวาเพื่อลบทีละไฟล์ · ของจะถูกย้ายเข้าที่กักกันก่อนเสมอ", "Right-click a file to delete it · it always moves to quarantine first"))}</span>
      </div>
      {files.map((f) => {
        const cut = f.path.lastIndexOf("\\");
        const name = f.path.slice(cut + 1);
        const dir = f.path.slice(0, cut + 1);
        return (
          <div
            key={f.path}
            onContextMenu={(ev) => {
              ev.preventDefault();
              setMenu({ x: ev.clientX, y: ev.clientY, file: f });
            }}
            className="grid min-h-[56px] grid-cols-[minmax(0,1fr)_96px_44px] items-center gap-4 border-t border-rowline px-[22px] py-1.5"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[15px] font-medium">{name}</span>
              <span className="truncate text-xs text-muted" title={f.path}>{dir}</span>
            </span>
            <span className="text-right text-[15px] font-semibold">{formatBytes(f.size)}</span>
            <button
              type="button"
              aria-label={tr(l(`เปิด ${name} ใน Explorer`, `Show ${name} in Explorer`))}
              onClick={() => void scanner.reveal(f.path).catch(soon)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover"
            >
              <ExternalLink size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        );
      })}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={tr(l(`ตัวเลือกของ ${nameOf(menu.file.path)}`, `Options for ${nameOf(menu.file.path)}`))}
          actions={menuFor(menu.file)}
          onClose={() => setMenu(null)}
        />
      )}
      <ConfirmDelete
        target={pending}
        onClose={() => setPending(null)}
        onDone={(target) => setRemoved((cur) => new Set(cur).add(target.path))}
      />
    </section>
  );
}

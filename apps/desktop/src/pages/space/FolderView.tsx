import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, ChevronRight, ExternalLink, Folder, Lock, Trash2, ZoomIn } from "lucide-react";
import { Badge, type Tone } from "../../components/Badge";
import { useSoon } from "../../components/Toast";
import { classify, joinPath, type Kind, type Label } from "../../lib/classify";
import { formatBytes, scanner, type Children, type NodeView } from "../../lib/tauri";
import { l, useI18n } from "../../i18n";
import { Treemap, type TreeItem } from "./Treemap";

const TINTS = ["#C3DBFF", "#BDEFDC", "#C6ECFB", "#DCD6FF", "#FFE0C9", "#FFD9E4", "#FFF3BF", "#D8F0A8"];
const GREY = "#E2E9F3";
const FILES_TINT = "#DCD6FF";
const MAX_TILES = 14;

const KIND_TONE: Record<Kind, Tone> = { safe: "safe", check: "warn", lock: "danger", info: "info" };
const KIND_BG: Record<Kind, string> = { safe: "bg-safe-bg", check: "bg-warn-bg", lock: "bg-danger-bg", info: "bg-info-bg" };
const KIND_FG: Record<Kind, string> = { safe: "text-safe-fg", check: "text-warn-fg", lock: "text-danger-fg", info: "text-info-fg" };

/** รายการหนึ่งในโฟลเดอร์ที่กำลังดู: โฟลเดอร์ย่อย, ไฟล์ที่อยู่ตรงๆ ในโฟลเดอร์, หรือก้อนรวมโฟลเดอร์เล็ก */
type Entry =
  | { id: string; type: "dir"; node: NodeView; tint: string }
  | { id: string; type: "files"; size: number; allocated: number; files: number; tint: string }
  | { id: string; type: "others"; size: number; allocated: number; count: number; tint: string };

const sizeOf = (e: Entry) => (e.type === "dir" ? e.node.size : e.size);

function useChildren(path: string[], key: string) {
  const pathKey = path.join("\\");
  const [data, setData] = useState<{ k: string; value: Children } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    scanner
      .children(path)
      .then((value) => alive && setData({ k: `${key}|${pathKey}`, value }))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pathKey]);
  return { value: data && data.k === `${key}|${pathKey}` ? data.value : null, failed };
}

const pctText = (part: number, whole: number) => {
  if (whole <= 0) return "0%";
  const v = (part / whole) * 100;
  return v < 1 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
};

type Props = { rootPath: string; scanKey: string };

export function FolderView({ rootPath, scanKey }: Props) {
  const { lang, tr } = useI18n();
  const soon = useSoon();
  const [path, setPath] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const { value: data, failed } = useChildren(path, scanKey);

  const entries = useMemo<Entry[]>(() => {
    if (!data) return [];
    const out: Entry[] = data.children.map((c, i) => ({ id: `d:${c.name}`, type: "dir", node: c, tint: TINTS[i % TINTS.length] }));
    if (data.rest) {
      out.push({ id: "others", type: "others", size: data.rest.size, allocated: data.rest.allocated, count: data.rest.dirs, tint: GREY });
    }
    if (data.node.ownSize > 0 || data.node.ownFiles > 0) {
      out.push({ id: "files", type: "files", size: data.node.ownSize, allocated: 0, files: data.node.ownFiles, tint: FILES_TINT });
    }
    return out.sort((a, b) => sizeOf(b) - sizeOf(a));
  }, [data]);

  const total = data?.node.size ?? 0;
  const current = entries.find((e) => e.id === selected) ?? entries[0] ?? null;
  const filesLabel = (n: number) => tr(l(`ไฟล์ในโฟลเดอร์นี้ (${n.toLocaleString("th-TH")} ไฟล์)`, `Files in this folder (${n.toLocaleString("en-US")})`));
  const titleOf = (e: Entry): string =>
    e.type === "dir" ? e.node.name : e.type === "files" ? filesLabel(e.files) : tr(l(`อื่นๆ (${e.count} โฟลเดอร์)`, `Others (${e.count} folders)`));

  // treemap แสดงรายการใหญ่สุด MAX_TILES อัน ที่เหลือรวมเป็นก้อนเทา
  const treeItems = useMemo<TreeItem[]>(() => {
    const top = entries.slice(0, MAX_TILES);
    const tail = entries.slice(MAX_TILES);
    const toItem = (e: Entry): TreeItem => ({
      id: e.id,
      value: sizeOf(e),
      title: e.type === "dir" ? e.node.name : e.type === "files" ? tr(l("ไฟล์ในโฟลเดอร์", "Files here")) : tr(l(`อื่นๆ (${e.count})`, `Others (${e.count})`)),
      sub: `${formatBytes(sizeOf(e))} · ${pctText(sizeOf(e), total)}`,
      tint: e.tint,
    });
    const items = top.map(toItem);
    if (tail.length > 0) {
      const sum = tail.reduce((s, e) => s + sizeOf(e), 0);
      items.push({ id: "tail", value: sum, title: tr(l(`อื่นๆ (${tail.length})`, `Others (${tail.length})`)), sub: `${formatBytes(sum)} · ${pctText(sum, total)}`, tint: GREY });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, total, lang]);

  const open = (id: string) => {
    const e = entries.find((x) => x.id === id);
    if (e?.type === "dir" && e.node.hasChildren) {
      setPath([...path, e.node.name]);
      setSelected(null);
    }
  };
  const goTo = (depth: number) => {
    setPath(path.slice(0, depth));
    setSelected(null);
  };

  const dirPath = (e: Entry | null) => (e?.type === "dir" ? joinPath(rootPath, [...path, e.node.name]) : joinPath(rootPath, path));
  const label: Label | null = current?.type === "dir" ? classify(dirPath(current)) : null;
  const barMax = entries.length ? sizeOf(entries[0]) : 0;

  if (failed) return <Notice text={tr(l("อ่านผลสแกนไม่ได้ ลองสแกนใหม่อีกครั้ง", "Couldn't read the scan result — try scanning again"))} />;
  if (!data) return <Notice text={tr(l("กำลังโหลด…", "Loading…"))} />;

  return (
    <>
      <nav aria-label={tr(l("ตำแหน่งโฟลเดอร์", "Folder location"))} className="flex flex-wrap items-center gap-1 text-[13px] text-muted">
        {[rootPath, ...path].map((name, i, all) => {
          const last = i === all.length - 1;
          return (
            <span key={i} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />}
              {last ? (
                <strong aria-current="page" className="text-ink">{name}</strong>
              ) : (
                <button type="button" onClick={() => goTo(i)} className="rounded-md px-1 text-link hover:underline">
                  {name}
                </button>
              )}
            </span>
          );
        })}
        <span className="ml-3">· {tr(l("คลิกเพื่อเลือก · ดับเบิลคลิกเพื่อซูม", "Click to select · double-click to zoom"))}</span>
      </nav>

      {entries.length === 0 ? (
        <Notice text={tr(l("โฟลเดอร์นี้ว่างเปล่า", "This folder is empty"))} />
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-[18px]">
            <Treemap
              items={treeItems}
              selected={current && treeItems.some((t) => t.id === current.id) ? current.id : current ? "tail" : null}
              onSelect={(id) => setSelected(id === "tail" ? (entries[MAX_TILES]?.id ?? null) : id)}
              onOpen={open}
              label={tr(l("แผนภาพ Treemap", "Treemap"))}
            />

            {current && (
              <aside aria-label={tr(l("รายละเอียดที่เลือก", "Selected item"))} className="flex flex-col gap-3.5 rounded-card bg-surface p-6 shadow-card">
                <div className="flex flex-col gap-1">
                  <span className="truncate text-[13px] text-muted" title={dirPath(current)}>{dirPath(current)}</span>
                  <h2 className="m-0 font-display text-[22px] leading-snug font-medium break-words">{titleOf(current)}</h2>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2.5">
                  <span className="bg-linear-to-r from-brand to-[#1592C9] bg-clip-text font-display text-[38px] font-medium text-transparent">
                    {formatBytes(sizeOf(current))}
                  </span>
                  <span className="text-sm text-muted">
                    {pctText(sizeOf(current), total)} {path.length === 0 ? tr(l("ของที่ใช้ไป", "of used space")) : tr(l("ของโฟลเดอร์นี้", "of this folder"))}
                  </span>
                </div>
                {current.type === "dir" && (
                  <span className="text-[13px] text-muted">
                    {tr(l(`บนดิสก์ ${formatBytes(current.node.allocated)} · ${current.node.files.toLocaleString("th-TH")} ไฟล์ · ${current.node.dirs.toLocaleString("th-TH")} โฟลเดอร์`, `On disk ${formatBytes(current.node.allocated)} · ${current.node.files.toLocaleString("en-US")} files · ${current.node.dirs.toLocaleString("en-US")} folders`))}
                  </span>
                )}
                {current.type === "dir" && current.node.cloudFiles > 0 && (
                  <span className="text-[13px] text-muted">
                    {tr(l(`บน OneDrive (ยังไม่โหลดลงเครื่อง) ${formatBytes(current.node.cloudSize)} · ${current.node.cloudFiles.toLocaleString("th-TH")} ไฟล์`, `On OneDrive (not downloaded) ${formatBytes(current.node.cloudSize)} · ${current.node.cloudFiles.toLocaleString("en-US")} files`))}
                  </span>
                )}

                {label ? (
                  <div className={`flex flex-col gap-1.5 rounded-[18px] px-4 py-3.5 ${KIND_BG[label.kind]}`}>
                    <span className={`text-[13px] font-bold ${KIND_FG[label.kind]}`}>{tr(label.badge)}</span>
                    <span className="text-sm leading-relaxed text-ink">{tr(label.note)}</span>
                  </div>
                ) : (
                  <div className="rounded-[18px] bg-info-bg px-4 py-3.5 text-sm leading-relaxed text-ink">
                    {current.type === "files"
                      ? tr(l("ไฟล์ที่วางอยู่ตรงๆ ในโฟลเดอร์นี้ ไม่ได้อยู่ในโฟลเดอร์ย่อยใด — ดูไฟล์ใหญ่สุดได้ที่แท็บ ไฟล์ใหญ่สุด", "Files that sit directly in this folder rather than in a subfolder — see the Largest files tab"))
                      : tr(l("โฟลเดอร์เล็กหลายอันที่รวมเป็นก้อนเดียว — ดูแยกได้ในรายการด้านล่าง", "Many small folders combined into one block — see them separately in the list below"))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <ActionButton icon={ZoomIn} label={tr(l("ซูมดูข้างใน", "Zoom in"))} disabled={!(current.type === "dir" && current.node.hasChildren)} onClick={() => open(current.id)} />
                  <ActionButton
                    icon={ExternalLink}
                    label={tr(l("เปิดใน Explorer", "Open in Explorer"))}
                    onClick={() => void scanner.reveal(dirPath(current)).catch(soon)}
                  />
                  <ActionButton icon={ArrowLeftRight} label={tr(l("ย้ายไปไดรฟ์อื่น", "Move to another drive"))} onClick={soon} />
                  {label && !label.canDelete ? (
                    <button type="button" disabled className="flex min-h-[46px] cursor-not-allowed items-center justify-center gap-2 rounded-full bg-field text-sm text-muted">
                      <Lock size={16} strokeWidth={2} aria-hidden="true" />
                      {tr(l("ป้องกันการลบ", "Delete protected"))}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={current.type !== "dir"}
                      onClick={soon}
                      className="flex min-h-[46px] items-center justify-center gap-2 rounded-full border border-danger-btn bg-surface text-sm font-semibold text-danger-fg transition-colors hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface"
                    >
                      <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                      {tr(l("ย้ายลงถังขยะ", "Move to Recycle Bin"))}
                    </button>
                  )}
                </div>
              </aside>
            )}
          </div>

          <section aria-labelledby="list-title" className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card">
            <div className="flex items-center justify-between px-[22px] pt-[18px] pb-2.5">
              <h2 id="list-title" className="m-0 font-display text-lg font-medium">
                {tr(l(`โฟลเดอร์ใน ${dirPath(null)}`, `Folders in ${dirPath(null)}`))}
              </h2>
              <button type="button" onClick={soon} className="min-h-10 rounded-full border border-edge bg-surface px-4 text-sm transition-colors hover:bg-hover">
                {tr(l("ส่งออก CSV", "Export CSV"))}
              </button>
            </div>
            {entries.map((e) => {
              const isDir = e.type === "dir";
              const lab = isDir ? classify(joinPath(rootPath, [...path, e.node.name])) : null;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setSelected(e.id)}
                  onDoubleClick={() => open(e.id)}
                  aria-pressed={current?.id === e.id}
                  className={`grid min-h-[54px] w-full grid-cols-[minmax(0,2.2fr)_minmax(0,2fr)_96px_56px] items-center gap-4 border-0 border-t border-rowline px-[22px] text-left transition-colors ${
                    current?.id === e.id ? "bg-sel" : "bg-surface hover:bg-app"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px]" style={{ background: e.tint }}>
                      <Folder size={16} strokeWidth={1.9} aria-hidden="true" />
                    </span>
                    <span className="truncate text-[15px] font-medium">{titleOf(e)}</span>
                    {lab && lab.kind !== "info" && <Badge tone={KIND_TONE[lab.kind]}>{tr(lab.badge)}</Badge>}
                  </span>
                  <span className="h-2 overflow-hidden rounded bg-track">
                    <span className="block h-full rounded bg-linear-to-r from-brand to-sky" style={{ width: `${barMax ? Math.max(0.5, (sizeOf(e) / barMax) * 100) : 0}%` }} />
                  </span>
                  <span className="text-right text-[15px] font-semibold">{formatBytes(sizeOf(e))}</span>
                  <span className="text-right text-[13px] text-muted">{pctText(sizeOf(e), total)}</span>
                </button>
              );
            })}
          </section>
        </>
      )}
    </>
  );
}

function Notice({ text }: { text: string }) {
  return <div className="rounded-card bg-surface px-6 py-14 text-center text-sm text-muted shadow-card">{text}</div>;
}

function ActionButton({ icon: Icon, label, onClick, disabled }: { icon: typeof ZoomIn; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-[46px] items-center justify-center gap-2 rounded-full border border-edge bg-surface text-sm text-ink transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface"
    >
      <Icon size={16} strokeWidth={2} aria-hidden="true" />
      {label}
    </button>
  );
}

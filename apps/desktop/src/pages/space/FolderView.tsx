import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, ChevronRight, Cloud, ExternalLink, FileText, Folder, Layers, MousePointerClick, Sparkles } from "lucide-react";
import { Badge, type Tone } from "../../components/Badge";
import { classify, joinPath, type Kind, type Label } from "../../lib/classify";
import { formatBytes, scanner, type Children, type NodeView } from "../../lib/tauri";
import { l, useI18n, type PageId } from "../../i18n";
import { Treemap, type TreeItem } from "./Treemap";

const TINTS = ["#C3DBFF", "#BDEFDC", "#C6ECFB", "#DCD6FF", "#FFE0C9", "#FFD9E4", "#FFF3BF", "#D8F0A8"];
const GREY = "#E2E9F3";
const FILES_TINT = "#E6E0FF";
const MAX_TILES = 12;
/** ก้อนที่เล็กกว่านี้ใน treemap อ่านชื่อไม่ออก — รวมเป็นก้อน "อื่นๆ" แทน */
const MIN_SHARE = 0.03;
/** ก้อน "อื่นๆ" ใน treemap ได้พื้นที่อย่างน้อยเท่านี้ เพื่อให้มีที่ใส่ชื่อ (ตัวเลขที่แสดงยังเป็นขนาดจริง) */
const TAIL_MIN_SHARE = 0.06;
const TAIL = "tail";

const KIND_TONE: Record<Kind, Tone> = { safe: "safe", check: "warn", lock: "danger", info: "info" };

/** รายการหนึ่งในโฟลเดอร์ที่กำลังดู: โฟลเดอร์ย่อย, ไฟล์ที่อยู่ตรงๆ ในโฟลเดอร์, หรือก้อนรวมโฟลเดอร์เล็กจากฝั่ง Rust */
type Entry =
  | { id: string; type: "dir"; node: NodeView; tint: string }
  | { id: string; type: "files"; size: number; allocated: number; files: number; tint: string }
  | { id: string; type: "others"; size: number; allocated: number; count: number; tint: string };

const sizeOf = (e: Entry) => (e.type === "dir" ? e.node.size : e.size);
const canOpen = (e: Entry | undefined) => e?.type === "dir" && e.node.hasChildren;

/**
 * โหลดรายการของโฟลเดอร์ พร้อมแคชไว้ต่อการสแกนหนึ่งครั้ง
 * แคชมีไว้ให้ "เปิดโฟลเดอร์แล้วข้อมูลมาพร้อมก่อนเปลี่ยนหน้า" — ถ้าระหว่างโหลดหน้าจอว่าง
 * เนื้อหาจะหดเหลือการ์ดใบเดียว แล้วตำแหน่งเลื่อนจะเด้งกลับขึ้นบนสุดทุกครั้งที่กดเข้าโฟลเดอร์
 */
function useChildren(path: string[], key: string) {
  const pathKey = path.join("\\");
  const cacheKey = `${key}|${pathKey}`;
  const cache = useRef(new Map<string, Children>());
  const [data, setData] = useState<{ k: string; value: Children } | null>(null);
  const [failed, setFailed] = useState(false);

  const keyOf = (p: string[]) => `${key}|${p.join("\\")}`;

  useEffect(() => {
    if (cache.current.has(cacheKey)) return;
    let alive = true;
    setFailed(false);
    scanner
      .children(path)
      .then((value) => {
        if (!alive) return;
        cache.current.set(cacheKey, value);
        setData({ k: cacheKey, value });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  const cached = cache.current.get(cacheKey);
  return {
    value: data && data.k === cacheKey ? data.value : (cached ?? null),
    failed,
    /** โหลดล่วงหน้าก่อนสลับโฟลเดอร์ — ผิดพลาดแล้วปล่อยผ่าน ให้ useChildren ลองเองอีกครั้ง */
    preload: async (p: string[]) => {
      try {
        if (!cache.current.has(keyOf(p))) cache.current.set(keyOf(p), await scanner.children(p));
      } catch {
        /* ไม่เป็นไร */
      }
    },
  };
}

const pctText = (part: number, whole: number) => {
  if (whole <= 0) return "0%";
  const v = (part / whole) * 100;
  return v < 1 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
};

type Props = {
  rootPath: string;
  scanKey: string;
  onNavigate?: (id: PageId) => void;
  onShowTopFiles?: () => void;
};

export function FolderView({ rootPath, scanKey, onNavigate, onShowTopFiles }: Props) {
  const { lang, tr } = useI18n();
  const [path, setPath] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const { value: data, failed, preload } = useChildren(path, scanKey);
  const num = (n: number) => n.toLocaleString(lang === "th" ? "th-TH" : "en-US");

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

  const titleOf = (e: Entry): string => {
    if (e.type === "dir") return e.node.name;
    if (e.type === "files") return tr(l("ไฟล์ในโฟลเดอร์นี้", "Files in this folder"));
    return tr(l(`โฟลเดอร์เล็กอื่นๆ (${num(e.count)})`, `Other small folders (${num(e.count)})`));
  };

  // treemap แสดงเฉพาะก้อนที่ใหญ่พอจะอ่านชื่อออก ที่เหลือรวมเป็นก้อน "อื่นๆ" ก้อนเดียว
  const split = useMemo(() => {
    const small = entries.findIndex((e, i) => i > 0 && total > 0 && sizeOf(e) / total < MIN_SHARE);
    return Math.min(small < 0 ? entries.length : small, MAX_TILES);
  }, [entries, total]);
  const tail = entries.slice(split);
  const tailSize = tail.reduce((s, e) => s + sizeOf(e), 0);

  const treeItems = useMemo<TreeItem[]>(() => {
    const items: TreeItem[] = entries.slice(0, split).map((e) => ({
      id: e.id,
      value: sizeOf(e),
      title: e.type === "files" ? tr(l("ไฟล์ที่นี่", "Files here")) : titleOf(e),
      sub: formatBytes(sizeOf(e)),
      tint: e.tint,
      openable: canOpen(e),
    }));
    if (tail.length > 0) {
      items.push({
        id: TAIL,
        value: tailSize,
        layoutValue: Math.max(tailSize, total * TAIL_MIN_SHARE),
        title: tr(l(`อื่นๆ ${tail.length} รายการ`, `${tail.length} more`)),
        sub: formatBytes(tailSize),
        tint: GREY,
      });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, total, split, lang]);

  const current: Entry | null = selected === TAIL ? null : (entries.find((e) => e.id === selected) ?? entries[0] ?? null);
  const tailSelected = selected === TAIL;
  const inTail = (id: string) => tail.some((e) => e.id === id);
  const treeSelected = tailSelected ? TAIL : current ? (inTail(current.id) ? TAIL : current.id) : null;

  const open = (id: string) => {
    const e = entries.find((x) => x.id === id);
    if (!canOpen(e) || e?.type !== "dir") return;
    const next = [...path, e.node.name];
    // โหลดก่อนแล้วค่อยเปลี่ยนหน้า เพื่อให้เนื้อหายังเต็มหน้าจอตอนสลับ (ดู useChildren)
    void preload(next).then(() => {
      setPath(next);
      setSelected(null);
    });
  };
  const goTo = (depth: number) => {
    setPath(path.slice(0, depth));
    setSelected(null);
  };
  const onKeyDown = (ev: KeyboardEvent) => {
    // Backspace = ถอยกลับหนึ่งระดับ (เหมือน File Explorer)
    if (ev.key === "Backspace" && path.length > 0 && !(ev.target instanceof HTMLInputElement)) {
      ev.preventDefault();
      goTo(path.length - 1);
    }
  };

  const dirPath = (e: Entry | null) => (e?.type === "dir" ? joinPath(rootPath, [...path, e.node.name]) : joinPath(rootPath, path));
  const labelOf = (e: Entry): Label | null => (e.type === "dir" ? classify(dirPath(e)) : null);
  const barMax = entries.length ? sizeOf(entries[0]) : 0;
  const ofWhat = path.length === 0 ? tr(l("ของที่ใช้ไป", "of used space")) : tr(l("ของโฟลเดอร์นี้", "of this folder"));

  if (failed) return <Notice text={tr(l("อ่านผลสแกนไม่ได้ ลองสแกนใหม่อีกครั้ง", "Couldn't read the scan result — try scanning again"))} />;
  if (!data) return <Notice text={tr(l("กำลังโหลด…", "Loading…"))} />;

  return (
    <div className="flex flex-col gap-[18px]" onKeyDown={onKeyDown}>
      {/* ───── แถบตำแหน่ง: ย้อนกลับ + เส้นทาง ───── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={tr(l("ตำแหน่งโฟลเดอร์", "Folder location"))} className="flex min-w-0 flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => goTo(path.length - 1)}
            disabled={path.length === 0}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-edge bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-surface"
          >
            <ArrowLeft size={16} strokeWidth={2.2} aria-hidden="true" />
            {tr(l("ย้อนกลับ", "Back"))}
          </button>
          {[rootPath, ...path].map((name, i, all) => {
            const last = i === all.length - 1;
            return (
              <span key={i} className="inline-flex min-w-0 items-center gap-1.5">
                {i > 0 && <ChevronRight size={14} strokeWidth={2} className="text-muted" aria-hidden="true" />}
                {last ? (
                  <strong aria-current="page" className="truncate rounded-full bg-sel px-3 py-1.5 text-sm text-ink">
                    {name}
                  </strong>
                ) : (
                  <button type="button" onClick={() => goTo(i)} className="truncate rounded-full px-2.5 py-1.5 text-sm text-link transition-colors hover:bg-hover">
                    {name}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
        <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
          <MousePointerClick size={15} strokeWidth={2} aria-hidden="true" />
          {tr(l("คลิก = ดูรายละเอียด · ดับเบิลคลิก = เปิดโฟลเดอร์", "Click = details · Double-click = open folder"))}
        </span>
      </div>

      {entries.length === 0 ? (
        <Notice text={tr(l("โฟลเดอร์นี้ว่างเปล่า", "This folder is empty"))} />
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(300px,2fr)] gap-[18px]">
            <Treemap items={treeItems} selected={treeSelected} onSelect={setSelected} onOpen={open} label={tr(l("แผนภาพ Treemap", "Treemap"))} />

            {/* ───── การ์ดรายละเอียด ───── */}
            <aside aria-label={tr(l("รายละเอียดที่เลือก", "Selected item"))} aria-live="polite" className="flex flex-col gap-4 rounded-card bg-surface p-6 shadow-card">
              {tailSelected ? (
                <TailDetail
                  items={tail.map((e) => ({ id: e.id, title: titleOf(e), size: sizeOf(e), tint: e.tint }))}
                  size={tailSize}
                  pct={pctText(tailSize, total)}
                  ofWhat={ofWhat}
                  onPick={setSelected}
                />
              ) : current ? (
                <ItemDetail
                  entry={current}
                  title={titleOf(current)}
                  where={dirPath(current)}
                  label={labelOf(current)}
                  pct={total > 0 ? sizeOf(current) / total : 0}
                  pctLabel={`${pctText(sizeOf(current), total)} ${ofWhat}`}
                  num={num}
                  onOpen={() => open(current.id)}
                  onReveal={() => void scanner.reveal(dirPath(current)).catch(() => {})}
                  onClean={onNavigate ? () => onNavigate("cleaner") : undefined}
                  onTopFiles={onShowTopFiles}
                />
              ) : null}
            </aside>
          </div>

          {/* ───── รายการ ───── */}
          <section aria-labelledby="list-title" className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card">
            <div className="flex items-baseline justify-between gap-3 px-[22px] pt-[18px] pb-2.5">
              <h2 id="list-title" className="m-0 font-display text-lg font-medium">
                {tr(l("ทั้งหมดในโฟลเดอร์นี้", "Everything in this folder"))}
              </h2>
              <span className="text-[13px] text-muted">
                {tr(l(`${num(entries.length)} รายการ · ${formatBytes(total)}`, `${num(entries.length)} items · ${formatBytes(total)}`))}
              </span>
            </div>
            {entries.map((e) => {
              const lab = labelOf(e);
              const isSel = current?.id === e.id && !tailSelected;
              const openable = canOpen(e);
              return (
                <div key={e.id} className={`flex items-center border-t border-rowline transition-colors ${isSel ? "bg-sel" : "bg-surface hover:bg-app"}`}>
                  <button
                    type="button"
                    onClick={() => setSelected(e.id)}
                    onDoubleClick={() => open(e.id)}
                    aria-pressed={isSel}
                    className="grid min-h-[54px] min-w-0 flex-1 grid-cols-[minmax(0,2.4fr)_minmax(0,1.6fr)_96px_52px] items-center gap-4 border-0 bg-transparent pl-[22px] text-left"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] text-[#1E2C57]" style={{ background: e.tint }}>
                        {e.type === "files" ? <FileText size={15} strokeWidth={1.9} aria-hidden="true" /> : e.type === "others" ? <Layers size={15} strokeWidth={1.9} aria-hidden="true" /> : <Folder size={15} strokeWidth={1.9} aria-hidden="true" />}
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
                  <span className="flex w-[64px] shrink-0 justify-center">
                    {openable && (
                      <button
                        type="button"
                        onClick={() => open(e.id)}
                        aria-label={tr(l(`เปิด ${titleOf(e)}`, `Open ${titleOf(e)}`))}
                        title={tr(l("เปิดโฟลเดอร์", "Open folder"))}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-ink"
                      >
                        <ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}

/* ───────────────────────── การ์ดรายละเอียดของรายการที่เลือก ───────────────────────── */

type ItemDetailProps = {
  entry: Entry;
  title: string;
  where: string;
  label: Label | null;
  pct: number;
  pctLabel: string;
  num: (n: number) => string;
  onOpen: () => void;
  onReveal: () => void;
  onClean?: () => void;
  onTopFiles?: () => void;
};

function ItemDetail({ entry, title, where, label, pct, pctLabel, num, onOpen, onReveal, onClean, onTopFiles }: ItemDetailProps) {
  const { tr } = useI18n();
  const size = sizeOf(entry);
  const node = entry.type === "dir" ? entry.node : null;
  const openable = canOpen(entry);

  const facts: string[] = [];
  if (node) {
    facts.push(tr(l(`${num(node.files)} ไฟล์`, `${num(node.files)} files`)));
    if (node.dirs > 0) facts.push(tr(l(`${num(node.dirs)} โฟลเดอร์`, `${num(node.dirs)} folders`)));
  } else if (entry.type === "files" && entry.files > 0) {
    facts.push(tr(l(`${num(entry.files)} ไฟล์`, `${num(entry.files)} files`)));
  } else if (entry.type === "others") {
    facts.push(tr(l(`${num(entry.count)} โฟลเดอร์`, `${num(entry.count)} folders`)));
  }

  const note: string | null = label
    ? tr(label.note)
    : entry.type === "files"
      ? tr(l("ไฟล์ที่วางอยู่ตรงๆ ในโฟลเดอร์นี้ ไม่ได้อยู่ในโฟลเดอร์ย่อย", "Files sitting directly in this folder, not in a subfolder"))
      : entry.type === "others"
        ? tr(l("โฟลเดอร์เล็กจำนวนมากที่รวมไว้เป็นก้อนเดียว", "Many small folders grouped together"))
        : null;

  return (
    <>
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[#1E2C57]" style={{ background: entry.tint }}>
          {entry.type === "files" ? <FileText size={22} strokeWidth={1.9} aria-hidden="true" /> : <Folder size={22} strokeWidth={1.9} aria-hidden="true" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="m-0 font-display text-[21px] leading-snug font-medium break-words">{title}</h2>
          <span className="truncate text-[13px] text-muted" title={where}>
            {where}
          </span>
        </div>
        {label && label.kind !== "info" && <Badge tone={KIND_TONE[label.kind]}>{tr(label.badge)}</Badge>}
      </div>

      <div className="flex flex-col gap-2">
        <span
          className="bg-linear-to-r from-brand to-[#1592C9] bg-clip-text font-display text-[40px] leading-none font-medium text-transparent"
          title={node ? tr(l(`บนดิสก์ ${formatBytes(node.allocated)}`, `On disk ${formatBytes(node.allocated)}`)) : undefined}
        >
          {formatBytes(size)}
        </span>
        <div className="h-2.5 overflow-hidden rounded-full bg-track" role="img" aria-label={pctLabel}>
          <div className="h-full rounded-full bg-meter" style={{ width: `${Math.max(1.5, Math.min(100, pct * 100))}%` }} />
        </div>
        <span className="flex flex-wrap gap-x-2 text-[13px] text-muted">
          <span className="font-semibold text-ink">{pctLabel}</span>
          {facts.length > 0 && <span>· {facts.join(" · ")}</span>}
        </span>
        {node && node.cloudFiles > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
            <Cloud size={14} strokeWidth={2} aria-hidden="true" />
            {tr(l(`อยู่บน OneDrive ${formatBytes(node.cloudSize)} (ไม่กินพื้นที่เครื่อง)`, `${formatBytes(node.cloudSize)} on OneDrive (not using local space)`))}
          </span>
        )}
      </div>

      {note && <p className="m-0 rounded-2xl bg-field px-4 py-3 text-sm leading-relaxed text-ink">{note}</p>}

      <div className="mt-auto flex flex-col gap-2">
        {openable && (
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-white shadow-primary transition hover:brightness-110"
          >
            {tr(l("เปิดดูข้างใน", "Look inside"))}
            <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        )}
        {label?.canDelete && onClean && (
          <button
            type="button"
            onClick={onClean}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-safe-fg/40 bg-safe-bg px-5 text-[15px] font-semibold text-safe-fg transition hover:brightness-105"
          >
            <Sparkles size={17} strokeWidth={2.1} aria-hidden="true" />
            {tr(l("ล้างอย่างปลอดภัยในหน้า ล้างขยะ", "Clean it safely in Cleaner"))}
          </button>
        )}
        {entry.type === "files" && onTopFiles && (
          <button
            type="button"
            onClick={onTopFiles}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-white shadow-primary transition hover:brightness-110"
          >
            {tr(l("ดูไฟล์ใหญ่สุด", "See largest files"))}
            <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        )}
        {entry.type !== "others" && (
          <button
            type="button"
            onClick={onReveal}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-edge bg-surface px-5 text-sm text-ink transition-colors hover:bg-hover"
          >
            <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />
            {tr(l("เปิดใน File Explorer", "Show in File Explorer"))}
          </button>
        )}
      </div>
    </>
  );
}

/** การ์ดรายละเอียดของก้อน "อื่นๆ" — แสดงรายการเล็กให้กดเลือกต่อได้ */
function TailDetail({
  items,
  size,
  pct,
  ofWhat,
  onPick,
}: {
  items: { id: string; title: string; size: number; tint: string }[];
  size: number;
  pct: string;
  ofWhat: string;
  onPick: (id: string) => void;
}) {
  const { tr } = useI18n();
  const shown = items.slice(0, 6);
  return (
    <>
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[#1E2C57]" style={{ background: GREY }}>
          <Layers size={22} strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="m-0 font-display text-[21px] leading-snug font-medium">{tr(l(`อื่นๆ ${items.length} รายการ`, `${items.length} smaller items`))}</h2>
          <span className="text-[13px] text-muted">{tr(l("รายการเล็กที่รวมไว้ในแผนภาพ", "Small items grouped in the map"))}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="bg-linear-to-r from-brand to-[#1592C9] bg-clip-text font-display text-[40px] leading-none font-medium text-transparent">{formatBytes(size)}</span>
        <span className="text-[13px] font-semibold text-ink">
          {pct} {ofWhat}
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {shown.map((x) => (
          <li key={x.id}>
            <button
              type="button"
              onClick={() => onPick(x.id)}
              className="flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-sm transition-colors hover:bg-hover"
            >
              <span className="h-3 w-3 shrink-0 rounded" style={{ background: x.tint }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{x.title}</span>
              <span className="font-semibold">{formatBytes(x.size)}</span>
            </button>
          </li>
        ))}
      </ul>
      {items.length > shown.length && (
        <span className="text-[13px] text-muted">{tr(l(`และอีก ${items.length - shown.length} รายการในรายการด้านล่าง`, `…and ${items.length - shown.length} more in the list below`))}</span>
      )}
    </>
  );
}

function Notice({ text }: { text: string }) {
  return <div className="rounded-card bg-surface px-6 py-14 text-center text-sm text-muted shadow-card">{text}</div>;
}

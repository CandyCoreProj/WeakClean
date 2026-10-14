import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ExternalLink, LoaderCircle, Search, X } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { Badge } from "../../components/Badge";
import { useToast } from "../../components/Toast";
import { cancelDupes, startDupes, useDupes } from "../../lib/dupeStore";
import { formatBytes, scanner, type DupGroup, type History, type OldFile } from "../../lib/tauri";
import { l, useI18n, type L } from "../../i18n";

const Box = ({ children }: { children: ReactNode }) => <div className="rounded-card bg-surface px-6 py-14 text-center text-sm text-muted shadow-card">{children}</div>;

const splitPath = (p: string) => {
  const cut = p.lastIndexOf("\\");
  return { name: p.slice(cut + 1), dir: p.slice(0, cut + 1) };
};

/** แถบสรุปการเลือก + ปุ่มย้ายเข้าที่กักกัน (ยืนยันก่อนเสมอ ไม่ลบถาวร) */
function SelectionBar({ count, bytes, onConfirm, extra }: { count: number; bytes: number; onConfirm: () => void; extra?: ReactNode }) {
  const { tr } = useI18n();
  return (
    <div className="sticky bottom-3 z-10 flex items-center gap-3 rounded-full bg-surface px-5 py-3 shadow-float">
      <span className="flex-1 text-sm">
        {count > 0 ? tr(l(`เลือก ${count} ไฟล์ · คืนพื้นที่ได้ ${formatBytes(bytes)}`, `${count} files selected · frees ${formatBytes(bytes)}`)) : tr(l("ติ๊กไฟล์ที่ต้องการย้ายเข้าที่กักกัน (กู้คืนได้ภายใน 7 วัน)", "Tick files to move to quarantine (restorable for 7 days)"))}
      </span>
      {extra}
      <button
        type="button"
        disabled={count === 0}
        onClick={onConfirm}
        className="min-h-11 rounded-full bg-primary px-5 text-sm font-semibold text-white shadow-primary transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
      >
        {tr(l("ย้ายเข้าที่กักกัน", "Move to quarantine"))}
      </button>
    </div>
  );
}

function ConfirmQuarantine({ open, count, bytes, onClose, onConfirm, busy }: { open: boolean; count: number; bytes: number; onClose: () => void; onConfirm: () => void; busy: boolean }) {
  const { t, tr } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} labelledBy="quarantine-title">
      <h2 id="quarantine-title" className="m-0 font-display text-2xl font-medium">
        {tr(l(`ย้าย ${count} ไฟล์ (${formatBytes(bytes)}) เข้าที่กักกัน?`, `Move ${count} files (${formatBytes(bytes)}) to quarantine?`))}
      </h2>
      <p className="m-0 text-sm leading-relaxed text-info-fg">
        {tr(l("ไฟล์จะถูก \"ย้าย\" ไปเก็บไว้ ไม่ได้ลบถาวร — เปลี่ยนใจกู้คืนได้ที่หน้า ประวัติ & กู้คืน ภายใน 7 วัน ไฟล์ที่ถูกแก้ไขหลังสแกนหรือกำลังถูกใช้งานจะถูกข้าม", "Files are \"moved\", not permanently deleted — restore them from History & Restore within 7 days. Files changed since the scan or in use are skipped."))}
      </p>
      <div className="mt-1 flex justify-end gap-2.5">
        <button type="button" onClick={onClose} className="min-h-[50px] rounded-full border border-edge bg-surface px-6 text-[15px] transition-colors hover:bg-hover">
          {t.cancel}
        </button>
        <button type="button" disabled={busy} onClick={onConfirm} className="min-h-[50px] rounded-full bg-primary px-[26px] text-[15px] font-semibold text-white shadow-primary transition hover:brightness-105 disabled:opacity-60">
          {tr(l("ยืนยันและย้าย", "Confirm and move"))}
        </button>
      </div>
    </Dialog>
  );
}

/* ───────── ไฟล์เก่า ───────── */

const ageText = (modified: number, tr: (x: L) => string) => {
  const days = Math.max(0, (Date.now() / 1000 - modified) / 86_400);
  if (days >= 730) return tr(l(`${Math.floor(days / 365)} ปีที่แล้ว`, `${Math.floor(days / 365)} years ago`));
  if (days >= 365) return tr(l("1 ปีที่แล้ว", "1 year ago"));
  return tr(l(`${Math.floor(days / 30)} เดือนที่แล้ว`, `${Math.floor(days / 30)} months ago`));
};

export function OldFilesView({ scanKey }: { scanKey: string }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [files, setFiles] = useState<{ k: string; list: OldFile[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    scanner
      .oldFiles()
      .then((list) => alive && setFiles({ k: scanKey, list }))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [scanKey]);

  const list = files && files.k === scanKey ? files.list : null;
  const picked = list?.filter((f) => sel.has(f.path)) ?? [];
  const pickedBytes = picked.reduce((s, f) => s + f.size, 0);

  const run = async () => {
    setBusy(true);
    try {
      const r = await scanner.quarantine("old", picked.map((f) => f.path));
      toast(tr(l(`ย้ายเข้าที่กักกัน ${r.movedFiles} ไฟล์ (${formatBytes(r.movedBytes)})${r.skippedFiles > 0 ? ` · ข้าม ${r.skippedFiles} ไฟล์ที่ถูกแก้ไขหรือใช้งานอยู่` : ""}`, `Moved ${r.movedFiles} files (${formatBytes(r.movedBytes)}) to quarantine${r.skippedFiles > 0 ? ` · skipped ${r.skippedFiles} changed or in-use files` : ""}`)));
      const gone = new Set(picked.map((f) => f.path));
      setFiles((cur) => (cur ? { ...cur, list: cur.list.filter((f) => !gone.has(f.path)) } : cur));
      setSel(new Set());
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  if (failed) return <Box>{tr(l("อ่านผลสแกนไม่ได้ ลองสแกนใหม่อีกครั้ง", "Couldn't read the scan result — try scanning again"))}</Box>;
  if (!list) return <Box>{tr(l("กำลังโหลด…", "Loading…"))}</Box>;
  if (list.length === 0) return <Box>{tr(l("ไม่พบไฟล์ใหญ่ที่ไม่ได้แก้ไขเกิน 1 ปี", "No large files untouched for over a year"))}</Box>;

  return (
    <>
      <section aria-label={tr(l("ไฟล์เก่า", "Old files"))} className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card">
        <div className="flex flex-col gap-1 px-[22px] pt-[18px] pb-2.5">
          <h2 className="m-0 font-display text-lg font-medium">{tr(l("ไฟล์ใหญ่ที่ไม่ได้แก้ไขเกิน 1 ปี", "Large files untouched for over a year"))}</h2>
          <span className="text-[13px] text-muted">{tr(l("ดูจากเวลาแก้ไขล่าสุด — Windows ไม่ได้บันทึกเวลาเปิดไฟล์ไว้เสมอไป ตรวจก่อนย้ายทุกครั้ง", "Based on last-modified time — Windows doesn't always record when a file was opened, so check before moving"))}</span>
        </div>
        {list.map((f) => {
          const { name, dir } = splitPath(f.path);
          return (
            <div key={f.path} className="grid min-h-[58px] grid-cols-[28px_minmax(0,1fr)_120px_96px_44px] items-center gap-3 border-t border-rowline px-[22px] py-1.5">
              <input
                type="checkbox"
                aria-label={name}
                checked={sel.has(f.path)}
                onChange={() => setSel((cur) => { const n = new Set(cur); if (!n.delete(f.path)) n.add(f.path); return n; })}
                className="m-0 h-[22px] w-[22px] cursor-pointer accent-brand"
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[15px] font-medium">{name}</span>
                <span className="truncate text-xs text-muted" title={f.path}>{dir}</span>
              </span>
              <span className="text-right text-[13px] text-muted">{ageText(f.modified, tr)}</span>
              <span className="text-right text-[15px] font-semibold">{formatBytes(f.size)}</span>
              <button type="button" aria-label={tr(l(`เปิด ${name} ใน Explorer`, `Show ${name} in Explorer`))} onClick={() => void scanner.reveal(f.path).catch(() => {})} className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover">
                <ExternalLink size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </section>
      <SelectionBar count={picked.length} bytes={pickedBytes} onConfirm={() => setConfirm(true)} />
      <ConfirmQuarantine open={confirm} count={picked.length} bytes={pickedBytes} busy={busy} onClose={() => setConfirm(false)} onConfirm={() => void run()} />
    </>
  );
}

/* ───────── ไฟล์ซ้ำ ───────── */

export function DupesView({ scanKey }: { scanKey: string }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const dupes = useDupes();
  const [groups, setGroups] = useState<DupGroup[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const fresh = dupes.forKey === scanKey;
  const num = (n: number) => n.toLocaleString(lang === "th" ? "th-TH" : "en-US");

  useEffect(() => {
    if (!(fresh && dupes.status === "done")) {
      setGroups(null);
      return;
    }
    let alive = true;
    scanner
      .dupesResult()
      .then((g) => alive && setGroups(g))
      .catch(() => alive && setGroups([]));
    return () => {
      alive = false;
    };
  }, [fresh, dupes.status, dupes.summary]);

  const allPicked = useMemo(() => (groups ?? []).flatMap((g) => g.files.filter((f) => sel.has(f.path)).map((f) => ({ f, size: g.size }))), [groups, sel]);
  const pickedBytes = allPicked.reduce((s, x) => s + x.size, 0);
  const toggle = (path: string) => setSel((cur) => { const n = new Set(cur); if (!n.delete(path)) n.add(path); return n; });
  const autoSelect = () => setSel(new Set((groups ?? []).flatMap((g) => g.files.slice(1).map((f) => f.path)))); // เก็บอันเก่าสุดไว้

  const run = async () => {
    setBusy(true);
    try {
      const paths = allPicked.map((x) => x.f.path);
      const r = await scanner.quarantine("dupes", paths);
      toast(tr(l(`ย้ายเข้าที่กักกัน ${r.movedFiles} ไฟล์ (${formatBytes(r.movedBytes)})${r.skippedFiles > 0 ? ` · ข้าม ${r.skippedFiles} ไฟล์ที่ถูกแก้ไขหรือใช้งานอยู่` : ""}`, `Moved ${r.movedFiles} files (${formatBytes(r.movedBytes)}) to quarantine${r.skippedFiles > 0 ? ` · skipped ${r.skippedFiles} changed or in-use files` : ""}`)));
      const gone = new Set(paths);
      setGroups((cur) => (cur ?? []).map((g) => ({ ...g, files: g.files.filter((f) => !gone.has(f.path)) })).filter((g) => g.files.length > 1));
      setSel(new Set());
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  if (dupes.status === "running" && fresh) {
    const p = dupes.progress;
    const stage = p?.stage ?? 0;
    const pct = p && p.total > 0 ? Math.min(99, Math.round((p.done / p.total) * 100)) : 0;
    const label = stage === 0 ? l("จัดกลุ่มไฟล์ที่ขนาดเท่ากัน…", "Grouping files of equal size…") : stage === 1 ? l("ตรวจส่วนหัวของไฟล์…", "Checking file headers…") : l("เทียบเนื้อหาไฟล์ทั้งไฟล์…", "Comparing full file contents…");
    return (
      <section aria-live="polite" className="flex flex-col gap-4 rounded-card bg-surface p-6 shadow-card">
        <div className="flex items-center gap-3">
          <LoaderCircle size={22} strokeWidth={2.2} className="animate-spin text-brand" aria-hidden="true" />
          <h2 className="m-0 font-display text-xl font-medium">{tr(label)}</h2>
          <span className="ml-auto text-sm text-muted">{p ? `${num(p.done)} / ${num(p.total)}` : ""}</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-[5px] bg-track">
          <div className="h-full rounded-[5px] bg-meter transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{p && p.bytes > 0 ? tr(l(`อ่านไปแล้ว ${formatBytes(p.bytes)}`, `${formatBytes(p.bytes)} read so far`)) : ""}</span>
          <button type="button" onClick={cancelDupes} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-edge px-4 text-sm text-ink transition-colors hover:bg-hover">
            <X size={14} strokeWidth={2.2} aria-hidden="true" />
            {tr(l("ยกเลิก", "Cancel"))}
          </button>
        </div>
      </section>
    );
  }

  if (!(fresh && dupes.status === "done")) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-14 text-center shadow-card">
        <span className="tile-violet flex h-[52px] w-[52px] items-center justify-center rounded-tile text-white">
          <Search size={24} strokeWidth={1.9} aria-hidden="true" />
        </span>
        <h2 className="m-0 font-display text-xl font-medium">{tr(l("ค้นหาไฟล์ซ้ำ", "Find duplicate files"))}</h2>
        <p className="m-0 max-w-[520px] text-sm leading-relaxed text-muted">
          {tr(l("เทียบเฉพาะไฟล์ตั้งแต่ 1 MB ขึ้นไป โดยดูขนาด → ส่วนหัว → เนื้อหาทั้งไฟล์ จึงแม่นยำ ไม่แตะไฟล์ระบบ และ hard link ไม่นับเป็นไฟล์ซ้ำ — ไม่มีการลบอะไรระหว่างค้นหา", "Only files of 1 MB or more are compared — by size, then header, then full content — so it's accurate. System files are skipped, hard links don't count as duplicates, and nothing is deleted while searching."))}
        </p>
        <button type="button" onClick={() => void startDupes(scanKey)} className="mt-1 inline-flex min-h-[52px] items-center gap-2 rounded-full bg-primary px-7 text-base font-semibold text-white shadow-primary transition hover:brightness-105">
          <Search size={18} strokeWidth={2.2} aria-hidden="true" />
          {tr(l("เริ่มค้นหา", "Start searching"))}
        </button>
      </div>
    );
  }

  if (!groups) return <Box>{tr(l("กำลังโหลด…", "Loading…"))}</Box>;
  if (groups.length === 0) return <Box>{tr(l("ไม่พบไฟล์ซ้ำ 🎉", "No duplicate files found"))}</Box>;
  const totalWasted = groups.reduce((s, g) => s + g.wasted, 0);

  return (
    <>
      <section aria-label={tr(l("ไฟล์ซ้ำ", "Duplicate files"))} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="m-0 font-display text-lg font-medium">{tr(l(`พบ ${num(groups.length)} กลุ่ม · คืนพื้นที่ได้สูงสุด ${formatBytes(totalWasted)}`, `${num(groups.length)} groups · up to ${formatBytes(totalWasted)} can be freed`))}</h2>
          <button type="button" onClick={autoSelect} className="min-h-10 rounded-full border border-edge bg-surface px-4 text-sm transition-colors hover:bg-hover">
            {tr(l("เลือกให้ (เก็บอันเก่าสุด)", "Auto-select (keep the oldest)"))}
          </button>
        </div>
        {groups.map((g) => {
          const pickedHere = g.files.filter((f) => sel.has(f.path)).length;
          return (
            <div key={g.files[0].path} className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card">
              <div className="flex items-center gap-2.5 bg-app px-[22px] py-2.5 text-sm">
                <span className="font-semibold">{formatBytes(g.size)}</span>
                <span className="text-muted">× {g.files.length}</span>
                <Badge tone="warn">{tr(l(`คืนได้ ${formatBytes(g.wasted)}`, `frees ${formatBytes(g.wasted)}`))}</Badge>
              </div>
              {g.files.map((f, i) => {
                const { name, dir } = splitPath(f.path);
                const checked = sel.has(f.path);
                // ต้องเหลือสำเนาอย่างน้อย 1 ไฟล์ในกลุ่มเสมอ
                const lastKeeper = !checked && pickedHere >= g.files.length - 1;
                return (
                  <div key={f.path} className="grid min-h-[54px] grid-cols-[28px_minmax(0,1fr)_150px_44px] items-center gap-3 border-t border-rowline px-[22px] py-1">
                    <input
                      type="checkbox"
                      aria-label={name}
                      checked={checked}
                      disabled={lastKeeper}
                      title={lastKeeper ? tr(l("ต้องเก็บไว้อย่างน้อย 1 สำเนา", "At least one copy must be kept")) : undefined}
                      onChange={() => toggle(f.path)}
                      className="m-0 h-[22px] w-[22px] cursor-pointer accent-brand disabled:cursor-not-allowed"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-medium">{name}</span>
                        {i === 0 && <Badge tone="info">{tr(l("เก่าสุด", "Oldest"))}</Badge>}
                      </span>
                      <span className="truncate text-xs text-muted" title={f.path}>{dir}</span>
                    </span>
                    <span className="text-right text-[13px] text-muted">{new Date(f.modified * 1000).toLocaleDateString(lang === "th" ? "th-TH" : "en-US", { dateStyle: "medium" })}</span>
                    <button type="button" aria-label={tr(l(`เปิด ${name} ใน Explorer`, `Show ${name} in Explorer`))} onClick={() => void scanner.reveal(f.path).catch(() => {})} className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover">
                      <ExternalLink size={18} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </section>
      <SelectionBar count={allPicked.length} bytes={pickedBytes} onConfirm={() => setConfirm(true)} />
      <ConfirmQuarantine open={confirm} count={allPicked.length} bytes={pickedBytes} busy={busy} onClose={() => setConfirm(false)} onConfirm={() => void run()} />
    </>
  );
}

/* ───────── ประวัติการเติบโต ───────── */

export function HistoryView({ rootPath, scanKey }: { rootPath: string; scanKey: string }) {
  const { tr, lang } = useI18n();
  const [data, setData] = useState<{ k: string; h: History } | null>(null);
  const [failed, setFailed] = useState(false);
  const locale = lang === "th" ? "th-TH" : "en-US";

  useEffect(() => {
    let alive = true;
    scanner
      .history(rootPath)
      .then((h) => alive && setData({ k: scanKey, h }))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [rootPath, scanKey]);

  const h = data && data.k === scanKey ? data.h : null;
  if (failed) return <Box>{tr(l("อ่านประวัติไม่สำเร็จ", "Couldn't read the history"))}</Box>;
  if (!h) return <Box>{tr(l("กำลังโหลด…", "Loading…"))}</Box>;

  const when = (ts: number) => new Date(ts * 1000).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const g = h.growth;
  const signed = (n: number) => `${n >= 0 ? "+" : "−"}${formatBytes(Math.abs(n))}`;

  return (
    <div className="flex flex-col gap-[18px]">
      <section className="flex flex-col gap-2 rounded-card bg-surface p-6 shadow-card">
        {g ? (
          <>
            <h2 className="m-0 font-display text-lg font-medium">
              {g.delta === 0
                ? tr(l(`${rootPath} ขนาดไม่เปลี่ยนจากครั้งก่อน (${when(g.since)})`, `${rootPath} is unchanged since the last scan (${when(g.since)})`))
                : g.delta > 0
                ? tr(l(`${rootPath} โตขึ้น ${formatBytes(g.delta)} ตั้งแต่ ${when(g.since)}`, `${rootPath} grew by ${formatBytes(g.delta)} since ${when(g.since)}`))
                : tr(l(`${rootPath} ลดลง ${formatBytes(-g.delta)} ตั้งแต่ ${when(g.since)}`, `${rootPath} shrank by ${formatBytes(-g.delta)} since ${when(g.since)}`))}
            </h2>
            {g.drivers.length > 0 ? (
              <p className="m-0 text-sm text-muted">
                {tr(l("ส่วนที่โตขึ้นมากสุด: ", "Biggest growth: "))}
                {g.drivers.map((d) => `${d.path} (${signed(d.delta)})`).join(" · ")}
              </p>
            ) : (
              <p className="m-0 text-sm text-muted">{tr(l("ไม่มีโฟลเดอร์ไหนโตเกิน 50 MB", "No single folder grew by more than 50 MB"))}</p>
            )}
          </>
        ) : (
          <>
            <h2 className="m-0 font-display text-lg font-medium">{tr(l("ยังไม่มีข้อมูลเทียบ", "Nothing to compare yet"))}</h2>
            <p className="m-0 text-sm text-muted">{tr(l("นี่คือการสแกนครั้งแรกของที่นี่ — สแกนอีกครั้งในภายหลังเพื่อดูว่าพื้นที่โตขึ้นเพราะอะไร", "This is the first scan of this location — scan again later to see what made it grow"))}</p>
          </>
        )}
      </section>

      <section aria-label={tr(l("ประวัติการสแกน", "Scan history"))} className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card">
        <div className="px-[22px] pt-[18px] pb-2.5">
          <h2 className="m-0 font-display text-lg font-medium">{tr(l("การสแกนที่ผ่านมา", "Previous scans"))}</h2>
        </div>
        {h.snapshots.map((s, i) => {
          const prev = h.snapshots[i + 1];
          const d = prev ? s.size - prev.size : null;
          return (
            <div key={s.id} className="grid min-h-[54px] grid-cols-[minmax(0,1.6fr)_110px_minmax(0,1fr)_120px] items-center gap-4 border-t border-rowline px-[22px] text-[15px]">
              <span className="truncate font-medium">{when(s.ts)}</span>
              <span className="text-right font-semibold">{formatBytes(s.size)}</span>
              <span className="text-right text-[13px] text-muted">{tr(l(`${s.files.toLocaleString("th-TH")} ไฟล์`, `${s.files.toLocaleString("en-US")} files`))}</span>
              <span className={`inline-flex items-center justify-end gap-1 text-[13px] font-semibold ${d === null ? "text-muted" : d > 0 ? "text-warn-fg" : "text-safe-fg"}`}>
                {d === null ? "—" : (
                  <>
                    {d > 0 ? <ArrowUp size={14} strokeWidth={2.4} aria-hidden="true" /> : <ArrowDown size={14} strokeWidth={2.4} aria-hidden="true" />}
                    {signed(d)}
                  </>
                )}
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { FolderSearch, HardDrive, LoaderCircle, Plus, RotateCw, X } from "lucide-react";
import { Hero } from "../components/Hero";
import { cancelScan, startScan, useScan } from "../lib/scanStore";
import { formatBytes, scanner, type DriveInfo } from "../lib/tauri";
import { l, useI18n, type L } from "../i18n";
import { FolderView } from "./space/FolderView";
import { DupesView, HistoryView, OldFilesView } from "./space/ExtraViews";
import { TopFilesView, TypesView } from "./space/OverviewViews";

const TABS: { id: string; label: L; ready: boolean }[] = [
  { id: "folders", label: l("โฟลเดอร์", "Folders"), ready: true },
  { id: "types", label: l("ประเภทไฟล์", "File types"), ready: true },
  { id: "top", label: l("ไฟล์ใหญ่สุด", "Largest files"), ready: true },
  { id: "old", label: l("ไฟล์เก่า", "Old files"), ready: true },
  { id: "dupes", label: l("ไฟล์ซ้ำ", "Duplicates"), ready: true },
  { id: "history", label: l("ประวัติ", "History"), ready: true },
];

const BAR_COLORS = ["#5A94F0", "#3FC79A", "#39B5E6", "#8C7CF0", "#F2A46B", "#9DAAC0"];

const sameRoot = (a: string | null, b: string | null) => !!a && !!b && a.replace(/\\+$/, "").toLowerCase() === b.replace(/\\+$/, "").toLowerCase();

export function SpacePage() {
  const { t, tr, lang } = useI18n();
  const scan = useScan();
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [root, setRoot] = useState<string | null>(null);
  const [tab, setTab] = useState("folders");

  useEffect(() => {
    void scanner.listDrives().then((d) => {
      setDrives(d);
      setRoot((cur) => cur ?? d.find((x) => x.kind === "fixed")?.root ?? d[0]?.root ?? null);
    });
  }, []);

  // สแกนเสร็จแล้วให้หน้าจอโชว์ผลของ path นั้นเลย (รวมถึงเมื่อกลับมาที่หน้านี้ทีหลัง)
  const resultRoot = scan.summary?.rootPath ?? null;
  useEffect(() => {
    if (resultRoot) setRoot(resultRoot);
  }, [resultRoot]);

  const scanning = scan.status === "scanning";
  const selected = root ?? drives[0]?.root ?? null;
  const hasResult = !!scan.summary && sameRoot(scan.summary.rootPath, selected);
  const scanKey = scan.summary ? `${scan.summary.rootPath}|${scan.summary.elapsedMs}` : "";
  const drive = drives.find((d) => sameRoot(d.root, selected)) ?? null;
  const num = (n: number) => n.toLocaleString(lang === "th" ? "th-TH" : "en-US");

  // ชิปของโฟลเดอร์ที่เลือกเอง (ไม่ใช่ราก ของไดรฟ์)
  const customRoot = selected && !drives.some((d) => sameRoot(d.root, selected)) ? selected : null;

  const pick = async () => {
    const path = await scanner.pickFolder().catch(() => null);
    if (path) void startScan(path);
  };

  return (
    <>
      <Hero
        title={t.pages.space.title}
        subtitle={t.pages.space.subtitle}
        asideAlign="start"
        aside={
          scanning ? (
            <button
              type="button"
              onClick={cancelScan}
              className="inline-flex min-h-[52px] shrink-0 items-center gap-2 rounded-full bg-white px-[26px] text-base font-semibold text-danger-fg shadow-float transition hover:brightness-105"
            >
              <X size={18} strokeWidth={2.2} aria-hidden="true" />
              {tr(l("ยกเลิกการสแกน", "Cancel scan"))}
            </button>
          ) : (
            <button
              type="button"
              disabled={!selected}
              onClick={() => selected && void startScan(selected)}
              className="inline-flex min-h-[52px] shrink-0 items-center gap-2 rounded-full bg-white px-[26px] text-base font-semibold text-brand shadow-float transition hover:brightness-105 disabled:opacity-60"
            >
              <RotateCw size={18} strokeWidth={2.2} aria-hidden="true" />
              {hasResult ? tr(l("สแกนใหม่", "Scan again")) : tr(l("สแกนเลย", "Scan now"))}
            </button>
          )
        }
      >
        <div role="group" aria-label={tr(l("เลือกไดรฟ์", "Choose a drive"))} className="mt-3 flex flex-wrap gap-2">
          {drives.map((d) => {
            const active = sameRoot(d.root, selected);
            return (
              <button
                key={d.root}
                type="button"
                aria-pressed={active}
                disabled={scanning}
                onClick={() => setRoot(d.root)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full px-[18px] text-sm transition-colors disabled:cursor-not-allowed ${
                  active ? "bg-white font-semibold text-brand shadow-[0_8px_18px_rgba(10,50,140,0.2)]" : "border border-white/60 bg-white/15 text-white hover:bg-white/30 disabled:opacity-60 disabled:hover:bg-white/15"
                }`}
              >
                {active && <HardDrive size={18} strokeWidth={1.9} aria-hidden="true" />}
                {d.letter}: · {formatBytes(d.total)}
              </button>
            );
          })}
          {customRoot && (
            <button type="button" aria-pressed="true" className="inline-flex min-h-11 max-w-[320px] items-center gap-2 rounded-full bg-white px-[18px] text-sm font-semibold text-brand shadow-[0_8px_18px_rgba(10,50,140,0.2)]">
              <FolderSearch size={18} strokeWidth={1.9} aria-hidden="true" />
              <span className="truncate">{customRoot}</span>
            </button>
          )}
          <button
            type="button"
            disabled={scanning}
            onClick={() => void pick()}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-dashed border-white/85 px-[18px] text-sm text-white transition-colors hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
          >
            <Plus size={18} strokeWidth={1.9} aria-hidden="true" />
            {tr(l("เลือกโฟลเดอร์…", "Pick a folder…"))}
          </button>
        </div>
      </Hero>

      <div className="relative -mt-16 px-10">
        <Summary selected={selected} drive={drive} hasResult={hasResult} scanKey={scanKey} />
      </div>

      <div className="flex flex-col gap-[18px] px-10 pt-[22px] pb-10">
        {scanning ? (
          <ProgressCard target={scan.target ?? selected ?? ""} drive={drive} />
        ) : !hasResult ? (
          <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-14 text-center shadow-card">
            <span className="tile-violet flex h-[52px] w-[52px] items-center justify-center rounded-tile text-white">
              <FolderSearch size={24} strokeWidth={1.9} aria-hidden="true" />
            </span>
            <h2 className="m-0 font-display text-xl font-medium">
              {tr(l(`ยังไม่ได้สแกน ${selected ?? ""}`, `${selected ?? "This location"} has not been scanned yet`))}
            </h2>
            <p className="m-0 text-sm text-muted">{tr(l("กด \"สแกนเลย\" เพื่อดูว่าอะไรกินพื้นที่ — ไม่มีการแก้ไขหรือลบอะไรระหว่างสแกน", "Press \"Scan now\" to see what takes up space — nothing is changed or deleted while scanning"))}</p>
            {scan.error && <p role="alert" className="m-0 text-sm text-danger-fg">{scan.error}</p>}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div role="tablist" aria-label={tr(l("มุมมองข้อมูล", "Data views"))} className="inline-flex rounded-full bg-surface p-[5px] shadow-[0_6px_18px_rgba(40,100,190,0.08)]">
                {TABS.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === x.id}
                    onClick={() => setTab(x.id)}
                    className={`min-h-10 rounded-full px-4 text-sm transition-colors ${tab === x.id ? "bg-primary font-semibold text-white" : "text-ink-soft hover:bg-hover"}`}
                  >
                    {tr(x.label)}
                  </button>
                ))}
              </div>
              {scan.summary && (
                <span className="text-[13px] text-muted">
                  {tr(l(`${num(scan.summary.files)} ไฟล์ · ${num(scan.summary.dirs)} โฟลเดอร์ · สแกนใน ${(scan.summary.elapsedMs / 1000).toFixed(1)} วินาที`, `${num(scan.summary.files)} files · ${num(scan.summary.dirs)} folders · scanned in ${(scan.summary.elapsedMs / 1000).toFixed(1)} s`))}
                </span>
              )}
            </div>

            {tab === "folders" && scan.summary && <FolderView key={scanKey} rootPath={scan.summary.rootPath} scanKey={scanKey} />}
            {tab === "types" && <TypesView scanKey={scanKey} />}
            {tab === "top" && <TopFilesView scanKey={scanKey} />}
            {tab === "old" && <OldFilesView scanKey={scanKey} />}
            {tab === "dupes" && <DupesView scanKey={scanKey} />}
            {tab === "history" && scan.summary && <HistoryView rootPath={scan.summary.rootPath} scanKey={scanKey} />}
          </>
        )}
      </div>
    </>
  );
}

/* ───────── การ์ดสรุปการใช้พื้นที่ (กระจก ลอยทับ hero) ───────── */

function Summary({ selected, drive, hasResult, scanKey }: { selected: string | null; drive: DriveInfo | null; hasResult: boolean; scanKey: string }) {
  const { tr } = useI18n();
  const scan = useScan();
  const [top, setTop] = useState<{ k: string; items: { name: string; size: number }[] } | null>(null);

  useEffect(() => {
    if (!hasResult) return;
    let alive = true;
    scanner
      .children([])
      .then((c) => alive && setTop({ k: scanKey, items: c.children.map((x) => ({ name: x.name, size: x.size })) }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [hasResult, scanKey]);

  const used = hasResult && scan.summary ? scan.summary.size : drive ? drive.total - drive.free : 0;
  const whole = drive?.total ?? used;
  const parts = hasResult && top?.k === scanKey ? top.items.slice(0, 5) : [];
  const rest = Math.max(0, used - parts.reduce((s, p) => s + p.size, 0));
  const title = drive ? `${drive.letter}:` : (selected ?? "");

  return (
    <section aria-label={tr(l(`สรุปการใช้พื้นที่ ${title}`, `Space usage on ${title}`))} className="glass flex flex-col gap-3 rounded-card px-[26px] py-[22px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-display text-lg font-medium">{title}</span>
        <span className="text-sm text-muted">
          {hasResult && <>{tr(l("ใช้ไป", "Used"))} <strong className="text-ink">{formatBytes(used)}</strong></>}
          {hasResult && drive && " · "}
          {drive && <>{tr(l("ว่าง", "free"))} <strong className="text-ink">{formatBytes(drive.free)}</strong> {tr(l("จาก", "of"))} {formatBytes(drive.total)}</>}
        </span>
      </div>
      {hasResult && parts.length > 0 ? (
        <>
          <div role="img" aria-label={tr(l("แถบการใช้พื้นที่แบ่งตามโฟลเดอร์", "Space usage bar split by folder"))} className="flex h-4 gap-0.5 overflow-hidden rounded-lg bg-track">
            {parts.map((p, i) => (
              <div key={p.name} style={{ width: `${(p.size / whole) * 100}%`, background: BAR_COLORS[i] }} />
            ))}
            {rest > 0 && <div style={{ width: `${(rest / whole) * 100}%`, background: BAR_COLORS[5] }} />}
          </div>
          <div className="flex flex-wrap gap-[18px] text-[13px] text-info-fg">
            {parts.map((p, i) => (
              <span key={p.name} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: BAR_COLORS[i] }} />
                {p.name}
              </span>
            ))}
            {rest > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: BAR_COLORS[5] }} />
                {tr(l("อื่นๆ", "Others"))}
              </span>
            )}
            {drive && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full border border-edge-2 bg-track" />
                {tr(l("ว่าง", "Free"))}
              </span>
            )}
          </div>
        </>
      ) : drive ? (
        <div className="h-4 overflow-hidden rounded-lg bg-track">
          <div className="h-full bg-meter" style={{ width: `${(used / drive.total) * 100}%` }} />
        </div>
      ) : null}
    </section>
  );
}

/* ───────── ความคืบหน้าระหว่างสแกน ───────── */

function ProgressCard({ target, drive }: { target: string; drive: DriveInfo | null }) {
  const { tr, lang } = useI18n();
  const { progress } = useScan();
  const num = (n: number) => n.toLocaleString(lang === "th" ? "th-TH" : "en-US");
  const files = progress?.files ?? 0;
  const bytes = progress?.bytes ?? 0;
  // ไม่รู้จำนวนไฟล์ทั้งหมดล่วงหน้า จึงประมาณจากพื้นที่ที่ไดรฟ์ใช้อยู่ (ประมาณการเท่านั้น)
  const est = drive ? Math.min(99, Math.round((bytes / Math.max(1, drive.total - drive.free)) * 100)) : null;
  const stats = useMemo(
    () => [
      { label: l("ไฟล์", "Files"), value: num(files) },
      { label: l("โฟลเดอร์", "Folders"), value: num(progress?.dirs ?? 0) },
      { label: l("ขนาดที่พบ", "Found so far"), value: formatBytes(bytes) },
      { label: l("อ่านไม่ได้", "Unreadable"), value: num(progress?.errors ?? 0) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [progress, lang],
  );

  return (
    <section aria-live="polite" className="flex flex-col gap-4 rounded-card bg-surface p-6 shadow-card">
      <div className="flex items-center gap-3">
        <LoaderCircle size={22} strokeWidth={2.2} className="animate-spin text-brand" aria-hidden="true" />
        <h2 className="m-0 font-display text-xl font-medium">{tr(l(`กำลังสแกน ${target}`, `Scanning ${target}`))}</h2>
        {est !== null && <span className="ml-auto text-sm text-muted">{tr(l(`ประมาณ ${est}%`, `about ${est}%`))}</span>}
      </div>
      <div className="h-2.5 overflow-hidden rounded-[5px] bg-track">
        <div className={`h-full rounded-[5px] bg-meter transition-[width] duration-300 ${est === null ? "w-1/3 animate-pulse" : ""}`} style={est === null ? undefined : { width: `${est}%` }} />
      </div>
      <div className="grid grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label.en} className="flex flex-col gap-0.5 rounded-[14px] bg-app px-3.5 py-2.5">
            <span className="text-[13px] text-muted">{tr(s.label)}</span>
            <span className="font-display text-lg font-medium">{s.value}</span>
          </div>
        ))}
      </div>
      <p className="m-0 truncate text-xs text-muted" dir="ltr">{progress?.current || "…"}</p>
    </section>
  );
}

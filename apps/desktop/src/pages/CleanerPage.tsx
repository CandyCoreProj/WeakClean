import { useEffect, useRef, useState } from "react";
import { ChevronRight, Info, LoaderCircle, RotateCw, Sparkles } from "lucide-react";
import { Badge } from "../components/Badge";
import { Dialog } from "../components/Dialog";
import { Hero } from "../components/Hero";
import { ResultBanner } from "../components/ResultBanner";
import { useToast } from "../components/Toast";
import { rescanCleaner, useCleaner } from "../lib/cleanerStore";
import { useBoost } from "../lib/boostStore";
import { boost, cleaner, formatBytes, type CleanCategory, type CleanResult, type Preview } from "../lib/tauri";
import { l, useI18n, type PageId } from "../i18n";

export function CleanerPage({ onNavigate }: { onNavigate: (id: PageId) => void }) {
  const { t, tr, lang } = useI18n();
  const toast = useToast();
  const { status, catalog, sizes } = useCleaner();
  const elevated = useBoost().elevated;
  const [on, setOn] = useState<Record<string, boolean>>({});
  const seeded = useRef(false);
  const [confirm, setConfirm] = useState(false);
  const [cleaning, setCleaning] = useState<{ bytes: number } | null>(null);
  const [result, setResult] = useState<CleanResult | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; data: Preview } | null>(null);

  // ติ๊กหมวดตั้งต้นครั้งเดียวหลังสแกนครั้งแรก (เฉพาะหมวดที่มีไฟล์จริง) หลังจากนั้นเป็นของผู้ใช้
  useEffect(() => {
    if (status !== "ready" || seeded.current) return;
    seeded.current = true;
    setOn(Object.fromEntries(catalog.map((c) => [c.id, c.defaultOn && (sizes[c.id]?.files ?? 0) > 0])));
  }, [status, catalog, sizes]);

  useEffect(() => {
    let off: (() => void) | undefined;
    void cleaner.onProgress((p) => setCleaning({ bytes: p.bytes })).then((u) => (off = u));
    return () => off?.();
  }, []);

  const name = (c: CleanCategory) => (lang === "th" ? c.nameTh : c.nameEn);
  const desc = (c: CleanCategory) => (lang === "th" ? c.descTh : c.descEn);
  const sizeOf = (id: string) => sizes[id]?.bytes ?? 0;
  const filesOf = (id: string) => sizes[id]?.files ?? 0;
  const picked = catalog.filter((c) => on[c.id] && filesOf(c.id) > 0);
  const totalBytes = picked.reduce((s, c) => s + sizeOf(c.id), 0);
  const scanning = status === "scanning";
  const num = (n: number) => n.toLocaleString(lang === "th" ? "th-TH" : "en-US");

  const toggle = (id: string) => setOn((prev) => ({ ...prev, [id]: !prev[id] }));
  const selectSafe = () => setOn(Object.fromEntries(catalog.map((c) => [c.id, c.group === "safe" && c.defaultOn && filesOf(c.id) > 0])));

  /** หมวดที่เลือกและต้องสิทธิ์ผู้ดูแล (ถ้าเปิดแอปแบบผู้ใช้ปกติ ไฟล์กลุ่มนี้จะถูกลบไม่ได้) */
  const adminPicked = picked.filter((c) => c.requiresAdmin);

  const run = async (ids?: string[]) => {
    setConfirm(false);
    setResult(null);
    setCleaning({ bytes: 0 });
    try {
      const r = await cleaner.clean(ids ?? picked.map((c) => c.id));
      setResult(r);
    } catch (e) {
      toast(String(e));
    } finally {
      setCleaning(null);
      void rescanCleaner();
    }
  };

  // เพิ่งเปิดใหม่แบบผู้ดูแลเพื่อล้างต่อ: รายการที่ผู้ใช้ยืนยันไว้แล้วถูกจำไว้ จึงล้างต่อให้เลย
  useEffect(() => {
    void cleaner
      .takePending()
      .then((ids) => {
        if (ids.length > 0) void run(ids);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** กดล้างแล้วมีหมวดที่ต้องสิทธิ์ผู้ดูแล: จำรายการไว้ ขอสิทธิ์ครั้งเดียว (UAC) แล้วเปิดแอปใหม่เพื่อล้างต่อ */
  const elevateAndClean = async () => {
    setConfirm(false);
    try {
      await cleaner.setPending(picked.map((c) => c.id));
      await boost.relaunchAdmin();
    } catch {
      // ผู้ใช้กด "ไม่" ในหน้าต่าง UAC: ทิ้งรายการที่จำไว้ ไม่ให้ไปล้างเองในรอบถัดไป
      await cleaner.setPending([]);
      toast(tr(l("ยกเลิกการขอสิทธิ์ผู้ดูแล", "Administrator permission was declined")));
    }
  };

  const toggleOpen = async (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    setPreview(null);
    try {
      setPreview({ id, data: await cleaner.files(id, 8) });
    } catch {
      setOpen(null);
    }
  };

  const row = (c: CleanCategory) => {
    const files = filesOf(c.id);
    const empty = !scanning && files === 0;
    return (
      <div key={c.id} className="border-t border-rowline">
        <div className="flex items-center gap-3 py-0.5 pr-4 pl-2">
          <label className={`flex min-h-[62px] min-w-0 flex-1 items-center gap-3.5 px-3.5 py-2 ${empty ? "cursor-default opacity-55" : "cursor-pointer"}`}>
            <input
              type="checkbox"
              checked={!!on[c.id] && !empty}
              disabled={empty || !!cleaning}
              onChange={() => toggle(c.id)}
              className="m-0 h-[22px] w-[22px] shrink-0 cursor-pointer accent-brand disabled:cursor-default"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
                {name(c)}
                {c.requiresAdmin && <Badge tone="info">{tr(l("ต้องเปิดแบบผู้ดูแล", "Needs admin"))}</Badge>}
              </span>
              <span className="text-[13px] text-muted">{desc(c)}</span>
            </span>
          </label>
          <span className="flex flex-col items-end">
            <span className="font-display text-[17px] font-medium whitespace-nowrap">{scanning && !sizes[c.id] ? "…" : formatBytes(sizeOf(c.id))}</span>
            {files > 0 && <span className="text-xs text-muted">{tr(l(`${num(files)} ไฟล์`, `${num(files)} files`))}</span>}
          </span>
          <button
            type="button"
            onClick={() => void toggleOpen(c.id)}
            disabled={files === 0}
            aria-expanded={open === c.id}
            aria-label={tr(l(`ดูไฟล์ในหมวด ${c.nameTh}`, `Browse files in ${c.nameEn}`))}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronRight size={18} strokeWidth={2} aria-hidden="true" className={`transition-transform ${open === c.id ? "rotate-90" : ""}`} />
          </button>
        </div>
        {open === c.id && (
          <div className="mx-6 mb-3 flex flex-col overflow-hidden rounded-2xl bg-app">
            {preview?.id === c.id ? (
              <>
                {preview.data.files.map((f) => (
                  <div key={f.path} className="flex items-center gap-3 border-b border-line px-4 py-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate" dir="ltr" title={f.path}>{f.path}</span>
                    <span className="shrink-0 font-semibold">{formatBytes(f.size)}</span>
                  </div>
                ))}
                {preview.data.total > preview.data.files.length && (
                  <span className="px-4 py-2 text-xs text-muted">
                    {tr(l(`และอีก ${num(preview.data.total - preview.data.files.length)} ไฟล์`, `and ${num(preview.data.total - preview.data.files.length)} more files`))}
                  </span>
                )}
              </>
            ) : (
              <span className="px-4 py-3 text-xs text-muted">{tr(l("กำลังโหลด…", "Loading…"))}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <Hero
        title={t.pages.cleaner.title}
        subtitle={scanning ? tr(l("กำลังตรวจหาขยะในเครื่อง…", "Looking for junk on your PC…")) : t.pages.cleaner.subtitle}
        aside={
          <div className="glass flex w-[380px] shrink-0 flex-col gap-3 rounded-[28px] px-6 py-[22px]">
            <span className="flex items-center justify-between gap-2 text-sm text-muted">
              {tr(l(`เลือกไว้ ${picked.length} หมวด · กู้คืนได้ภายใน 7 วัน`, `${picked.length} selected · restorable for 7 days`))}
              <button
                type="button"
                onClick={() => void rescanCleaner()}
                disabled={scanning || !!cleaning}
                aria-label={tr(l("สแกนใหม่", "Scan again"))}
                title={tr(l("สแกนใหม่", "Scan again"))}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-brand transition-colors hover:bg-hover disabled:opacity-50"
              >
                <RotateCw size={16} strokeWidth={2.2} className={scanning ? "animate-spin" : ""} aria-hidden="true" />
              </button>
            </span>
            <span className="bg-linear-to-r from-brand to-[#1592C9] bg-clip-text font-display text-[44px] leading-[1.1] font-medium text-transparent">
              {formatBytes(totalBytes)}
            </span>
            {cleaning ? (
              <div role="status" className="flex min-h-[54px] items-center justify-center gap-2.5 rounded-full bg-hover text-[15px] font-medium text-brand">
                <LoaderCircle size={20} strokeWidth={2.2} className="animate-spin" aria-hidden="true" />
                {tr(l(`กำลังย้ายเข้าที่กักกัน… ${formatBytes(cleaning.bytes)}`, `Moving to quarantine… ${formatBytes(cleaning.bytes)}`))}
              </div>
            ) : (
              <button
                type="button"
                disabled={picked.length === 0 || scanning}
                onClick={() => setConfirm(true)}
                className="inline-flex min-h-[54px] items-center justify-center gap-2.5 rounded-full bg-primary text-[17px] font-semibold text-white shadow-[0_12px_26px_rgba(26,92,224,0.32)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
              >
                <Sparkles size={20} strokeWidth={2} aria-hidden="true" />
                {tr(l(`ล้าง ${formatBytes(totalBytes)}`, `Clean ${formatBytes(totalBytes)}`))}
              </button>
            )}
            <button
              type="button"
              onClick={selectSafe}
              disabled={!!cleaning || scanning}
              className="min-h-11 rounded-full border border-edge bg-surface text-sm text-ink transition-colors hover:bg-hover disabled:opacity-50"
            >
              {tr(l("เลือกเฉพาะที่ปลอดภัย", "Select only the safe ones"))}
            </button>
          </div>
        }
      />

      <div className="relative -mt-16 flex flex-col gap-[18px] px-10 pb-10">
        {result && (
          <ResultBanner
            title={
              result.movedFiles > 0
                ? tr(l(`คืนพื้นที่ได้ ${formatBytes(result.movedBytes)} แล้ว`, `Freed ${formatBytes(result.movedBytes)}`))
                : tr(l("ไม่มีไฟล์ที่ย้ายได้ในรอบนี้", "No files could be moved this time"))
            }
            text={
              (result.movedFiles > 0 ? tr(l("ไฟล์ถูกเก็บในที่กักกัน 7 วัน — เปลี่ยนใจได้ที่หน้า ประวัติ & กู้คืน", "Files are kept in quarantine for 7 days — change your mind in History & Restore")) : "") +
              (result.skippedFiles > 0
                ? ` ${tr(l(`ข้าม ${num(result.skippedFiles)} ไฟล์ (${formatBytes(result.skippedBytes)}) ที่กำลังถูกใช้งานหรือไม่มีสิทธิ์`, `Skipped ${num(result.skippedFiles)} files (${formatBytes(result.skippedBytes)}) that are in use or need permission`))}`
                : "")
            }
          >
            <button type="button" onClick={() => onNavigate("safety")} className="text-[15px] font-semibold text-link hover:underline">
              {tr(l("ดูประวัติ", "View history"))}
            </button>
            <button type="button" onClick={() => setResult(null)} className="min-h-10 rounded-full border border-edge-2 bg-surface px-4 text-sm transition-colors hover:bg-hover">
              {tr(l("ปิด", "Dismiss"))}
            </button>
          </ResultBanner>
        )}

        {status === "error" && (
          <p role="alert" className="m-0 rounded-card bg-danger-bg px-6 py-4 text-sm text-danger-fg">
            {tr(l("ตรวจหาขยะไม่สำเร็จ ลองกดสแกนใหม่อีกครั้ง", "Couldn't look for junk — try scanning again"))}
          </p>
        )}

        <section aria-labelledby="safe-title" className="glass flex flex-col overflow-hidden rounded-card">
          <div className="flex items-center gap-2.5 px-[22px] pt-[18px] pb-2.5">
            <h2 id="safe-title" className="m-0 font-display text-lg font-medium">
              {tr(l("ปลอดภัย", "Safe"))}
            </h2>
            <Badge tone="safe">{tr(l("ลบได้โดยไม่กระทบการใช้งาน", "Won't affect how you use your PC"))}</Badge>
          </div>
          {catalog.filter((c) => c.group === "safe").map(row)}
        </section>

        <section aria-labelledby="check-title" className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card">
          <div className="flex items-center gap-2.5 px-[22px] pt-[18px] pb-2.5">
            <h2 id="check-title" className="m-0 font-display text-lg font-medium">
              {tr(l("ตรวจสอบก่อน", "Check first"))}
            </h2>
            <Badge tone="warn">{tr(l("อาจมีไฟล์ที่คุณยังต้องการ", "May contain files you still need"))}</Badge>
          </div>
          {catalog.filter((c) => c.group === "check").map(row)}
        </section>

        <p className="m-0 flex items-center gap-2 text-[13px] text-muted">
          <Info size={16} strokeWidth={1.9} aria-hidden="true" />
          {tr(l("ไฟล์ที่กำลังถูกใช้งานจะถูกข้ามอัตโนมัติ และไม่มีการแตะรหัสผ่าน คุกกี้ หรือไฟล์ส่วนตัวของคุณ · ถังขยะและ Windows.old จะมาใน Phase ถัดไป", "Files in use are skipped automatically, and passwords, cookies and personal files are never touched · the Recycle Bin and Windows.old come in a later phase"))}
        </p>
      </div>

      <Dialog open={confirm} onClose={() => setConfirm(false)} labelledBy="clean-confirm-title">
        <h2 id="clean-confirm-title" className="m-0 font-display text-2xl font-medium">
          {tr(l(`ล้าง ${formatBytes(totalBytes)} ใช่ไหม?`, `Clean ${formatBytes(totalBytes)}?`))}
        </h2>
        <div className="scroll flex max-h-[240px] flex-col overflow-y-auto rounded-[18px] bg-app">
          {picked.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5 border-b border-line px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{name(c)}</span>
              <span className="shrink-0 font-semibold">{formatBytes(sizeOf(c.id))}</span>
            </div>
          ))}
        </div>
        <p className="m-0 text-sm leading-relaxed text-info-fg">
          {tr(l("ไฟล์จะถูก \"ย้าย\" ไปที่กักกันก่อน ไม่ได้ลบถาวร — กู้คืนได้ภายใน 7 วันที่หน้า ประวัติ & กู้คืน ไฟล์ที่กำลังถูกใช้งานจะถูกข้าม", "Files are \"moved\" to quarantine, not permanently deleted — restore them within 7 days from History & Restore. Files in use are skipped."))}
        </p>
        {adminPicked.length > 0 && !elevated && (
          <p className="m-0 rounded-2xl bg-warn-bg px-4 py-3 text-sm leading-relaxed text-warn-fg">
            {tr(l(
              `${adminPicked.length} หมวดที่เลือกต้องสิทธิ์ผู้ดูแล · กดปุ่มด้านล่างจะขึ้นหน้าต่าง Windows ขออนุญาตหนึ่งครั้ง แล้วเปิดโปรแกรมใหม่เพื่อล้างต่อทันที`,
              `${adminPicked.length} selected categories need administrator rights · the button below asks Windows once, then reopens the app and continues cleaning automatically`,
            ))}
          </p>
        )}
        <div className="mt-1 flex justify-end gap-2.5">
          <button type="button" onClick={() => setConfirm(false)} className="min-h-[50px] rounded-full border border-edge bg-surface px-6 text-[15px] transition-colors hover:bg-hover">
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={() => void (adminPicked.length > 0 && !elevated ? elevateAndClean() : run())}
            className="min-h-[50px] rounded-full bg-primary px-[26px] text-[15px] font-semibold text-white shadow-primary transition hover:brightness-105"
          >
            {adminPicked.length > 0 && !elevated ? tr(l("ขอสิทธิ์แล้วล้างต่อ", "Allow and clean")) : tr(l("ยืนยันและล้าง", "Confirm and clean"))}
          </button>
        </div>
      </Dialog>
    </>
  );
}

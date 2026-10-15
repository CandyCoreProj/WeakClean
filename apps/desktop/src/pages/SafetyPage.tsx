import { useCallback, useEffect, useState } from "react";
import { Archive, ShieldCheck, Sparkles, Trash2, TriangleAlert, Undo2, Zap, type LucideIcon } from "lucide-react";
import { Badge } from "../components/Badge";
import { Dialog } from "../components/Dialog";
import { Hero } from "../components/Hero";
import { Row } from "../components/Row";
import { Segmented } from "../components/Segmented";
import { useToast } from "../components/Toast";
import { useCleaner } from "../lib/cleanerStore";
import { failureText, refreshBoost, useBoost } from "../lib/boostStore";
import { boost, cleaner, formatBytes, settings, type RestoreResult, type RevertResult, type SafetyEvent, type SafetyOverview } from "../lib/tauri";
import { l, useI18n } from "../i18n";

const RETENTION_CHOICES = [3, 7, 14, 30, 90];

const dayKey = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function SafetyPage() {
  const { t, tr, lang } = useI18n();
  const toast = useToast();
  const { catalog: cleanCatalog } = useCleaner();
  const tweaks = useBoost();
  const [data, setData] = useState<SafetyOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [driftDismissed, setDriftDismissed] = useState(false);
  const [pendingDays, setPendingDays] = useState<number | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await cleaner.overview());
      setFailed(false);
    } catch {
      setFailed(true);
    }
    void refreshBoost();
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const locale = lang === "th" ? "th-TH" : "en-US";
  const num = (n: number) => n.toLocaleString(locale);
  const catName = (id: string) => {
    if (id === "old_files") return tr(l("ไฟล์เก่า", "Old files"));
    if (id === "duplicates") return tr(l("ไฟล์ซ้ำ", "Duplicate files"));
    if (id === "disk_space") return tr(l("ลบเองจากพื้นที่ดิสก์", "Deleted from Disk space"));
    const c = cleanCatalog.find((x) => x.id === id);
    return c ? (lang === "th" ? c.nameTh : c.nameEn) : id;
  };
  const tweakMeta = (id: string) => tweaks.catalog.find((x) => x.id === id);
  const tweakName = (id: string) => {
    const m = tweakMeta(id);
    return m ? (lang === "th" ? m.nameTh : m.nameEn) : id;
  };

  const explainRestore = (r: RestoreResult) => {
    const parts = [tr(l(`กู้คืน ${num(r.restoredFiles)} ไฟล์ (${formatBytes(r.restoredBytes)}) แล้ว`, `Restored ${num(r.restoredFiles)} files (${formatBytes(r.restoredBytes)})`))];
    if (r.conflicts > 0) parts.push(tr(l(`ข้าม ${num(r.conflicts)} ไฟล์ที่ปลายทางมีไฟล์ชื่อเดียวกันอยู่แล้ว`, `${num(r.conflicts)} skipped — a file with the same name already exists`)));
    if (r.failed > 0) parts.push(tr(l(`กู้ไม่ได้ ${num(r.failed)} ไฟล์`, `${num(r.failed)} could not be restored`)));
    return parts.join(" · ");
  };
  const explainRevert = (r: RevertResult) => {
    const parts = [tr(l(`ย้อนกลับ ${num(r.reverted)} การปรับแต่งแล้ว`, `Undid ${num(r.reverted)} tweaks`))];
    for (const f of r.failed) parts.push(`${tweakName(f.id)} — ${tr(failureText(f.reason))}`);
    return parts.join(" · ");
  };

  const run = async (key: string, job: () => Promise<string>) => {
    setBusy(key);
    try {
      toast(await job());
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(null);
      void load();
    }
  };

  const events = data?.events ?? [];
  const changes = data?.changes ?? [];
  const q = data?.quarantine;
  const restorable = events.some((e) => e.state === "active" || e.state === "partial");
  const daysLeft = q?.nextExpiry ? Math.max(0, Math.ceil((q.nextExpiry * 1000 - Date.now()) / 86_400_000)) : (q?.retentionDays ?? 7);
  const activeTweaks = Object.values(tweaks.states).filter((s) => s === "on").length;
  const drifted = tweaks.catalog.filter((c) => tweaks.states[c.id] === "drifted");

  const undoAll = async () => {
    setConfirmAll(false);
    await run("all", async () => {
      const r = await cleaner.undoAll();
      return [explainRestore(r.restore), explainRevert(r.revert)].join(" · ");
    });
  };

  const purgedText = (files: number, bytes: number) => tr(l(`ลบถาวรแล้ว ${num(files)} ไฟล์ (${formatBytes(bytes)})`, `Permanently deleted ${num(files)} files (${formatBytes(bytes)})`));
  const changeRetention = async (days: number) => {
    setPendingDays(null);
    await run("ret", async () => {
      const r = await settings.setRetention(days);
      const set = tr(l(`ตั้งเป็น ${days} วันแล้ว`, `Set to ${days} days`));
      return r.files > 0 ? `${set} · ${purgedText(r.files, r.bytes)}` : set;
    });
  };
  const emptyQuarantine = async () => {
    setPurgeOpen(false);
    await run("purge", async () => {
      const r = await settings.purgeQuarantine();
      return purgedText(r.files, r.bytes);
    });
  };
  // ลดจำนวนวัน = ของที่เก่ากว่าจะถูกลบถาวรทันที จึงถามก่อนถ้ามีอะไรอยู่ในที่กักกัน
  const pickRetention = (days: number) => {
    if (!q || days === q.retentionDays) return;
    if (days < q.retentionDays && q.files > 0) setPendingDays(days);
    else void changeRetention(days);
  };

  const stats: { icon: LucideIcon; tile: string; label: string; value: string }[] = [
    { icon: Sparkles, tile: "tile-blue", label: tr(l("พื้นที่ที่ล้างไปแล้วทั้งหมด", "Total space cleaned so far")), value: formatBytes(q?.lifetimeFreed ?? 0) },
    {
      icon: Archive,
      tile: "tile-mint",
      label: q && q.bytes > 0 ? tr(l(`ไฟล์ในที่กักกัน · ชุดเก่าสุดลบถาวรใน ${daysLeft} วัน`, `Quarantined files · oldest batch deleted for good in ${daysLeft} d`)) : tr(l("ไฟล์ในที่กักกัน", "Quarantined files")),
      value: formatBytes(q?.bytes ?? 0),
    },
    { icon: Zap, tile: "tile-violet", label: tr(l("การปรับแต่งที่ใช้อยู่", "Active tweaks")), value: tr(l(`${activeTweaks} อย่าง`, `${activeTweaks}`)) },
  ];

  const now = new Date();
  const today = dayKey(Math.floor(now.getTime() / 1000));
  const yesterday = dayKey(Math.floor(now.getTime() / 1000) - 86_400);
  const days: { key: string; label: string; events: SafetyEvent[] }[] = [];
  for (const e of events) {
    const k = dayKey(e.ts);
    let day = days.find((d) => d.key === k);
    if (!day) {
      const label = k === today ? tr(l("วันนี้", "Today")) : k === yesterday ? tr(l("เมื่อวาน", "Yesterday")) : new Date(e.ts * 1000).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
      day = { key: k, label, events: [] };
      days.push(day);
    }
    day.events.push(e);
  }

  const cleanSub = (e: SafetyEvent) => {
    const cats = (e.params.categories ?? []).length;
    // ของที่ผู้ใช้ลบเองจากหน้า พื้นที่ดิสก์ นับเป็น "รายการ" (โฟลเดอร์ทั้งก้อนนับเป็น 1) ไม่ใช่หมวดขยะ
    const space = (e.params.categories ?? []).includes("disk_space");
    const base = space
      ? tr(l(`${num(e.params.files ?? 0)} รายการ`, `${num(e.params.files ?? 0)} items`))
      : tr(l(`${cats} หมวด · ${num(e.params.files ?? 0)} ไฟล์`, `${cats} categories · ${num(e.params.files ?? 0)} files`));
    switch (e.state) {
      case "active": {
        const left = Math.max(0, Math.ceil(((e.ts + (q?.retentionDays ?? 7) * 86_400) * 1000 - Date.now()) / 86_400_000));
        return `${base} · ${tr(l(`อยู่ในที่กักกันอีก ${left} วัน`, `kept in quarantine for ${left} more days`))}`;
      }
      case "partial":
        return `${base} · ${tr(l(`กู้คืนบางส่วน — เหลือ ${num(e.heldFiles)} ไฟล์ในที่กักกัน (ปลายทางมีไฟล์ชื่อเดียวกัน)`, `partly restored — ${num(e.heldFiles)} files remain in quarantine (same name already exists)`))}`;
      case "undone":
        return `${base} · ${tr(l("กู้คืนแล้ว", "restored"))}`;
      default:
        return `${base} · ${tr(l("พ้นกำหนดและลบถาวรแล้ว", "past retention and permanently deleted"))}`;
    }
  };

  const boostTitle = (e: SafetyEvent) => {
    const p = e.params.profile;
    if (p === "balanced") return tr(l("ใช้โปรไฟล์สมดุล", "Applied the Balanced profile"));
    if (p === "gaming") return tr(l("ใช้โปรไฟล์เกมมิ่ง", "Applied the Gaming profile"));
    if (p === "reapply") return tr(l("ใช้การปรับแต่งใหม่ (หลัง Windows คืนค่า)", "Re-applied tweaks (after Windows reverted them)"));
    return tr(l("ปรับแต่งเอง", "Custom tweaks"));
  };
  const boostSub = (e: SafetyEvent) => {
    const ids = e.params.tweaks ?? [];
    const reboots = ids.filter((id) => tweakMeta(id)?.reboot).length;
    const rp = e.params.restorePoint === "created" ? tr(l("สร้างจุดคืนค่าแล้ว", "restore point created")) : e.params.restorePoint === "failed" ? tr(l("สร้างจุดคืนค่าไม่สำเร็จ", "restore point failed")) : "";
    return [tr(l(`${ids.length} การปรับแต่ง`, `${ids.length} tweaks`)), reboots > 0 ? tr(l(`ต้องรีบูต ${reboots} อย่าง`, `${reboots} need a restart`)) : "", rp].filter(Boolean).join(" · ");
  };

  return (
    <>
      <Hero
        tall
        title={t.pages.safety.title}
        subtitle={t.pages.safety.subtitle}
        asideAlign="start"
        aside={
          <button
            type="button"
            disabled={!restorable || busy !== null}
            onClick={() => setConfirmAll(true)}
            className="inline-flex min-h-[52px] shrink-0 items-center gap-2 rounded-full bg-white px-[22px] text-[15px] font-semibold text-danger-deep shadow-float transition hover:brightness-105 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/85 disabled:shadow-none disabled:hover:brightness-100"
          >
            <Undo2 size={18} strokeWidth={2.2} aria-hidden="true" />
            {tr(l("คืนค่าทุกอย่างที่ WeakClean เคยทำ", "Undo everything WeakClean has done"))}
          </button>
        }
      />

      <div className="relative -mt-[78px] flex flex-col gap-[18px] px-10 pb-10">
        <div className="grid grid-cols-3 gap-4">
          {stats.map(({ icon: Icon, tile, label, value }) => (
            <div key={label} className="glass flex items-center gap-4 rounded-card px-[22px] py-5">
              <span className={`${tile} flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-tile text-white`}>
                <Icon size={24} strokeWidth={1.9} aria-hidden="true" />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] text-muted">{label}</span>
                <span className="font-display text-[22px] font-medium">{value}</span>
              </div>
            </div>
          ))}
        </div>

        {drifted.length > 0 && !driftDismissed && (
          <div role="status" className="flex items-center gap-3.5 rounded-[22px] bg-warn-bg px-5 py-4 text-warn-ink">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-surface text-warn-fg">
              <TriangleAlert size={20} strokeWidth={2} aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{tr(l(`Windows คืนค่าการปรับแต่งของคุณ ${drifted.length} อย่าง`, `Windows reverted ${drifted.length} of your tweaks`))}</span>
              <span className="text-sm">{drifted.map((c) => tweakName(c.id)).join(" · ")}</span>
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run("drift", async () => {
                  const r = await boost.apply(drifted.map((c) => c.id), "reapply");
                  return [tr(l(`ใช้ใหม่ ${r.applied.length} อย่าง`, `Re-applied ${r.applied.length}`)), ...r.failed.map((f) => `${tweakName(f.id)} — ${tr(failureText(f.reason))}`)].join(" · ");
                })
              }
              className="min-h-11 rounded-full bg-primary px-5 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
            >
              {tr(l("ใช้ใหม่", "Re-apply"))}
            </button>
            <button type="button" onClick={() => setDriftDismissed(true)} className="min-h-11 rounded-full border border-warn-edge px-4 text-sm transition-colors hover:bg-white/50">
              {tr(l("ไม่ต้อง", "No thanks"))}
            </button>
          </div>
        )}

        {failed && (
          <p role="alert" className="m-0 rounded-card bg-danger-bg px-6 py-4 text-sm text-danger-fg">
            {tr(l("อ่านประวัติไม่สำเร็จ", "Couldn't read the history"))}
          </p>
        )}

        {data && events.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-14 text-center shadow-card">
            <span className="tile-mint flex h-[52px] w-[52px] items-center justify-center rounded-tile text-white">
              <ShieldCheck size={24} strokeWidth={1.9} aria-hidden="true" />
            </span>
            <h2 className="m-0 font-display text-xl font-medium">{tr(l("ยังไม่มีประวัติ", "No history yet"))}</h2>
            <p className="m-0 text-sm text-muted">{tr(l("ทุกครั้งที่ล้างขยะหรือปรับแต่งเครื่อง จะมาแสดงที่นี่ และย้อนกลับได้", "Every time you clean up or tweak your PC, it shows up here and can be undone"))}</p>
          </div>
        )}

        {days.map((day) => (
          <section key={day.key} className="flex flex-col gap-2.5">
            <h2 className="mt-1 mb-0 font-display text-base font-medium text-ink-soft">{day.label}</h2>
            <div className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card">
              {day.events.map((e) => {
                const isBoost = e.kind === "boost";
                const kids = isBoost ? changes.filter((c) => c.eventId === e.id) : [];
                const undoable = e.state === "active" || e.state === "partial";
                return (
                  <div key={e.id} className="flex flex-col border-b border-rowline last:border-b-0">
                    <div className="flex items-center gap-3.5 px-[22px] py-4">
                      <span className={`${isBoost ? "tile-mint" : "tile-blue"} flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white`}>
                        {isBoost ? <Zap size={20} strokeWidth={1.9} aria-hidden="true" /> : <Sparkles size={20} strokeWidth={1.9} aria-hidden="true" />}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center gap-2">
                          <span className="text-base font-medium">
                            {isBoost
                              ? boostTitle(e)
                              : (e.params.categories ?? []).includes("disk_space")
                                ? tr(l(`ลบ ${formatBytes(e.params.bytes ?? 0)} จากหน้า พื้นที่ดิสก์`, `Deleted ${formatBytes(e.params.bytes ?? 0)} from Disk space`))
                                : tr(l(`ล้างขยะ ${formatBytes(e.params.bytes ?? 0)}`, `Cleaned ${formatBytes(e.params.bytes ?? 0)} of junk`))}
                          </span>
                          {e.state === "undone" && <Badge tone="info">{isBoost ? tr(l("ย้อนกลับแล้ว", "Undone")) : tr(l("กู้คืนแล้ว", "Restored"))}</Badge>}
                          {e.state === "expired" && <Badge tone="warn">{tr(l("หมดอายุ", "Expired"))}</Badge>}
                          {e.state === "partial" && <Badge tone="warn">{isBoost ? tr(l("ย้อนกลับบางส่วน", "Partly undone")) : tr(l("กู้คืนบางส่วน", "Partly restored"))}</Badge>}
                        </span>
                        <span className="text-[13px] text-muted">
                          {new Date(e.ts * 1000).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })} · {isBoost ? boostSub(e) : cleanSub(e)}
                        </span>
                        {!isBoost && (e.params.categories ?? []).length > 0 && (
                          <span className="mt-1 flex flex-wrap gap-1.5">
                            {(e.params.categories ?? []).map((id) => (
                              <Badge key={id} tone="info">{catName(id)}</Badge>
                            ))}
                          </span>
                        )}
                      </div>
                      {undoable && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            void run(`e${e.id}`, async () => (isBoost ? explainRevert(await boost.revertEvent(e.id)) : explainRestore(await cleaner.restore(e.id))))
                          }
                          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-edge bg-surface px-[18px] text-sm transition-colors hover:bg-hover disabled:opacity-60"
                        >
                          <Undo2 size={16} strokeWidth={2.2} aria-hidden="true" />
                          {isBoost ? tr(l("คืนค่าทั้งชุด", "Undo whole batch")) : tr(l("กู้คืนไฟล์", "Restore files"))}
                        </button>
                      )}
                    </div>
                    {kids.length > 0 && (
                      <div className="mr-[22px] mb-4 ml-20 flex flex-col overflow-hidden rounded-[18px] bg-app">
                        {kids.map((c) => (
                          <div key={c.id} className="flex items-center gap-3 border-b border-line py-2.5 pr-2.5 pl-4 last:border-b-0">
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="text-sm font-medium">{tweakName(c.tweakId)}</span>
                              {c.diffs.map((d) => (
                                <span key={d} className="truncate font-mono text-xs text-muted" title={d}>{d}</span>
                              ))}
                            </div>
                            {c.state === "reverted" ? (
                              <Badge tone="info">{tr(l("ย้อนกลับแล้ว", "Undone"))}</Badge>
                            ) : (
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() => void run(`c${c.id}`, async () => explainRevert(await boost.revertChange(c.id)))}
                                className="min-h-10 rounded-full px-3.5 text-sm font-semibold text-link transition-colors hover:bg-hover disabled:opacity-60"
                              >
                                {tr(l("ย้อนกลับ", "Undo"))}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {data && (
          <section aria-labelledby="q-title" className="flex flex-col gap-2.5">
            <h2 id="q-title" className="mt-1 mb-0 font-display text-base font-medium text-ink-soft">
              {tr(l("ที่กักกัน", "Quarantine"))}
            </h2>
            <div className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card">
              <Row
                title={tr(l("เก็บไฟล์ที่ล้างไว้กี่วัน", "How long to keep cleaned files"))}
                text={tr(l("ไฟล์ที่ล้างหรือย้ายจะถูกเก็บไว้ก่อน กู้คืนได้ที่นี่ — พ้นกำหนดแล้วจึงลบถาวร", "Cleaned or moved files are kept first and can be restored here — they are permanently deleted after this time"))}
              >
                <Segmented value={q?.retentionDays ?? 7} options={RETENTION_CHOICES.map((d) => ({ id: d, label: tr(l(`${d} วัน`, `${d} d`)) }))} onPick={pickRetention} label={tr(l("จำนวนวันที่กักกัน", "Quarantine days"))} />
              </Row>
              <Row
                title={tr(l("ตอนนี้ในที่กักกัน", "Currently in quarantine"))}
                text={q ? tr(l(`${num(q.files)} ไฟล์ · ${formatBytes(q.bytes)}`, `${num(q.files)} files · ${formatBytes(q.bytes)}`)) : "…"}
              >
                <button
                  type="button"
                  disabled={!q || q.files === 0 || busy !== null}
                  onClick={() => setPurgeOpen(true)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-danger-btn bg-surface px-[18px] text-sm font-semibold text-danger-fg transition-colors hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface"
                >
                  <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                  {tr(l("ล้างที่กักกันตอนนี้", "Empty quarantine now"))}
                </button>
              </Row>
            </div>
          </section>
        )}
      </div>

      <Dialog open={confirmAll} onClose={() => setConfirmAll(false)} labelledBy="undo-all-title">
        <h2 id="undo-all-title" className="m-0 font-display text-2xl font-medium">
          {tr(l("คืนค่าทุกอย่างที่ WeakClean เคยทำ?", "Undo everything WeakClean has done?"))}
        </h2>
        <p className="m-0 text-sm leading-relaxed text-info-fg">
          {tr(l(`ไฟล์ในที่กักกัน (${formatBytes(q?.bytes ?? 0)}) จะถูกกู้คืนกลับที่เดิม โดยไม่เขียนทับไฟล์ที่มีอยู่ และการปรับแต่งที่ยังใช้อยู่ ${activeTweaks} อย่างจะกลับเป็นค่าเดิมทั้งหมด`, `Quarantined files (${formatBytes(q?.bytes ?? 0)}) are restored to where they were without overwriting existing files, and the ${activeTweaks} active tweaks go back to their original values`))}
        </p>
        <div className="mt-1 flex justify-end gap-2.5">
          <button type="button" onClick={() => setConfirmAll(false)} className="min-h-[50px] rounded-full border border-edge bg-surface px-6 text-[15px] transition-colors hover:bg-hover">
            {t.cancel}
          </button>
          <button type="button" onClick={() => void undoAll()} className="min-h-[50px] rounded-full bg-danger-solid px-[26px] text-[15px] font-semibold text-white transition hover:brightness-110">
            {tr(l("คืนค่าทั้งหมด", "Undo everything"))}
          </button>
        </div>
      </Dialog>

      <Dialog open={pendingDays !== null} onClose={() => setPendingDays(null)} labelledBy="ret-title">
        <h2 id="ret-title" className="m-0 font-display text-2xl font-medium">
          {tr(l(`ลดเหลือ ${pendingDays} วัน?`, `Reduce to ${pendingDays} days?`))}
        </h2>
        <p className="m-0 text-sm leading-relaxed text-info-fg">
          {tr(l("ไฟล์ในที่กักกันที่เก่ากว่านี้จะถูก ลบถาวรทันที และกู้คืนไม่ได้อีก", "Quarantined files older than this will be permanently deleted right away and can no longer be restored")).replace(/\*\*/g, "")}
        </p>
        <div className="mt-1 flex justify-end gap-2.5">
          <button type="button" onClick={() => setPendingDays(null)} className="min-h-[50px] rounded-full border border-edge bg-surface px-6 text-[15px] transition-colors hover:bg-hover">
            {t.cancel}
          </button>
          <button type="button" onClick={() => pendingDays && void changeRetention(pendingDays)} className="min-h-[50px] rounded-full bg-danger-solid px-[26px] text-[15px] font-semibold text-white transition hover:brightness-110">
            {tr(l("ลดและลบส่วนที่เก่ากว่า", "Reduce and delete older files"))}
          </button>
        </div>
      </Dialog>

      <Dialog open={purgeOpen} onClose={() => setPurgeOpen(false)} labelledBy="purge-title">
        <h2 id="purge-title" className="m-0 font-display text-2xl font-medium">
          {tr(l("ล้างที่กักกันถาวร?", "Empty the quarantine permanently?"))}
        </h2>
        <p className="m-0 text-sm leading-relaxed text-info-fg">
          {tr(l(`ไฟล์ทั้งหมด ${num(q?.files ?? 0)} ไฟล์ (${formatBytes(q?.bytes ?? 0)}) จะถูกลบถาวรและกู้คืนไม่ได้อีก — นี่เป็นการลบจริงเพียงอย่างเดียวของ WeakClean`, `All ${num(q?.files ?? 0)} files (${formatBytes(q?.bytes ?? 0)}) will be permanently deleted and can no longer be restored — this is the only real deletion WeakClean does`))}
        </p>
        <div className="mt-1 flex justify-end gap-2.5">
          <button type="button" onClick={() => setPurgeOpen(false)} className="min-h-[50px] rounded-full border border-edge bg-surface px-6 text-[15px] transition-colors hover:bg-hover">
            {t.cancel}
          </button>
          <button type="button" onClick={() => void emptyQuarantine()} className="min-h-[50px] rounded-full bg-danger-solid px-[26px] text-[15px] font-semibold text-white transition hover:brightness-110">
            {tr(l("ลบถาวร", "Delete permanently"))}
          </button>
        </div>
      </Dialog>
    </>
  );
}

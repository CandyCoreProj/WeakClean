import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Download, FolderOpen, Info, LoaderCircle, Monitor, Moon, RefreshCw, ShieldCheck, Sun, Trash2 } from "lucide-react";
import { Badge } from "../components/Badge";
import { Dialog } from "../components/Dialog";
import { Hero } from "../components/Hero";
import { useToast } from "../components/Toast";
import { getAppInfo, formatBytes, scanner, settings, updater, type AppInfo, type Settings, type UpdateInfo } from "../lib/tauri";
import { l, useI18n, type L, type Lang } from "../i18n";
import { useTheme, type ThemePref } from "../theme";

const RETENTION_CHOICES = [3, 7, 14, 30, 90];

function Segmented<T extends string | number>({ value, options, onPick, label }: { value: T; options: { id: T; label: string; icon?: ReactNode }[]; onPick: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full bg-field p-[3px]">
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onPick(o.id)}
          className={`inline-flex min-h-10 min-w-16 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors ${value === o.id ? "bg-primary text-white shadow-primary" : "text-ink-soft hover:bg-surface"}`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-t border-rowline px-[22px] py-4 first:border-t-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-medium">{title}</span>
        {text && <span className="text-[13px] leading-relaxed text-muted">{text}</span>}
      </div>
      {children}
    </div>
  );
}

export function SettingsPage() {
  const { t, tr, lang, setLang } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [pendingDays, setPendingDays] = useState<number | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [upd, setUpd] = useState<
    | { s: "idle" }
    | { s: "checking" }
    | { s: "latest" }
    | { s: "available"; info: UpdateInfo }
    | { s: "downloading"; info: UpdateInfo; done: number; total: number | null }
    | { s: "error"; message: string }
  >({ s: "idle" });

  const checkForUpdate = async () => {
    setUpd({ s: "checking" });
    try {
      const info = await updater.check();
      setUpd(info ? { s: "available", info } : { s: "latest" });
    } catch (e) {
      setUpd({ s: "error", message: String(e) });
    }
  };
  const installUpdate = async (info: UpdateInfo) => {
    setUpd({ s: "downloading", info, done: 0, total: null });
    try {
      await updater.install((done, total) => setUpd({ s: "downloading", info, done, total }));
    } catch (e) {
      setUpd({ s: "error", message: String(e) });
    }
  };

  const load = useCallback(() => {
    void settings.get().then(setCfg).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    void getAppInfo().then(setInfo);
  }, [load]);

  const num = (n: number) => n.toLocaleString(lang === "th" ? "th-TH" : "en-US");
  const purgedText = (files: number, bytes: number): string => tr(l(`ลบถาวรแล้ว ${num(files)} ไฟล์ (${formatBytes(bytes)})`, `Permanently deleted ${num(files)} files (${formatBytes(bytes)})`));

  const changeRetention = async (days: number) => {
    setPendingDays(null);
    try {
      const r = await settings.setRetention(days);
      toast(r.files > 0 ? `${tr(l(`ตั้งเป็น ${days} วันแล้ว`, `Set to ${days} days`))} · ${purgedText(r.files, r.bytes)}` : tr(l(`ตั้งเป็น ${days} วันแล้ว`, `Set to ${days} days`)));
    } catch (e) {
      toast(String(e));
    }
    load();
  };
  const purge = async () => {
    setPurgeOpen(false);
    try {
      const r = await settings.purgeQuarantine();
      toast(purgedText(r.files, r.bytes));
    } catch (e) {
      toast(String(e));
    }
    load();
  };

  // ลดจำนวนวัน = ของที่เก่ากว่าจะถูกลบถาวรทันที จึงถามก่อนถ้ามีอะไรอยู่ในที่กักกัน
  const pickRetention = (days: number) => {
    if (!cfg || days === cfg.retentionDays) return;
    if (days < cfg.retentionDays && cfg.quarantineFiles > 0) setPendingDays(days);
    else void changeRetention(days);
  };

  const themeOpts: { id: ThemePref; label: string; icon: ReactNode }[] = [
    { id: "auto", label: tr(l("ตามระบบ", "System")), icon: <Monitor size={15} strokeWidth={2} aria-hidden="true" /> },
    { id: "light", label: tr(l("สว่าง", "Light")), icon: <Sun size={15} strokeWidth={2} aria-hidden="true" /> },
    { id: "dark", label: tr(l("มืด", "Dark")), icon: <Moon size={15} strokeWidth={2} aria-hidden="true" /> },
  ];
  const langOpts: { id: Lang; label: string }[] = [
    { id: "th", label: "ไทย" },
    { id: "en", label: "English" },
  ];

  const facts: { label: L; value: string }[] = [
    { label: l("เวอร์ชัน", "Version"), value: info ? `${info.version} (${info.arch})` : "…" },
    { label: l("ผู้พัฒนา", "Publisher"), value: "CandyCore" },
    { label: l("สร้างด้วย", "Built with"), value: "Tauri 2 · Rust · React" },
  ];

  return (
    <>
      <Hero title={t.pages.settings.title} subtitle={t.pages.settings.subtitle} />

      <div className="relative -mt-16 flex flex-col gap-[18px] px-10 pb-10">
        <section aria-labelledby="look-title" className="glass flex flex-col overflow-hidden rounded-card">
          <h2 id="look-title" className="m-0 px-[22px] pt-[18px] pb-1 font-display text-lg font-medium">
            {tr(l("หน้าตา", "Appearance"))}
          </h2>
          <Row title={tr(l("ภาษา", "Language"))}>
            <Segmented value={lang} options={langOpts} onPick={setLang} label={t.language} />
          </Row>
          <Row title={tr(l("ธีม", "Theme"))} text={tr(l("\"ตามระบบ\" จะเปลี่ยนตามธีมของ Windows อัตโนมัติ", "\"System\" follows the Windows theme automatically"))}>
            <Segmented value={theme.pref} options={themeOpts} onPick={theme.setPref} label={tr(l("ธีม", "Theme"))} />
          </Row>
        </section>

        <section aria-labelledby="q-title" className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card">
          <h2 id="q-title" className="m-0 px-[22px] pt-[18px] pb-1 font-display text-lg font-medium">
            {tr(l("ที่กักกัน", "Quarantine"))}
          </h2>
          <Row
            title={tr(l("เก็บไฟล์ที่ล้างไว้กี่วัน", "How long to keep cleaned files"))}
            text={tr(l("ไฟล์ที่ล้างหรือย้ายจะถูกเก็บไว้ก่อน กู้คืนได้ที่หน้า ประวัติ & กู้คืน — พ้นกำหนดแล้วจึงลบถาวร", "Cleaned or moved files are kept first and can be restored from History & Restore — they are permanently deleted after this time"))}
          >
            <Segmented value={cfg?.retentionDays ?? 7} options={RETENTION_CHOICES.map((d) => ({ id: d, label: tr(l(`${d} วัน`, `${d} d`)) }))} onPick={pickRetention} label={tr(l("จำนวนวันที่กักกัน", "Quarantine days"))} />
          </Row>
          <Row
            title={tr(l("ตอนนี้ในที่กักกัน", "Currently in quarantine"))}
            text={cfg ? tr(l(`${num(cfg.quarantineFiles)} ไฟล์ · ${formatBytes(cfg.quarantineBytes)}`, `${num(cfg.quarantineFiles)} files · ${formatBytes(cfg.quarantineBytes)}`)) : "…"}
          >
            <button
              type="button"
              disabled={!cfg || cfg.quarantineFiles === 0}
              onClick={() => setPurgeOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-danger-btn bg-surface px-[18px] text-sm font-semibold text-danger-fg transition-colors hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface"
            >
              <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
              {tr(l("ล้างที่กักกันตอนนี้", "Empty quarantine now"))}
            </button>
          </Row>
        </section>

        <section aria-labelledby="data-title" className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card">
          <h2 id="data-title" className="m-0 px-[22px] pt-[18px] pb-1 font-display text-lg font-medium">
            {tr(l("ข้อมูลและความเป็นส่วนตัว", "Data and privacy"))}
          </h2>
          <Row title={tr(l("ตำแหน่งข้อมูลของโปรแกรม", "App data location"))} text={cfg?.dataDir ?? "…"}>
            <button
              type="button"
              disabled={!cfg}
              onClick={() => cfg && void scanner.reveal(cfg.dataDir).catch(() => toast(t.soon))}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-edge bg-surface px-[18px] text-sm transition-colors hover:bg-hover disabled:opacity-50"
            >
              <FolderOpen size={16} strokeWidth={2} aria-hidden="true" />
              {tr(l("เปิดโฟลเดอร์", "Open folder"))}
            </button>
          </Row>
          <Row title={tr(l("ไม่มีการส่งข้อมูลของคุณออกจากเครื่อง", "Your data never leaves your PC"))} text={tr(l("WeakClean ไม่เก็บสถิติการใช้งานและไม่ส่งข้อมูลใดๆ — เชื่อมต่ออินเทอร์เน็ตเฉพาะตอนคุณกด \"ตรวจหาอัปเดต\" (เพื่อดาวน์โหลดไฟล์รายการอัปเดตจาก GitHub) ประวัติและที่กักกันอยู่ในโฟลเดอร์ข้างบนเท่านั้น", "WeakClean collects no usage data and sends nothing — it connects to the internet only when you press \"Check for updates\" (to download the update list from GitHub). History and quarantine live only in the folder above"))}>
            <Badge tone="safe">
              <ShieldCheck size={12} strokeWidth={2.4} aria-hidden="true" />
              {tr(l("ไม่ส่งข้อมูล", "No tracking"))}
            </Badge>
          </Row>
        </section>

        <section aria-labelledby="about-title" className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card">
          <h2 id="about-title" className="m-0 flex items-center gap-2 px-[22px] pt-[18px] pb-1 font-display text-lg font-medium">
            <Info size={18} strokeWidth={2} aria-hidden="true" />
            {tr(l("เกี่ยวกับ WeakClean", "About WeakClean"))}
          </h2>
          {facts.map((f) => (
            <Row key={f.label.en} title={tr(f.label)}>
              <span className="text-sm text-muted">{f.value}</span>
            </Row>
          ))}
          <Row
            title={tr(l("การอัปเดต", "Updates"))}
            text={
              upd.s === "latest"
                ? tr(l("คุณใช้เวอร์ชันล่าสุดแล้ว", "You're on the latest version"))
                : upd.s === "available" || upd.s === "downloading"
                  ? tr(l(`มีเวอร์ชันใหม่ ${upd.info.version}${upd.info.notes ? ` — ${upd.info.notes.slice(0, 200)}` : ""}`, `Version ${upd.info.version} is available${upd.info.notes ? ` — ${upd.info.notes.slice(0, 200)}` : ""}`))
                  : upd.s === "error"
                    ? tr(l(`ตรวจอัปเดตไม่สำเร็จ: ${upd.message}`, `Couldn't check for updates: ${upd.message}`))
                    : tr(l("ตรวจเมื่อคุณกดเท่านั้น — แอปไม่ตรวจเองและไม่ติดตั้งอะไรโดยไม่ถามก่อน อัปเดตทุกชุดตรวจลายเซ็นก่อนติดตั้ง", "Checks only when you press the button — the app never checks by itself or installs anything without asking, and every update's signature is verified first"))
            }
          >
            {upd.s === "available" ? (
              <button type="button" onClick={() => void installUpdate(upd.info)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-[18px] text-sm font-semibold text-white shadow-primary transition hover:brightness-105">
                <Download size={16} strokeWidth={2.2} aria-hidden="true" />
                {tr(l("ดาวน์โหลดและติดตั้ง", "Download and install"))}
              </button>
            ) : upd.s === "downloading" ? (
              <span role="status" className="inline-flex min-h-11 items-center gap-2 text-sm text-brand">
                <LoaderCircle size={18} strokeWidth={2.2} className="animate-spin" aria-hidden="true" />
                {upd.total ? `${Math.min(100, Math.round((upd.done / upd.total) * 100))}%` : formatBytes(upd.done)}
              </span>
            ) : (
              <button
                type="button"
                disabled={upd.s === "checking"}
                onClick={() => void checkForUpdate()}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-edge bg-surface px-[18px] text-sm transition-colors hover:bg-hover disabled:opacity-60"
              >
                <RefreshCw size={16} strokeWidth={2} className={upd.s === "checking" ? "animate-spin" : ""} aria-hidden="true" />
                {tr(l("ตรวจหาอัปเดต", "Check for updates"))}
              </button>
            )}
          </Row>
        </section>
      </div>

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
          <button type="button" onClick={() => pendingDays && void changeRetention(pendingDays)} className="min-h-[50px] rounded-full bg-danger-fg px-[26px] text-[15px] font-semibold text-white transition hover:brightness-110">
            {tr(l("ลดและลบส่วนที่เก่ากว่า", "Reduce and delete older files"))}
          </button>
        </div>
      </Dialog>

      <Dialog open={purgeOpen} onClose={() => setPurgeOpen(false)} labelledBy="purge-title">
        <h2 id="purge-title" className="m-0 font-display text-2xl font-medium">
          {tr(l("ล้างที่กักกันถาวร?", "Empty the quarantine permanently?"))}
        </h2>
        <p className="m-0 text-sm leading-relaxed text-info-fg">
          {tr(l(`ไฟล์ทั้งหมด ${cfg ? num(cfg.quarantineFiles) : 0} ไฟล์ (${formatBytes(cfg?.quarantineBytes ?? 0)}) จะถูกลบถาวรและกู้คืนไม่ได้อีก — นี่เป็นการลบจริงเพียงอย่างเดียวของ WeakClean`, `All ${cfg ? num(cfg.quarantineFiles) : 0} files (${formatBytes(cfg?.quarantineBytes ?? 0)}) will be permanently deleted and can no longer be restored — this is the only real deletion WeakClean does`))}
        </p>
        <div className="mt-1 flex justify-end gap-2.5">
          <button type="button" onClick={() => setPurgeOpen(false)} className="min-h-[50px] rounded-full border border-edge bg-surface px-6 text-[15px] transition-colors hover:bg-hover">
            {t.cancel}
          </button>
          <button type="button" onClick={() => void purge()} className="min-h-[50px] rounded-full bg-danger-fg px-[26px] text-[15px] font-semibold text-white transition hover:brightness-110">
            {tr(l("ลบถาวร", "Delete permanently"))}
          </button>
        </div>
      </Dialog>
    </>
  );
}

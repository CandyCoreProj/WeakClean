import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BellRing, Download, FolderOpen, Info, LoaderCircle, Monitor, Moon, RefreshCw, ShieldCheck, Sun } from "lucide-react";
import { Badge } from "../components/Badge";
import { Hero } from "../components/Hero";
import { Row } from "../components/Row";
import { Segmented } from "../components/Segmented";
import { Switch } from "../components/Switch";
import { useToast } from "../components/Toast";
import { background, getAppInfo, formatBytes, scanner, settings, updater, type AppInfo, type BackgroundStatus, type Settings, type UpdateInfo } from "../lib/tauri";
import { l, useI18n, type L, type Lang } from "../i18n";
import { useTheme, type ThemePref } from "../theme";

export function SettingsPage() {
  const { t, tr, lang, setLang } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [bg, setBg] = useState<BackgroundStatus | null>(null);
  const [upd, setUpd] = useState<
    | { s: "idle" }
    | { s: "checking" }
    | { s: "latest" }
    | { s: "available"; info: UpdateInfo }
    | { s: "downloading"; info: UpdateInfo; done: number; total: number | null }
    | { s: "error"; message: string; during: "check" | "install" }
  >({ s: "idle" });

  const checkForUpdate = async () => {
    setUpd({ s: "checking" });
    try {
      const info = await updater.check();
      setUpd(info ? { s: "available", info } : { s: "latest" });
    } catch (e) {
      setUpd({ s: "error", message: String(e), during: "check" });
    }
  };
  const installUpdate = async (info: UpdateInfo) => {
    setUpd({ s: "downloading", info, done: 0, total: null });
    try {
      await updater.install((done, total) => setUpd({ s: "downloading", info, done, total }));
    } catch (e) {
      setUpd({ s: "error", message: String(e), during: "install" });
    }
  };

  const load = useCallback(() => {
    void settings.get().then(setCfg).catch(() => {});
  }, []);
  const loadBackground = useCallback(() => {
    void background.status().then(setBg).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    loadBackground();
    void getAppInfo().then(setInfo);
  }, [load, loadBackground]);

  const toggleAutostart = async () => {
    if (!bg) return;
    await background.setAutostart(!bg.autostart).catch((e) => toast(String(e)));
    loadBackground();
  };
  const toggleRemind = async () => {
    if (!bg) return;
    await background.setRemind(!bg.remind).catch((e) => toast(String(e)));
    loadBackground();
  };
  const nextReminder = bg ? new Date(bg.nextReminderTs * 1000).toLocaleDateString(lang === "th" ? "th-TH" : "en-US", { dateStyle: "medium" }) : "…";

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

        <section aria-labelledby="bg-title" className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card">
          <h2 id="bg-title" className="m-0 px-[22px] pt-[18px] pb-1 font-display text-lg font-medium">
            {tr(l("ตัวช่วยเบื้องหลัง", "Background helper"))}
          </h2>
          <Row
            title={tr(l("เปิดพร้อม Windows", "Start with Windows"))}
            text={tr(l(
              "เปิดไว้ในถาดระบบตั้งแต่ล็อกอิน คอยเตือนโดยไม่ต้องเปิดหน้าต่างขึ้นมา และกดปิดหน้าต่างได้ตลอดโดยตัวช่วยยังอยู่",
              "Runs in the system tray from logon so it can remind you without opening a window; closing the window keeps the helper running",
            ))}
          >
            <Switch checked={bg?.autostart ?? false} onChange={() => void toggleAutostart()} label={tr(l("เปิดพร้อม Windows", "Start with Windows"))} />
          </Row>
          <Row
            title={tr(l("เตือนล้างขยะทุก 7 วัน", "Remind me every 7 days"))}
            text={tr(l(`นับจากครั้งล่าสุดที่ล้างสำเร็จ · ครั้งถัดไป ${nextReminder}`, `Counted from your last clean · next on ${nextReminder}`))}
          >
            <Switch checked={bg?.remind ?? true} onChange={() => void toggleRemind()} label={tr(l("เตือนล้างขยะทุก 7 วัน", "Remind me every 7 days"))} />
          </Row>
          <Row
            title={tr(l("ดูการ์ดเตือน", "Preview the reminder"))}
            text={tr(l(
              "ขึ้นการ์ดเตือนมุมขวาล่างเดี๋ยวนี้ เหมือนถึงกำหนดจริง (แล้วเริ่มนับรอบใหม่)",
              "Shows the reminder card in the bottom right corner as if the cycle was up (then restarts the cycle)",
            ))}
          >
            <button
              type="button"
              onClick={() => void background.remindNow().then(loadBackground).catch((e) => toast(String(e)))}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-edge bg-surface px-[18px] text-sm transition-colors hover:bg-hover"
            >
              <BellRing size={16} strokeWidth={2} aria-hidden="true" />
              {tr(l("แสดงการ์ดเตือน", "Show the card"))}
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
                    ? upd.during === "install"
                      ? tr(l(`ติดตั้งอัปเดตไม่สำเร็จ: ${upd.message}`, `Couldn't install the update: ${upd.message}`))
                      : tr(l(`ตรวจอัปเดตไม่สำเร็จ: ${upd.message}`, `Couldn't check for updates: ${upd.message}`))
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
    </>
  );
}

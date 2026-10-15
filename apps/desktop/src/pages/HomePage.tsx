import { useEffect, useState } from "react";
import { Check, ChevronRight, Folder, HardDrive, Sparkles, Zap, type LucideIcon } from "lucide-react";
import { Badge, type Tone } from "../components/Badge";
import { Dialog } from "../components/Dialog";
import { Hero } from "../components/Hero";
import { defaultCleanableBytes, useCleaner } from "../lib/cleanerStore";
import { useBoost } from "../lib/boostStore";
import { systemDrive, useDrives } from "../lib/drives";
import { computeHealth, healthTone } from "../lib/health";
import { useScan } from "../lib/scanStore";
import { formatBytes, scanner, systemInfo, type SystemInfo } from "../lib/tauri";
import { l, useI18n, type L, type PageId } from "../i18n";

function greeting(tr: (x: L) => string): string {
  const h = new Date().getHours();
  if (h < 12) return tr(l("สวัสดีตอนเช้า", "Good morning"));
  if (h < 17) return tr(l("สวัสดีตอนบ่าย", "Good afternoon"));
  return tr(l("สวัสดีตอนเย็น", "Good evening"));
}

function ScoreRing({ score, label }: { score: number | null; label: string }) {
  const r = 60;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-[150px] w-[150px]">
      <svg role="img" aria-label={label} width="150" height="150" viewBox="0 0 150 150">
        <defs>
          <linearGradient id="health-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1A5CE0" />
            <stop offset="1" stopColor="#3DD6A3" />
          </linearGradient>
        </defs>
        <circle cx="75" cy="75" r={r} fill="none" stroke="var(--color-ring-track)" strokeWidth="14" />
        {score !== null && (
          <circle cx="75" cy="75" r={r} fill="none" stroke="url(#health-grad)" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${(c * score) / 100} ${c}`} transform="rotate(-90 75 75)" />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-display text-[44px] font-medium">{score ?? "…"}</span>
      </div>
    </div>
  );
}

type Action = { id: PageId; icon: LucideIcon; tile: string; tone: Tone; badge: L; title: L; text: L; cta: L };

export function HomePage({ onNavigate }: { onNavigate: (id: PageId) => void }) {
  const { tr, lang } = useI18n();
  const [scoreOpen, setScoreOpen] = useState(false);
  const drives = useDrives();
  const sys = systemDrive(drives);
  const cleaner = useCleaner();
  const boost = useBoost();
  const scan = useScan();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [biggest, setBiggest] = useState<{ name: string; size: number } | null>(null);

  useEffect(() => {
    void systemInfo().then(setInfo).catch(() => {});
  }, []);

  // โฟลเดอร์ใหญ่สุดของไดรฟ์ระบบ (ถ้าเคยสแกนแล้ว)
  const scanRoot = scan.summary?.rootPath.toLowerCase().replace(/\\+$/, "");
  const scannedSystem = !!sys && scanRoot === `${sys.letter.toLowerCase()}:`;
  const scanKey = scan.summary ? `${scan.summary.rootPath}|${scan.summary.elapsedMs}` : "";
  useEffect(() => {
    if (!scannedSystem) return setBiggest(null);
    let alive = true;
    scanner.children([]).then((c) => alive && c.children[0] && setBiggest({ name: c.children[0].name, size: c.children[0].size })).catch(() => {});
    return () => {
      alive = false;
    };
  }, [scannedSystem, scanKey]);

  const cleanReady = cleaner.status === "ready";
  const cleanBytes = defaultCleanableBytes(cleaner);
  const boostReady = boost.status === "ready";
  const balanced = boost.catalog.filter((c) => c.profiles.includes("balanced") && boost.states[c.id] !== "unavailable");
  const unapplied = balanced.filter((c) => boost.states[c.id] === "off" || boost.states[c.id] === "drifted").length;
  const gamingCount = boost.catalog.filter((c) => c.profiles.includes("gaming") && boost.states[c.id] !== "unavailable").length;
  const drifted = Object.values(boost.states).filter((s) => s === "drifted").length;

  const health = computeHealth({
    drive: sys,
    cleanableBytes: cleanReady ? cleanBytes : undefined,
    unappliedBalanced: boostReady ? unapplied : undefined,
    drifted: boostReady ? drifted : undefined,
  });
  const score = health.ready ? health.score : null;
  const tone = healthTone(health.score);
  const todo = health.factors.filter((f) => f.lost > 0).length;

  const actions: Action[] = [
    {
      id: "cleaner",
      icon: Sparkles,
      tile: "tile-blue",
      tone: cleanReady && cleanBytes >= 512 * 1024 * 1024 ? "safe" : "info",
      badge: l("ปลอดภัย", "Safe"),
      title: cleanReady ? l(`ล้างขยะได้ ${formatBytes(cleanBytes)}`, `Clean up ${formatBytes(cleanBytes)}`) : l("กำลังตรวจหาขยะ…", "Looking for junk…"),
      text: l("ไฟล์ชั่วคราว แคชเบราว์เซอร์ และแคชอื่นๆ ที่ลบได้โดยไม่กระทบการใช้งาน", "Temporary files, browser caches and other caches that are safe to remove"),
      cta: l("ล้างเลย", "Clean now"),
    },
    {
      id: "boost",
      icon: Zap,
      tile: "tile-mint",
      tone: unapplied > 0 ? "warn" : "safe",
      badge: unapplied > 0 ? l("แนะนำ", "Suggested") : l("ครบแล้ว", "All set"),
      title: !boostReady ? l("กำลังตรวจเครื่อง…", "Checking your PC…") : unapplied > 0 ? l(`ปรับแต่งได้อีก ${unapplied} รายการ`, `${unapplied} more safe tweaks`) : l("ปรับแต่งปลอดภัยครบแล้ว", "Safe tweaks are all applied"),
      text: gamingCount > 0 ? l(`โปรไฟล์เกมมิ่งมี ${gamingCount} การปรับแต่ง · บันทึกค่าเดิมให้ย้อนกลับได้ทุกอย่าง`, `The Gaming profile has ${gamingCount} tweaks · previous values are saved so everything can be undone`) : l("ย้อนกลับได้ทุกอย่าง", "Everything can be undone"),
      cta: l("ดูรายการ", "See the list"),
    },
    {
      id: "space",
      icon: Folder,
      tile: "tile-violet",
      tone: "info",
      badge: biggest ? l("ตรวจดู", "Take a look") : l("ยังไม่ได้สแกน", "Not scanned"),
      title: biggest ? l(`${biggest.name} ใช้ ${formatBytes(biggest.size)}`, `${biggest.name} uses ${formatBytes(biggest.size)}`) : sys ? l(`สแกนไดรฟ์ ${sys.letter}:`, `Scan drive ${sys.letter}:`) : l("สแกนพื้นที่ดิสก์", "Scan disk space"),
      text: biggest ? l(`ใหญ่ที่สุดใน ${sys?.letter}: — ลองดูว่ามีไฟล์ที่ไม่ใช้แล้วไหม`, `Largest on ${sys?.letter}: — check for files you no longer need`) : l("ดูว่าอะไรกินพื้นที่ พร้อมหาไฟล์ซ้ำและไฟล์เก่า", "See what takes up space, and find duplicates and old files"),
      cta: biggest ? l("เปิดดู", "Open") : l("สแกนเลย", "Scan now"),
    },
  ];

  const num = (n: number) => n.toLocaleString(lang === "th" ? "th-TH" : "en-US");
  const specs: { label: L; value: string }[] = [
    { label: l("ระบบปฏิบัติการ", "Operating system"), value: info?.os ?? "…" },
    { label: l("ซีพียู", "CPU"), value: info ? (info.threads > 0 ? `${info.cpu} · ${info.threads} threads` : info.cpu) : "…" },
    { label: l("การ์ดจอ", "GPU"), value: info ? (info.gpus.length > 0 ? info.gpus.join(", ") : "—") : "…" },
    { label: l("แรม", "RAM"), value: info ? (info.ramBytes > 0 ? formatBytes(info.ramBytes) : "—") : "…" },
    { label: sys ? l(`ไฟล์ใน ${sys.letter}:`, `Files on ${sys.letter}:`) : l("ไฟล์ในไดรฟ์ระบบ", "Files on the system drive"), value: scannedSystem && scan.summary ? tr(l(`${num(scan.summary.files)} ไฟล์`, `${num(scan.summary.files)} files`)) : tr(l("ยังไม่ได้สแกน", "Not scanned yet")) },
  ];

  return (
    <>
      <Hero
        eyebrow={greeting(tr)}
        title={score === null ? tr(l("กำลังตรวจสุขภาพเครื่อง…", "Checking your PC's health…")) : tr(tone.title)}
        subtitle={
          score === null
            ? tr(l("อ่านพื้นที่ดิสก์ ขยะ และการตั้งค่าของเครื่อง — ไม่มีการแก้ไขอะไร", "Reading disk space, junk and settings — nothing is changed"))
            : todo > 0
              ? tr(l(`ทำอีก ${todo} อย่างเพื่อคะแนนเต็ม — ทุกอย่างย้อนกลับได้ ไม่มีอะไรถูกลบถาวรทันที`, `Do ${todo} more thing${todo > 1 ? "s" : ""} for a perfect score — everything is reversible, nothing is permanently deleted right away`))
              : tr(l("ครบทุกข้อแล้ว — เครื่องของคุณได้คะแนนเต็ม", "All done — your PC has a perfect score"))
        }
        aside={
          <div className="glass flex w-[300px] shrink-0 flex-col items-center gap-1.5 rounded-[28px] p-[22px]">
            <ScoreRing score={score} label={score === null ? tr(l("กำลังคำนวณคะแนน", "Calculating the score")) : tr(l(`คะแนนสุขภาพเครื่อง ${score} จาก 100`, `PC health score ${score} out of 100`))} />
            <span className="text-[13px] text-muted">{tr(l("จาก 100", "out of 100"))}</span>
            {score !== null && (
              <Badge tone={tone.tone} className="px-3 py-1 text-[13px]">
                {tr(tone.label)}
              </Badge>
            )}
          </div>
        }
      >
        <div className="mt-2 flex gap-3">
          <button
            type="button"
            onClick={() => onNavigate(cleanReady && cleanBytes >= 512 * 1024 * 1024 ? "cleaner" : unapplied > 0 ? "boost" : "space")}
            className="inline-flex min-h-[52px] items-center gap-2 rounded-full bg-white px-[26px] text-base font-semibold text-brand-deep shadow-float transition hover:brightness-105"
          >
            <Sparkles size={18} strokeWidth={2.2} aria-hidden="true" />
            {tr(l("ดูแลเครื่องตอนนี้", "Take care of my PC"))}
          </button>
          <button
            type="button"
            onClick={() => setScoreOpen(true)}
            className="inline-flex min-h-[52px] items-center rounded-full border border-white/70 px-5 text-[15px] text-white transition hover:bg-white/15"
          >
            {tr(l("คะแนนคิดจากอะไร?", "How is the score calculated?"))}
          </button>
        </div>
      </Hero>

      <div className="relative -mt-16 flex flex-col gap-[22px] px-10 pb-10">
        <section className="grid grid-cols-3 gap-[18px]">
          {actions.map(({ id, icon: Icon, tile, tone: t, badge, title, text, cta }) => (
            <button
              key={id}
              type="button"
              onClick={() => onNavigate(id)}
              className="glass flex flex-col items-start gap-2.5 rounded-card p-[22px] text-left transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(30,100,200,0.18)]"
            >
              <span className="flex w-full items-center justify-between">
                <span className={`${tile} flex h-[52px] w-[52px] items-center justify-center rounded-tile text-white`}>
                  <Icon size={24} strokeWidth={1.9} aria-hidden="true" />
                </span>
                <Badge tone={t}>{tr(badge)}</Badge>
              </span>
              <span className="font-display text-xl font-medium">{tr(title)}</span>
              <span className="text-sm leading-relaxed text-muted">{tr(text)}</span>
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-link">
                {tr(cta)}
                <ChevronRight size={16} strokeWidth={2.2} aria-hidden="true" />
              </span>
            </button>
          ))}
        </section>

        <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-[18px]">
          <section aria-labelledby="drives-title" className="flex flex-col gap-4 rounded-card bg-surface p-6 shadow-card">
            <div className="flex items-center justify-between">
              <h2 id="drives-title" className="m-0 font-display text-xl font-medium">
                {tr(l("ไดรฟ์", "Drives"))}
              </h2>
              <button type="button" onClick={() => onNavigate("space")} className="text-sm font-medium text-link hover:underline">
                {tr(l("วิเคราะห์พื้นที่", "Analyze space"))}
              </button>
            </div>
            {drives.map((d) => {
              const usedPct = Math.round(((d.total - d.free) / d.total) * 100);
              return (
                <div key={d.root} className="flex items-center gap-3.5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-soft text-brand">
                    <HardDrive size={20} strokeWidth={1.9} aria-hidden="true" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="font-semibold">{tr(l(`ไดรฟ์ ${d.letter}:`, `Drive ${d.letter}:`))}</span>
                      <span className="text-muted">{tr(l(`ว่าง ${formatBytes(d.free)} จาก ${formatBytes(d.total)}`, `${formatBytes(d.free)} free of ${formatBytes(d.total)}`))}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-[5px] bg-track">
                      <div className="h-full rounded-[5px] bg-meter" style={{ width: `${usedPct}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </section>

          <section aria-labelledby="spec-title" className="flex flex-col gap-3 rounded-card bg-surface p-6 shadow-card">
            <h2 id="spec-title" className="m-0 font-display text-xl font-medium">
              {tr(l("สเปกเครื่อง", "System specs"))}
            </h2>
            {specs.map((s) => (
              <div key={s.label.en} className="flex justify-between gap-3 rounded-[14px] bg-app px-3.5 py-2.5">
                <span className="shrink-0 text-sm text-muted">{tr(s.label)}</span>
                <span className="min-w-0 text-right text-sm font-medium break-words">{s.value}</span>
              </div>
            ))}
          </section>
        </div>
      </div>

      <Dialog open={scoreOpen} onClose={() => setScoreOpen(false)} labelledBy="score-title">
        <h2 id="score-title" className="m-0 font-display text-2xl font-medium">
          {tr(l("คะแนนสุขภาพคิดจากอะไร?", "How is the health score calculated?"))}
        </h2>
        <p className="m-0 text-sm text-info-fg">{tr(l("เริ่มที่ 100 แล้วหักตามสภาพจริงของเครื่องคุณ:", "Starts at 100 and loses points based on your PC's actual state:"))}</p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {health.factors.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-2xl bg-app px-4 py-2.5 text-sm">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{tr(f.label)}</span>
                <span className="text-xs text-muted">{tr(f.detail)}</span>
              </span>
              {f.lost === 0 ? (
                <span className="inline-flex items-center gap-1 font-semibold text-safe-fg">
                  <Check size={16} strokeWidth={2.6} aria-hidden="true" />
                  {tr(l("ผ่าน", "OK"))}
                </span>
              ) : (
                <span className="font-semibold text-warn-fg">−{f.lost}</span>
              )}
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <button type="button" onClick={() => setScoreOpen(false)} className="min-h-[50px] rounded-full bg-primary px-[26px] text-[15px] font-semibold text-white shadow-primary transition hover:brightness-105">
            {tr(l("เข้าใจแล้ว", "Got it"))}
          </button>
        </div>
      </Dialog>
    </>
  );
}

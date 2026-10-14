import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, LoaderCircle, RotateCw, ShieldCheck, TriangleAlert, Undo2, UserCog, Zap } from "lucide-react";
import { Badge } from "../components/Badge";
import { Dialog } from "../components/Dialog";
import { Hero } from "../components/Hero";
import { ResultBanner } from "../components/ResultBanner";
import { Switch } from "../components/Switch";
import { useToast } from "../components/Toast";
import { failureText, refreshBoost, useBoost } from "../lib/boostStore";
import { boost, type ApplyResult, type TweakFailure, type TweakMeta } from "../lib/tauri";
import { l, useI18n, type L, type PageId } from "../i18n";

type Profile = "balanced" | "gaming" | "custom";

const RISK_LABEL: Record<TweakMeta["risk"], L> = {
  safe: l("ปลอดภัย", "Safe"),
  recommended: l("แนะนำสำหรับเกม", "Recommended for gaming"),
  expert: l("ผู้เชี่ยวชาญ", "Expert"),
};

const CATS: { id: string; title: L }[] = [
  { id: "sys", title: l("ระบบ & หน้าตา", "System & looks") },
  { id: "game", title: l("เกม & Latency", "Gaming & latency") },
  { id: "net", title: l("เครือข่าย & ความเป็นส่วนตัว", "Network & privacy") },
  { id: "svc", title: l("บริการเบื้องหลัง (Services)", "Background services") },
];

type Outcome = { applied: string[]; reverted: string[]; failed: TweakFailure[]; reboots: number; restorePoint: ApplyResult["restorePoint"] };

export function BoostPage({ onNavigate }: { onNavigate: (id: PageId) => void }) {
  const { t, tr, lang } = useI18n();
  const toast = useToast();
  const { status, catalog, elevated, states, activeChange } = useBoost();
  const [profile, setProfile] = useState<Profile>("custom");
  const [want, setWant] = useState<Record<string, boolean>>({});
  const seeded = useRef(false);
  const [expertOpen, setExpertOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const stateOf = (id: string) => states[id] ?? "off";
  /** ตั้งค่า (ปิด/เปิด) ได้จากหน้านี้ไหม — ไม่ได้ถ้าไม่รองรับ, ตั้งไว้แล้วโดยโปรแกรมอื่น, หรือต้องสิทธิ์ผู้ดูแล */
  const locked = (c: TweakMeta) => stateOf(c.id) === "unavailable" || stateOf(c.id) === "external" || (c.requiresAdmin && !elevated);
  const isOn = (id: string) => stateOf(id) === "on" || stateOf(id) === "drifted" || stateOf(id) === "external";

  // เริ่มต้นให้สวิตช์ตรงกับสถานะจริงของเครื่อง (ครั้งแรกหลังโหลด และหลังทุกครั้งที่ใช้เสร็จ)
  const seed = () => setWant(Object.fromEntries(catalog.map((c) => [c.id, isOn(c.id)])));
  useEffect(() => {
    if (status !== "ready" || seeded.current) return;
    seeded.current = true;
    seed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const name = (c: TweakMeta) => (lang === "th" ? c.nameTh : c.nameEn);
  const desc = (c: TweakMeta) => (lang === "th" ? c.descTh : c.descEn);
  const byId = (id: string) => catalog.find((c) => c.id === id)!;

  const toApply = catalog.filter((c) => want[c.id] && (stateOf(c.id) === "off" || stateOf(c.id) === "drifted") && !locked(c));
  const toRevert = catalog.filter((c) => !want[c.id] && stateOf(c.id) === "on" && !locked(c) && activeChange[c.id] !== undefined);
  const count = toApply.length + toRevert.length;
  const reboots = toApply.filter((c) => c.reboot).length;
  const needAdminCount = catalog.filter((c) => c.requiresAdmin && stateOf(c.id) !== "unavailable").length;
  const countProfile = (p: string) => catalog.filter((c) => c.profiles.includes(p) && stateOf(c.id) !== "unavailable").length;

  const pickProfile = (p: Profile) => {
    setOutcome(null);
    setProfile(p);
    if (p === "custom") return;
    // เปิดตามโปรไฟล์ — ที่ล็อกอยู่ (ตั้งไว้แล้ว/ไม่รองรับ/ต้องผู้ดูแล) คงสถานะเดิม
    setWant(Object.fromEntries(catalog.map((c) => [c.id, locked(c) ? isOn(c.id) : c.profiles.includes(p)])));
  };
  const toggle = (id: string) => {
    setOutcome(null);
    setProfile("custom");
    setWant((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const apply = async () => {
    setConfirm(false);
    setOutcome(null);
    setWorking(true);
    try {
      const failed: TweakFailure[] = [];
      const reverted: string[] = [];
      let applied: string[] = [];
      let restorePoint: ApplyResult["restorePoint"] = "skipped";
      if (toApply.length > 0) {
        const r = await boost.apply(toApply.map((c) => c.id), profile);
        applied = r.applied;
        restorePoint = r.restorePoint;
        failed.push(...r.failed);
      }
      for (const c of toRevert) {
        const r = await boost.revertChange(activeChange[c.id]);
        if (r.reverted > 0) reverted.push(c.id);
        failed.push(...r.failed.map((f) => ({ ...f, id: c.id })));
      }
      setOutcome({ applied, reverted, failed, restorePoint, reboots: applied.filter((id) => byId(id).reboot).length });
    } catch (e) {
      toast(String(e));
    } finally {
      setWorking(false);
      seeded.current = false;
      await refreshBoost();
    }
  };

  const relaunch = async () => {
    try {
      await boost.relaunchAdmin();
    } catch {
      toast(tr(l("ยกเลิกการเปิดแบบผู้ดูแล", "Administrator launch cancelled")));
    }
  };

  const profiles: { id: Profile; name: L; desc: L; tag: L; tone: "safe" | "warn" | "info" }[] = [
    { id: "balanced", name: l("สมดุล", "Balanced"), desc: l("เฉพาะรายการที่ปลอดภัย เหมาะกับทุกเครื่อง", "Safe items only — suitable for every PC"), tag: l(`${countProfile("balanced")} รายการ`, `${countProfile("balanced")} items`), tone: "safe" },
    { id: "gaming", name: l("เกมมิ่ง", "Gaming"), desc: l("ลด latency และงานเบื้องหลัง เพื่อ FPS ที่นิ่งขึ้น", "Lower latency and less background work for steadier FPS"), tag: l(`แนะนำ · ${countProfile("gaming")}`, `Suggested · ${countProfile("gaming")}`), tone: "warn" },
    { id: "custom", name: l("กำหนดเอง", "Custom"), desc: l("เลือกเองทีละสวิตช์ด้านล่าง", "Pick each switch below yourself"), tag: l("อิสระ", "Free"), tone: "info" },
  ];

  const rebootBadge = (
    <Badge tone="info">
      <RotateCw size={12} strokeWidth={2.4} aria-hidden="true" />
      {tr(l("ต้องรีบูต", "Restart required"))}
    </Badge>
  );

  const row = (c: TweakMeta, danger = false) => {
    const st = stateOf(c.id);
    const badges: ReactNode[] = [
      <Badge key="risk" tone={c.risk === "safe" ? "safe" : c.risk === "expert" ? "danger" : "warn"}>{tr(RISK_LABEL[c.risk])}</Badge>,
    ];
    if (c.reboot) badges.push(<span key="reboot">{rebootBadge}</span>);
    if (st === "external") badges.push(<Badge key="ext" tone="info">{tr(l("ตั้งไว้อยู่แล้ว (ไม่ได้ตั้งโดย WeakClean)", "Already set (not by WeakClean)"))}</Badge>);
    if (st === "drifted") badges.push(<Badge key="drift" tone="warn">{tr(l("ถูก Windows คืนค่า", "Reverted by Windows"))}</Badge>);
    if (st === "unavailable") badges.push(<Badge key="na" tone="info">{tr(l("เครื่องนี้ไม่รองรับ", "Not supported on this PC"))}</Badge>);
    if (c.requiresAdmin && !elevated && st !== "unavailable") badges.push(<Badge key="adm" tone="info"><UserCog size={12} strokeWidth={2.4} aria-hidden="true" />{tr(l("ต้องเปิดแบบผู้ดูแล", "Needs admin"))}</Badge>);
    return (
      <div key={c.id} className={`flex items-center gap-4 border-t py-3 pr-3.5 pl-[22px] ${danger ? "border-danger-row" : "border-rowline"} ${locked(c) ? "opacity-75" : ""}`}>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[15px] font-medium">{name(c)}</span>
          <span className="text-[13px] leading-normal text-muted">{desc(c)}</span>
          <span className="mt-0.5 flex flex-wrap gap-1.5">{badges}</span>
        </div>
        <span className={locked(c) || working ? "pointer-events-none opacity-60" : ""}>
          <Switch checked={!!want[c.id]} onChange={() => toggle(c.id)} label={name(c)} />
        </span>
      </div>
    );
  };

  const failureLine = (f: TweakFailure) => `${name(byId(f.id))} — ${tr(failureText(f.reason))}`;
  const expert = catalog.filter((c) => c.category === "expert");

  return (
    <>
      <Hero
        tall
        title={t.pages.boost.title}
        subtitle={t.pages.boost.subtitle}
        aside={
          <div className="glass flex w-[380px] shrink-0 flex-col gap-2.5 rounded-[28px] px-6 py-[22px]">
            <span className="font-display text-[22px] font-medium">{tr(l(`จะเปลี่ยน ${count} อย่าง`, `${count} changes will be made`))}</span>
            <span className="text-sm text-muted">
              {tr(l(`ต้องรีบูต ${reboots} อย่าง · บันทึกค่าเดิมไว้ให้ย้อนกลับทุกอย่าง`, `${reboots} need a restart · previous values are saved so everything can be undone`))}
            </span>
            {working ? (
              <div role="status" className="mt-1 flex min-h-[54px] items-center justify-center gap-2.5 rounded-full bg-hover text-[15px] font-medium text-brand">
                <LoaderCircle size={20} strokeWidth={2.2} className="animate-spin" aria-hidden="true" />
                {tr(l("กำลังปรับแต่ง…", "Applying…"))}
              </div>
            ) : (
              <button
                type="button"
                disabled={count === 0 || status !== "ready"}
                onClick={() => setConfirm(true)}
                className="mt-1 inline-flex min-h-[54px] items-center justify-center gap-2.5 rounded-full bg-primary text-base font-semibold text-white shadow-[0_12px_26px_rgba(26,92,224,0.32)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
              >
                <Zap size={20} strokeWidth={2} aria-hidden="true" />
                {tr(l("ตรวจดูและใช้", "Review and apply"))}
              </button>
            )}
          </div>
        }
      />

      <div className="relative -mt-[78px] flex flex-col gap-[18px] px-10 pb-10">
        <div role="group" aria-label={tr(l("เลือกโปรไฟล์", "Choose a profile"))} className="grid grid-cols-3 gap-4">
          {profiles.map((p) => {
            const active = profile === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                disabled={working || status !== "ready"}
                onClick={() => pickProfile(p.id)}
                className={`flex flex-col items-start gap-2 rounded-card bg-glass px-[22px] py-5 text-left backdrop-blur-xl transition hover:-translate-y-0.5 ${
                  active ? "border-2 border-brand shadow-[0_16px_34px_rgba(26,92,224,0.25)]" : "border border-glass-edge shadow-[0_12px_30px_rgba(30,100,200,0.12)]"
                }`}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="flex items-center gap-2.5">
                    <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-full ${active ? "bg-switch-on" : "border-2 border-switch-off bg-surface"}`}>
                      {active && <Check size={12} strokeWidth={3.5} className="text-white" aria-hidden="true" />}
                    </span>
                    <span className="font-display text-xl font-medium">{tr(p.name)}</span>
                  </span>
                  <Badge tone={p.tone}>{tr(p.tag)}</Badge>
                </span>
                <span className="text-sm leading-relaxed text-muted">{tr(p.desc)}</span>
              </button>
            );
          })}
        </div>

        {status === "ready" && !elevated && needAdminCount > 0 && (
          <div className="flex items-center gap-3.5 rounded-[22px] bg-info-bg px-5 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-surface text-info-fg">
              <UserCog size={20} strokeWidth={2} aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{tr(l(`อีก ${needAdminCount} รายการต้องใช้สิทธิ์ผู้ดูแล`, `${needAdminCount} more tweaks need administrator rights`))}</span>
              <span className="text-sm text-info-fg">{tr(l("เปิดแอปใหม่แบบผู้ดูแลเพื่อปรับแต่งระดับเครื่อง (บริการ, นโยบาย) — เฉพาะส่วนของผู้ใช้ปรับได้เลยตอนนี้", "Reopen the app as administrator for machine-wide tweaks (services, policies) — per-user ones can be changed right now"))}</span>
            </div>
            <button type="button" onClick={() => void relaunch()} className="min-h-11 shrink-0 rounded-full bg-primary px-5 text-sm font-semibold text-white transition hover:brightness-105">
              {tr(l("เปิดใหม่แบบผู้ดูแล", "Reopen as admin"))}
            </button>
          </div>
        )}

        {outcome && (
          <ResultBanner
            title={
              outcome.applied.length + outcome.reverted.length > 0
                ? tr(l(`ปรับแต่งสำเร็จ ${outcome.applied.length + outcome.reverted.length} อย่าง`, `${outcome.applied.length + outcome.reverted.length} changes done`))
                : tr(l("ไม่มีอะไรถูกเปลี่ยน", "Nothing was changed"))
            }
            text={[
              outcome.applied.length + outcome.reverted.length > 0 ? tr(l("ย้อนกลับได้ที่หน้า ประวัติ & กู้คืน", "You can undo it in History & Restore")) : "",
              outcome.restorePoint === "created" ? tr(l("สร้างจุดคืนค่าของ Windows แล้ว", "A Windows restore point was created")) : outcome.restorePoint === "failed" ? tr(l("สร้างจุดคืนค่าของ Windows ไม่ได้ (เปิด System Protection ไว้หรือยัง?) แต่ค่าเดิมถูกบันทึกไว้แล้ว", "Couldn't create a Windows restore point (is System Protection on?) but the previous values are saved")) : "",
              outcome.reboots > 0 ? tr(l(`ต้องรีบูต ${outcome.reboots} อย่างจึงจะมีผล`, `${outcome.reboots} need a restart to take effect`)) : "",
            ].filter(Boolean).join(" · ")}
          >
            <button type="button" onClick={() => onNavigate("safety")} className="text-sm font-semibold text-link hover:underline">
              {tr(l("ดูประวัติ", "View history"))}
            </button>
            <button type="button" onClick={() => setOutcome(null)} className="min-h-10 rounded-full border border-edge-2 bg-surface px-4 text-sm transition-colors hover:bg-hover">
              {tr(l("ปิด", "Dismiss"))}
            </button>
          </ResultBanner>
        )}
        {outcome && outcome.failed.length > 0 && (
          <div role="alert" className="flex flex-col gap-1 rounded-[22px] bg-warn-bg px-5 py-4 text-sm text-warn-ink">
            <span className="font-semibold">{tr(l(`ทำไม่สำเร็จ ${outcome.failed.length} อย่าง (ไม่มีการเปลี่ยนแปลงค้างครึ่งๆ กลางๆ)`, `${outcome.failed.length} could not be done (nothing was left half-changed)`))}</span>
            {outcome.failed.map((f) => (
              <span key={f.id}>{failureLine(f)}</span>
            ))}
          </div>
        )}

        {status === "error" && (
          <p role="alert" className="m-0 rounded-card bg-danger-bg px-6 py-4 text-sm text-danger-fg">
            {tr(l("อ่านสถานะของเครื่องไม่สำเร็จ", "Couldn't read this PC's status"))}
          </p>
        )}
        {status === "loading" && catalog.length === 0 && <div className="rounded-card bg-surface px-6 py-10 text-center text-sm text-muted shadow-card">{tr(l("กำลังตรวจสถานะของเครื่อง…", "Checking this PC…"))}</div>}

        {CATS.map((c) => {
          const items = catalog.filter((x) => x.category === c.id);
          if (items.length === 0) return null;
          const onCount = items.filter((x) => want[x.id]).length;
          return (
            <section key={c.id} className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card">
              <div className="flex items-center justify-between px-[22px] pt-[18px] pb-2.5">
                <h2 className="m-0 font-display text-lg font-medium">{tr(c.title)}</h2>
                <span className="text-[13px] text-muted">{tr(l(`เปิด ${onCount} จาก ${items.length}`, `${onCount} of ${items.length} on`))}</span>
              </div>
              {items.map((x) => row(x))}
            </section>
          );
        })}

        {expert.length > 0 && (
          <section aria-labelledby="expert-title" className="flex flex-col overflow-hidden rounded-card border border-danger-edge bg-surface">
            <div className="flex items-center gap-3.5 px-[22px] py-[18px]">
              <span className="tile-warm flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white">
                <TriangleAlert size={22} strokeWidth={2} aria-hidden="true" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <h2 id="expert-title" className="m-0 font-display text-lg font-medium">
                  {tr(l("โหมดผู้เชี่ยวชาญ", "Expert mode"))}
                </h2>
                <span className="text-[13px] text-muted">{tr(l("ปิดระบบความปลอดภัยบางส่วนเพื่อแลก FPS — ไม่รวมอยู่ในโปรไฟล์ใดๆ", "Trades some security for FPS — never part of any profile"))}</span>
              </div>
              <button
                type="button"
                aria-expanded={expertOpen}
                onClick={() => setExpertOpen((v) => !v)}
                className="min-h-11 rounded-full border border-edge bg-surface px-[18px] text-sm transition-colors hover:bg-hover"
              >
                {expertOpen ? tr(l("ซ่อน", "Hide")) : tr(l(`แสดง (${expert.length})`, `Show (${expert.length})`))}
              </button>
            </div>
            {expertOpen && (
              <>
                <div className="px-[22px] pb-2.5">
                  <p className="m-0 rounded-2xl bg-danger-bg px-4 py-3 text-sm leading-relaxed text-danger-ink">
                    {tr(l("เปิดใช้เฉพาะเครื่องที่ใช้เล่นเกมอย่างเดียว และเข้าใจความเสี่ยง — เครื่องจะป้องกันมัลแวร์บางประเภทได้น้อยลง", "Use only on a PC dedicated to gaming, and only if you understand the risk — the PC will be less protected against some malware"))}
                  </p>
                </div>
                {expert.map((x) => row(x, true))}
              </>
            )}
          </section>
        )}

        <section aria-labelledby="never-title" className="flex flex-col gap-2 rounded-[22px] bg-soft px-[22px] py-[18px]">
          <h2 id="never-title" className="m-0 font-display text-base font-medium">
            {tr(l("สิ่งที่ WeakClean ตั้งใจไม่ทำ", "What WeakClean deliberately won't do"))}
          </h2>
          <p className="m-0 text-sm leading-[1.65] text-info-fg">
            {tr(l("ปิด UAC · ปิด Windows Update ถาวร (มี \"เลื่อนอัปเดต\" แทน) · ตั้ง PowerShell เป็น Unrestricted ทั้งเครื่อง · แนบโปรแกรมของบุคคลที่สามมาในตัวติดตั้ง", "Turn off UAC · permanently disable Windows Update (\"Pause updates\" is offered instead) · set PowerShell to Unrestricted machine-wide · bundle third-party programs in the installer"))}
          </p>
        </section>
      </div>

      <Dialog open={confirm} onClose={() => setConfirm(false)} labelledBy="confirm-title">
        <h2 id="confirm-title" className="m-0 font-display text-2xl font-medium">
          {tr(l(`ยืนยันการเปลี่ยน ${count} อย่าง`, `Confirm ${count} changes`))}
        </h2>
        <div className="scroll flex max-h-[260px] flex-col overflow-y-auto rounded-[18px] bg-app">
          {[...toApply.map((c) => ({ c, undo: false })), ...toRevert.map((c) => ({ c, undo: true }))].map(({ c, undo }) => (
            <div key={c.id} className="flex items-center gap-2.5 border-b border-line px-4 py-2.5 text-sm">
              {undo ? <Undo2 size={16} strokeWidth={2.4} className="shrink-0 text-warn-fg" aria-hidden="true" /> : <Check size={16} strokeWidth={2.6} className="shrink-0 text-brand" aria-hidden="true" />}
              <span className="flex-1">{name(c)}</span>
              <span className="text-xs text-muted">{undo ? tr(l("ย้อนกลับ", "Undo")) : tr(RISK_LABEL[c.risk])}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 text-sm text-info-fg">
          <span className="flex items-center gap-2">
            <ShieldCheck size={16} strokeWidth={1.9} aria-hidden="true" />
            {toApply.some((c) => c.requiresAdmin)
              ? tr(l("สร้างจุดคืนค่า \"WeakClean — before applying tweaks\" ให้ก่อน และบันทึกค่าเดิมทุกค่า", "Creates the restore point \"WeakClean — before applying tweaks\" first and saves every previous value"))
              : tr(l("บันทึกค่าเดิมทุกค่าไว้ ย้อนกลับได้ที่หน้า ประวัติ & กู้คืน", "Every previous value is saved — undo from History & Restore"))}
          </span>
          {reboots > 0 && (
            <span className="flex items-center gap-2">
              <RotateCw size={16} strokeWidth={1.9} aria-hidden="true" />
              {tr(l(`ต้องรีบูต ${reboots} อย่าง — รีบูตทีหลังได้`, `${reboots} need a restart — you can restart later`))}
            </span>
          )}
        </div>
        <div className="mt-1 flex justify-end gap-2.5">
          <button type="button" onClick={() => setConfirm(false)} className="min-h-[50px] rounded-full border border-edge bg-surface px-6 text-[15px] transition-colors hover:bg-hover">
            {t.cancel}
          </button>
          <button type="button" onClick={() => void apply()} className="min-h-[50px] rounded-full bg-primary px-[26px] text-[15px] font-semibold text-white shadow-primary transition hover:brightness-105">
            {tr(l("ยืนยันและเริ่ม", "Confirm and start"))}
          </button>
        </div>
      </Dialog>
    </>
  );
}

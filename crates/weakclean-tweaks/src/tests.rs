use super::*;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use weakclean_cleaner::Store;

/// ระบบจำลองในหน่วยความจำ — ไม่แตะ registry/services จริงของเครื่อง
#[derive(Default)]
struct MemState {
    regs: HashMap<(Hive, String, String), RegData>,
    keys: HashSet<(Hive, String)>,
    svcs: HashMap<String, SvcState>,
    elevated: bool,
    /// เขียน registry ครั้งที่ N (นับจาก 1) แล้วล้มเหลว
    fail_write_at: Option<usize>,
    writes: usize,
    /// ชื่อค่าที่ระบบ "ไม่ยอมรับ" (เขียนสำเร็จแต่ค่าไม่เปลี่ยน เหมือนนโยบายบล็อก)
    ignore_names: HashSet<String>,
    restore_points: usize,
    restore_point_fails: bool,
}

#[derive(Clone, Default)]
struct Mem(Arc<Mutex<MemState>>);

fn k(h: Hive, p: &str) -> (Hive, String) {
    (h, p.to_lowercase())
}

impl System for Mem {
    fn is_elevated(&self) -> bool {
        self.0.lock().unwrap().elevated
    }
    fn reg_get(&self, h: Hive, p: &str, n: &str) -> io::Result<Option<RegData>> {
        Ok(self.0.lock().unwrap().regs.get(&(h, p.to_lowercase(), n.to_lowercase())).cloned())
    }
    fn reg_set(&self, h: Hive, p: &str, n: &str, d: &RegData) -> io::Result<()> {
        let mut s = self.0.lock().unwrap();
        s.writes += 1;
        if s.fail_write_at == Some(s.writes) {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "injected failure"));
        }
        if h == Hive::HKLM && !s.elevated {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "access denied"));
        }
        // สร้าง key ทุกระดับ
        let mut acc = String::new();
        for seg in p.split('\\') {
            if !acc.is_empty() {
                acc.push('\\');
            }
            acc.push_str(seg);
            s.keys.insert(k(h, &acc));
        }
        if !s.ignore_names.contains(n) {
            s.regs.insert((h, p.to_lowercase(), n.to_lowercase()), d.clone());
        }
        Ok(())
    }
    fn reg_delete_value(&self, h: Hive, p: &str, n: &str) -> io::Result<()> {
        self.0.lock().unwrap().regs.remove(&(h, p.to_lowercase(), n.to_lowercase()));
        Ok(())
    }
    fn reg_key_exists(&self, h: Hive, p: &str) -> bool {
        self.0.lock().unwrap().keys.contains(&k(h, p))
    }
    fn reg_delete_key(&self, h: Hive, p: &str) -> io::Result<()> {
        let mut s = self.0.lock().unwrap();
        let prefix = format!("{}\\", p.to_lowercase());
        let has_children = s.keys.iter().any(|(hh, kk)| *hh == h && kk.starts_with(&prefix));
        let has_values = s.regs.keys().any(|(hh, pp, _)| *hh == h && pp == &p.to_lowercase());
        if has_children || has_values {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "key not empty"));
        }
        s.keys.remove(&k(h, p));
        Ok(())
    }
    fn svc_get(&self, n: &str) -> io::Result<Option<SvcState>> {
        Ok(self.0.lock().unwrap().svcs.get(&n.to_lowercase()).copied())
    }
    fn svc_set_start(&self, n: &str, start: StartType) -> io::Result<()> {
        let mut s = self.0.lock().unwrap();
        if !s.elevated {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "access denied"));
        }
        s.svcs.get_mut(&n.to_lowercase()).ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no service"))?.start = start;
        Ok(())
    }
    fn svc_stop(&self, n: &str) -> io::Result<()> {
        if let Some(v) = self.0.lock().unwrap().svcs.get_mut(&n.to_lowercase()) {
            v.running = false;
        }
        Ok(())
    }
    fn svc_start(&self, n: &str) -> io::Result<()> {
        if let Some(v) = self.0.lock().unwrap().svcs.get_mut(&n.to_lowercase()) {
            v.running = true;
        }
        Ok(())
    }
    fn create_restore_point(&self, _: &str) -> io::Result<()> {
        let mut s = self.0.lock().unwrap();
        if s.restore_point_fails {
            return Err(io::Error::other("System Protection is off"));
        }
        s.restore_points += 1;
        Ok(())
    }
}

impl Mem {
    fn set(&self, h: Hive, p: &str, n: &str, d: RegData) {
        self.reg_set(h, p, n, &d).unwrap();
        self.0.lock().unwrap().writes = 0;
    }
    fn get(&self, h: Hive, p: &str, n: &str) -> Option<RegData> {
        self.reg_get(h, p, n).unwrap()
    }
    fn state<R>(&self, f: impl FnOnce(&mut MemState) -> R) -> R {
        f(&mut self.0.lock().unwrap())
    }
}

struct Env {
    _tmp: tempfile::TempDir,
    mem: Mem,
    eng: Engine,
}

fn env(elevated: bool) -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let store = Arc::new(Store::open(tmp.path()).unwrap());
    let mem = Mem::default();
    mem.state(|s| s.elevated = elevated);
    let eng = Engine::new(Box::new(mem.clone()), store, builtin_catalog()).unwrap();
    Env { _tmp: tmp, mem, eng }
}

fn ids(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

fn state_of(e: &Env, id: &str) -> &'static str {
    e.eng.status().tweaks.into_iter().find(|t| t.id == id).unwrap().state
}

const GAMEDVR: &str = r"System\GameConfigStore";
const CLASSIC: &str = r"Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\InprocServer32";

#[test]
fn builtin_catalog_is_valid() {
    let cat = builtin_catalog();
    let mut seen = HashSet::new();
    for t in &cat {
        assert!(seen.insert(t.id.clone()), "duplicate id {}", t.id);
        assert!(!t.ops.is_empty(), "{} has no ops", t.id);
        assert!(t.profiles.iter().all(|p| p == "balanced" || p == "gaming"), "{}: bad profile", t.id);
        // โหมดผู้เชี่ยวชาญห้ามอยู่ในโปรไฟล์ใดๆ
        if t.risk == Risk::Expert {
            assert!(t.profiles.is_empty(), "{} must not be in a profile", t.id);
        }
    }
    // โปรไฟล์ สมดุล = เฉพาะที่ปลอดภัย
    assert!(cat.iter().filter(|t| t.profiles.contains(&"balanced".to_string())).all(|t| t.risk == Risk::Safe));
    // สิ่งที่ตั้งใจไม่ทำ ต้องไม่โผล่ในแคตตาล็อก
    for banned in ["uac", "windowsupdate", "executionpolicy", "fontcache", "shellhwdetection", "wpnservice", "tzautoupdate"] {
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../data/tweaks/catalog.toml")).unwrap().to_lowercase();
        let ops_only: String = text.lines().filter(|l| !l.trim_start().starts_with('#')).collect::<Vec<_>>().join("\n");
        assert!(!ops_only.contains(banned), "catalog must not touch {banned}");
    }
}

#[test]
fn apply_then_revert_restores_exact_previous_values() {
    let e = env(false);
    // ค่าเดิม: GameDVR_Enabled = 1 มีอยู่, AppCaptureEnabled ไม่มีอยู่เลย
    e.mem.set(Hive::HKCU, GAMEDVR, "GameDVR_Enabled", RegData::Dword(1));
    assert_eq!(state_of(&e, "gamedvr"), "off");

    let r = e.eng.apply(&ids(&["gamedvr"]), "gaming").unwrap();
    assert_eq!((r.applied.as_slice(), r.failed.len(), r.restore_point), (&["gamedvr".to_string()][..], 0, "skipped"));
    assert_eq!(e.mem.get(Hive::HKCU, GAMEDVR, "GameDVR_Enabled"), Some(RegData::Dword(0)));
    assert_eq!(state_of(&e, "gamedvr"), "on");

    let ch = e.eng.changes(10).unwrap();
    assert_eq!(ch.len(), 1);
    assert_eq!(ch[0].diffs[0], "GameDVR_Enabled: 1 → 0");
    assert_eq!(ch[0].diffs[1], "AppCaptureEnabled: (not set) → 0");

    let rv = e.eng.revert_change(ch[0].id).unwrap();
    assert_eq!((rv.reverted, rv.failed.len()), (1, 0));
    assert_eq!(e.mem.get(Hive::HKCU, GAMEDVR, "GameDVR_Enabled"), Some(RegData::Dword(1)), "old value restored");
    assert_eq!(e.mem.get(Hive::HKCU, r"Software\Microsoft\Windows\CurrentVersion\GameDVR", "AppCaptureEnabled"), None, "value that never existed is deleted again");
    assert_eq!(state_of(&e, "gamedvr"), "off");
    // ย้อนซ้ำไม่ทำอะไร
    assert_eq!(e.eng.revert_change(ch[0].id).unwrap().reverted, 0);
}

#[test]
fn keys_created_by_us_are_removed_on_revert() {
    let e = env(false);
    // บน Windows จริง HKCU\Software\Classes มีอยู่แล้ว แต่ CLSID ของเราไม่มี
    e.mem.state(|s| {
        s.keys.insert(k(Hive::HKCU, "Software"));
        s.keys.insert(k(Hive::HKCU, r"Software\Classes"));
        s.keys.insert(k(Hive::HKCU, r"Software\Classes\CLSID"));
    });
    assert!(!e.mem.reg_key_exists(Hive::HKCU, CLASSIC));
    e.eng.apply(&ids(&["classic"]), "custom").unwrap();
    assert_eq!(e.mem.get(Hive::HKCU, CLASSIC, ""), Some(RegData::Sz(String::new())));
    assert!(e.mem.reg_key_exists(Hive::HKCU, CLASSIC));

    e.eng.revert_all().unwrap();
    assert!(!e.mem.reg_key_exists(Hive::HKCU, CLASSIC), "created InprocServer32 key must be gone");
    assert!(!e.mem.reg_key_exists(Hive::HKCU, r"Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}"), "created CLSID key must be gone");
    assert!(e.mem.reg_key_exists(Hive::HKCU, r"Software\Classes"), "pre-existing parent keys are untouched");
}

#[test]
fn pre_existing_keys_are_never_deleted() {
    let e = env(false);
    e.mem.set(Hive::HKCU, CLASSIC, "keepme", RegData::Dword(7));
    e.eng.apply(&ids(&["classic"]), "custom").unwrap();
    e.eng.revert_all().unwrap();
    assert!(e.mem.reg_key_exists(Hive::HKCU, CLASSIC));
    assert_eq!(e.mem.get(Hive::HKCU, CLASSIC, "keepme"), Some(RegData::Dword(7)));
}

#[test]
fn failure_in_the_middle_rolls_everything_back() {
    let e = env(false);
    let p = r"Control Panel\Mouse";
    e.mem.set(Hive::HKCU, p, "MouseSpeed", RegData::Sz("1".into()));
    e.mem.set(Hive::HKCU, p, "MouseThreshold1", RegData::Sz("6".into()));
    e.mem.set(Hive::HKCU, p, "MouseThreshold2", RegData::Sz("10".into()));
    e.mem.state(|s| s.fail_write_at = Some(3)); // op ที่ 3 ล้ม

    let r = e.eng.apply(&ids(&["mouse"]), "gaming").unwrap();
    assert!(r.applied.is_empty());
    assert_eq!(r.failed.len(), 1);
    assert_eq!(r.event_id, None, "nothing applied → no history entry");
    assert_eq!(e.mem.get(Hive::HKCU, p, "MouseSpeed"), Some(RegData::Sz("1".into())));
    assert_eq!(e.mem.get(Hive::HKCU, p, "MouseThreshold1"), Some(RegData::Sz("6".into())));
    assert_eq!(e.mem.get(Hive::HKCU, p, "MouseThreshold2"), Some(RegData::Sz("10".into())));
    assert!(e.eng.changes(10).unwrap().is_empty());
}

#[test]
fn value_the_system_refuses_is_rolled_back_not_left_half_done() {
    let e = env(false);
    e.mem.set(Hive::HKCU, GAMEDVR, "GameDVR_Enabled", RegData::Dword(1));
    e.mem.state(|s| s.ignore_names.insert("AppCaptureEnabled".into())); // เขียนแล้วค่าไม่เปลี่ยน
    let r = e.eng.apply(&ids(&["gamedvr"]), "gaming").unwrap();
    assert_eq!(r.failed[0].reason, "verify_failed");
    assert_eq!(e.mem.get(Hive::HKCU, GAMEDVR, "GameDVR_Enabled"), Some(RegData::Dword(1)), "first op must be undone too");
}

#[test]
fn admin_tweaks_are_refused_without_elevation() {
    let e = env(false);
    let r = e.eng.apply(&ids(&["prio", "transp"]), "gaming").unwrap();
    assert_eq!(r.applied, ids(&["transp"]));
    assert_eq!(r.failed[0].id, "prio");
    assert_eq!(r.failed[0].reason, "needs_admin");
    assert!(e.eng.status().tweaks.iter().all(|t| t.id != "prio" || t.state == "off"));
    assert!(!e.eng.status().elevated);
}

#[test]
fn elevated_apply_makes_a_restore_point_and_handles_hklm() {
    let e = env(true);
    let r = e.eng.apply(&ids(&["prio", "transp"]), "gaming").unwrap();
    assert_eq!(r.restore_point, "created");
    assert_eq!(e.mem.state(|s| s.restore_points), 1);
    assert_eq!(r.applied.len(), 2);
    assert_eq!(e.mem.get(Hive::HKLM, r"SYSTEM\CurrentControlSet\Control\PriorityControl", "Win32PrioritySeparation"), Some(RegData::Dword(38)));

    // เฉพาะ tweak ระดับผู้ใช้ → ไม่ต้องสร้างจุดคืนค่า
    let e2 = env(true);
    assert_eq!(e2.eng.apply(&ids(&["transp"]), "x").unwrap().restore_point, "skipped");

    // สร้างจุดคืนค่าไม่ได้ → ยังทำต่อ (เรามีค่าเดิมเก็บเองอยู่แล้ว) แต่รายงานตามจริง
    let e3 = env(true);
    e3.mem.state(|s| s.restore_point_fails = true);
    let r3 = e3.eng.apply(&ids(&["prio"]), "x").unwrap();
    assert_eq!((r3.restore_point, r3.applied.len()), ("failed", 1));
}

#[test]
fn services_are_changed_stopped_and_restored() {
    let e = env(true);
    e.mem.state(|s| {
        s.svcs.insert("sysmain".into(), SvcState { start: StartType::Auto, running: true });
    });
    e.eng.apply(&ids(&["sysmain"]), "gaming").unwrap();
    assert_eq!(e.mem.state(|s| s.svcs["sysmain"]), SvcState { start: StartType::Disabled, running: false });
    assert_eq!(e.eng.changes(1).unwrap()[0].diffs[0], "SysMain: Automatic → Disabled");

    e.eng.revert_all().unwrap();
    assert_eq!(e.mem.state(|s| s.svcs["sysmain"]), SvcState { start: StartType::Auto, running: true }, "start type and running state restored");
}

#[test]
fn missing_services_are_skipped_and_all_missing_means_unavailable() {
    let e = env(true);
    assert_eq!(state_of(&e, "hyperv"), "unavailable");
    assert_eq!(e.eng.apply(&ids(&["hyperv"]), "x").unwrap().failed[0].reason, "unavailable");

    // มีแค่บางตัว → ใช้กับตัวที่มี
    e.mem.state(|s| {
        s.svcs.insert("vmicheartbeat".into(), SvcState { start: StartType::Manual, running: false });
    });
    assert_eq!(state_of(&e, "hyperv"), "off");
    assert_eq!(e.eng.apply(&ids(&["hyperv"]), "x").unwrap().applied, ids(&["hyperv"]));
    assert_eq!(e.mem.state(|s| s.svcs["vmicheartbeat"].start), StartType::Disabled);
}

#[test]
fn already_applied_values_are_reported_as_external_and_left_alone() {
    let e = env(false);
    e.mem.set(Hive::HKCU, r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "EnableTransparency", RegData::Dword(0));
    assert_eq!(state_of(&e, "transp"), "external");
    let r = e.eng.apply(&ids(&["transp"]), "x").unwrap();
    assert_eq!((r.skipped, r.applied.len(), r.event_id), (ids(&["transp"]), 0, None));
    assert!(e.eng.changes(5).unwrap().is_empty(), "no record → we never revert what we didn't set");
}

#[test]
fn drift_is_detected_and_can_be_reapplied() {
    let e = env(false);
    e.eng.apply(&ids(&["widgets"]), "balanced").unwrap();
    assert_eq!(state_of(&e, "widgets"), "on");

    // Windows Update คืนค่ากลับ
    e.mem.set(Hive::HKCU, r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "TaskbarDa", RegData::Dword(1));
    assert_eq!(state_of(&e, "widgets"), "drifted");

    let r = e.eng.apply(&ids(&["widgets"]), "balanced").unwrap();
    assert_eq!(r.applied, ids(&["widgets"]));
    assert_eq!(state_of(&e, "widgets"), "on");
    // ย้อนกลับครั้งล่าสุด → ค่ากลับเป็นค่าที่ Windows คืนมา (ไม่ใช่ค่าตั้งต้นเก่ากว่านั้น)
    e.eng.revert_change(e.eng.changes(1).unwrap()[0].id).unwrap();
    assert_eq!(e.mem.get(Hive::HKCU, r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "TaskbarDa"), Some(RegData::Dword(1)));
}

#[test]
fn event_state_follows_reverts_and_batch_revert_works() {
    let e = env(false);
    let r = e.eng.apply(&ids(&["transp", "widgets", "gamedvr"]), "balanced").unwrap();
    let ev = r.event_id.unwrap();
    let store_state = |e: &Env| e.eng.store.events(10).unwrap().into_iter().find(|x| x.id == ev).unwrap();
    assert_eq!(store_state(&e).state, "active");
    assert_eq!(store_state(&e).params["profile"], "balanced");

    let first = e.eng.changes(10).unwrap().into_iter().find(|c| c.tweak_id == "widgets").unwrap();
    e.eng.revert_change(first.id).unwrap();
    assert_eq!(store_state(&e).state, "partial");

    let rv = e.eng.revert_event(ev).unwrap();
    assert_eq!(rv.reverted, 2);
    assert_eq!(store_state(&e).state, "undone");
    assert!(e.eng.status().tweaks.iter().all(|t| t.state == "off" || t.state == "unavailable"));
}

#[test]
fn unreadable_existing_value_blocks_the_tweak() {
    // ถ้าอ่านค่าเดิมไม่ได้ เรากู้คืนไม่ได้ → ต้องไม่แตะ
    struct BadRead(Mem);
    impl System for BadRead {
        fn is_elevated(&self) -> bool { self.0.is_elevated() }
        fn reg_get(&self, h: Hive, p: &str, n: &str) -> io::Result<Option<RegData>> {
            if n == "EnableTransparency" { Err(io::Error::new(io::ErrorKind::InvalidData, "unsupported type")) } else { self.0.reg_get(h, p, n) }
        }
        fn reg_set(&self, h: Hive, p: &str, n: &str, d: &RegData) -> io::Result<()> { self.0.reg_set(h, p, n, d) }
        fn reg_delete_value(&self, h: Hive, p: &str, n: &str) -> io::Result<()> { self.0.reg_delete_value(h, p, n) }
        fn reg_key_exists(&self, h: Hive, p: &str) -> bool { self.0.reg_key_exists(h, p) }
        fn reg_delete_key(&self, h: Hive, p: &str) -> io::Result<()> { self.0.reg_delete_key(h, p) }
        fn svc_get(&self, n: &str) -> io::Result<Option<SvcState>> { self.0.svc_get(n) }
        fn svc_set_start(&self, n: &str, s: StartType) -> io::Result<()> { self.0.svc_set_start(n, s) }
        fn svc_stop(&self, n: &str) -> io::Result<()> { self.0.svc_stop(n) }
        fn svc_start(&self, n: &str) -> io::Result<()> { self.0.svc_start(n) }
        fn create_restore_point(&self, d: &str) -> io::Result<()> { self.0.create_restore_point(d) }
    }
    let tmp = tempfile::tempdir().unwrap();
    let store = Arc::new(Store::open(tmp.path()).unwrap());
    let eng = Engine::new(Box::new(BadRead(Mem::default())), store, builtin_catalog()).unwrap();
    let r = eng.apply(&ids(&["transp"]), "x").unwrap();
    assert!(r.applied.is_empty() && r.failed.len() == 1);
}

/// ทดสอบ WinSystem กับ registry จริง — แต่ใช้ key ทดสอบแยกใต้ HKCU ที่ลบทิ้งเองทุกครั้ง ไม่แตะค่าของระบบ
#[cfg(windows)]
#[test]
fn real_registry_roundtrip_in_a_private_test_key() {
    let sys = WinSystem;
    let root = format!(r"Software\WeakClean-Test-{}", std::process::id());
    let sub = format!(r"{root}\a\b");

    assert!(!sys.reg_key_exists(Hive::HKCU, &root));
    assert_eq!(sys.reg_get(Hive::HKCU, &sub, "x").unwrap(), None);

    sys.reg_set(Hive::HKCU, &sub, "d", &RegData::Dword(0xFFFF_FFFF)).unwrap();
    sys.reg_set(Hive::HKCU, &sub, "s", &RegData::Sz("สวัสดี 0".into())).unwrap();
    sys.reg_set(Hive::HKCU, &sub, "", &RegData::Sz(String::new())).unwrap();
    assert_eq!(sys.reg_get(Hive::HKCU, &sub, "d").unwrap(), Some(RegData::Dword(0xFFFF_FFFF)));
    assert_eq!(sys.reg_get(Hive::HKCU, &sub, "s").unwrap(), Some(RegData::Sz("สวัสดี 0".into())));
    assert_eq!(sys.reg_get(Hive::HKCU, &sub, "").unwrap(), Some(RegData::Sz(String::new())));
    assert!(sys.reg_key_exists(Hive::HKCU, &sub));

    // เขียนทับเปลี่ยนชนิดได้ ลบค่าได้ ลบซ้ำไม่ error
    sys.reg_set(Hive::HKCU, &sub, "d", &RegData::Sz("now text".into())).unwrap();
    assert_eq!(sys.reg_get(Hive::HKCU, &sub, "d").unwrap(), Some(RegData::Sz("now text".into())));
    sys.reg_delete_value(Hive::HKCU, &sub, "d").unwrap();
    sys.reg_delete_value(Hive::HKCU, &sub, "d").unwrap();
    assert_eq!(sys.reg_get(Hive::HKCU, &sub, "d").unwrap(), None);

    // ลบ key: ไม่ว่างต้องลบไม่ได้ (ไม่ recursive) ว่างแล้วลบได้
    assert!(sys.reg_delete_key(Hive::HKCU, &format!(r"{root}\a")).is_err());
    sys.reg_delete_value(Hive::HKCU, &sub, "s").unwrap();
    sys.reg_delete_value(Hive::HKCU, &sub, "").unwrap();
    sys.reg_delete_key(Hive::HKCU, &sub).unwrap();
    sys.reg_delete_key(Hive::HKCU, &format!(r"{root}\a")).unwrap();
    sys.reg_delete_key(Hive::HKCU, &root).unwrap();
    assert!(!sys.reg_key_exists(Hive::HKCU, &root));
}

/// อ่านอย่างเดียว: ตรวจว่าอ่านบริการ/สิทธิ์ของเครื่องจริงได้โดยไม่เปลี่ยนอะไร
#[cfg(windows)]
#[test]
fn real_system_reads_are_sane() {
    let sys = WinSystem;
    let _ = sys.is_elevated();
    let ev = sys.svc_get("EventLog").unwrap().expect("EventLog exists on every Windows");
    assert_eq!(ev.start, StartType::Auto);
    assert!(ev.running);
    assert_eq!(sys.svc_get("WeakClean-No-Such-Service").unwrap(), None);
    // ค่าจริงของ Windows ที่ต้องมีเสมอ อ่านได้เป็น DWORD
    assert!(matches!(sys.reg_get(Hive::HKLM, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion", "CurrentMajorVersionNumber").unwrap(), Some(RegData::Dword(10))));
}

/// engine จริง + WinSystem จริง + registry จริง แต่ชี้ไปที่ key ทดสอบแยก ลบทิ้งเองทุกครั้ง
#[cfg(windows)]
#[test]
fn real_engine_on_real_registry_in_a_private_test_key() {
    let pid = std::process::id();
    let root = format!(r"Software\WeakClean-Test-Engine-{pid}");
    let hklm_root = format!(r"SOFTWARE\WeakClean-Test-Engine-{pid}");
    let toml = format!(
        r#"
[[tweak]]
id = "t_values"
category = "sys"
risk = "safe"
name_th = "x"
name_en = "x"
desc_th = "x"
desc_en = "x"
  [[tweak.ops]]
  type = "registry"
  hive = "HKCU"
  path = '{root}\Alpha'
  name = "A"
  kind = "dword"
  value = 4294967295
  [[tweak.ops]]
  type = "registry"
  hive = "HKCU"
  path = '{root}\Alpha'
  name = "B"
  kind = "sz"
  value = "ตั้งค่าแล้ว"

[[tweak]]
id = "t_newkey"
category = "sys"
risk = "safe"
name_th = "x"
name_en = "x"
desc_th = "x"
desc_en = "x"
  [[tweak.ops]]
  type = "registry"
  hive = "HKCU"
  path = '{root}\Deep\Er\Key'
  name = ""
  kind = "sz"
  value = ""

[[tweak]]
id = "t_denied"
category = "sys"
risk = "safe"
name_th = "x"
name_en = "x"
desc_th = "x"
desc_en = "x"
  [[tweak.ops]]
  type = "registry"
  hive = "HKCU"
  path = '{root}\Beta'
  name = "First"
  kind = "dword"
  value = 1
  [[tweak.ops]]
  type = "registry"
  hive = "HKLM"
  path = '{hklm_root}'
  name = "Second"
  kind = "dword"
  value = 1
"#
    );
    let defs = catalog::parse(&toml).unwrap();
    let tmp = tempfile::tempdir().unwrap();
    let store = Arc::new(Store::open(tmp.path()).unwrap());
    let eng = Engine::new(Box::new(WinSystem), store, defs).unwrap();
    let sys = WinSystem;
    let state = |id: &str| eng.status().tweaks.into_iter().find(|t| t.id == id).unwrap().state;

    // ค่าเดิมที่มีอยู่แล้ว: A เป็น DWORD 1, B ไม่มี
    sys.reg_set(Hive::HKCU, &format!(r"{root}\Alpha"), "A", &RegData::Dword(1)).unwrap();
    assert_eq!(state("t_values"), "off");

    let r = eng.apply(&ids(&["t_values", "t_newkey"]), "test").unwrap();
    assert_eq!((r.applied.len(), r.failed.len()), (2, 0), "{r:?}");
    assert_eq!(sys.reg_get(Hive::HKCU, &format!(r"{root}\Alpha"), "A").unwrap(), Some(RegData::Dword(0xFFFF_FFFF)));
    assert_eq!(sys.reg_get(Hive::HKCU, &format!(r"{root}\Alpha"), "B").unwrap(), Some(RegData::Sz("ตั้งค่าแล้ว".into())));
    assert!(sys.reg_key_exists(Hive::HKCU, &format!(r"{root}\Deep\Er\Key")));
    assert_eq!((state("t_values"), state("t_newkey")), ("on", "on"));

    // Windows/โปรแกรมอื่นแก้ค่ากลับ → ตรวจเจอว่า drifted
    sys.reg_set(Hive::HKCU, &format!(r"{root}\Alpha"), "A", &RegData::Dword(5)).unwrap();
    assert_eq!(state("t_values"), "drifted");
    sys.reg_set(Hive::HKCU, &format!(r"{root}\Alpha"), "A", &RegData::Dword(0xFFFF_FFFF)).unwrap();

    // ย้อนทั้งหมด: A กลับเป็น 1, B ถูกลบ, key ที่เราสร้างหายไปหมด
    let rv = eng.revert_all().unwrap();
    assert_eq!((rv.reverted, rv.failed.len()), (2, 0));
    assert_eq!(sys.reg_get(Hive::HKCU, &format!(r"{root}\Alpha"), "A").unwrap(), Some(RegData::Dword(1)));
    assert_eq!(sys.reg_get(Hive::HKCU, &format!(r"{root}\Alpha"), "B").unwrap(), None);
    assert!(!sys.reg_key_exists(Hive::HKCU, &format!(r"{root}\Deep")), "created key chain removed");

    // ความล้มเหลวจริงของ Windows: เขียน HKLM โดยไม่มีสิทธิ์ → op แรก (HKCU) ต้องถูกย้อนกลับ
    if !sys.is_elevated() {
        let r = eng.apply(&ids(&["t_denied"]), "test");
        // t_denied ต้องใช้ผู้ดูแล → ถูกปฏิเสธก่อนแตะอะไรเลย
        assert_eq!(r.unwrap().failed[0].reason, "needs_admin");
        assert!(!sys.reg_key_exists(Hive::HKCU, &format!(r"{root}\Beta")), "refused before touching anything");
    }

    // เก็บกวาด
    sys.reg_delete_value(Hive::HKCU, &format!(r"{root}\Alpha"), "A").unwrap();
    for k in [r"\Alpha", r"\Deep\Er\Key", r"\Deep\Er", r"\Deep", r"\Beta", ""] {
        let _ = sys.reg_delete_key(Hive::HKCU, &format!("{root}{k}"));
    }
    assert!(!sys.reg_key_exists(Hive::HKCU, &root), "test key fully cleaned up");
}

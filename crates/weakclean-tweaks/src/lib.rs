//! WeakClean tweak engine — ปรับแต่ง Windows แบบ "ข้อมูล" และย้อนกลับได้ทุกอย่าง
//!
//! กติกาความปลอดภัย (WeClean_Plan.md หัวข้อ 2 และ 8)
//! 1. ก่อนเปลี่ยนทุกครั้ง อ่านและบันทึกค่าเดิมของทุก op (รวมถึง "ไม่มีค่านี้อยู่เดิม" และ key ที่เราสร้างขึ้น)
//! 2. tweak หนึ่งตัวเป็น transaction: op ไหนล้มเหลว หรืออ่านกลับมาแล้วค่าไม่ตรง → ย้อน op ที่ทำไปแล้วทั้งหมดทันที
//! 3. ย้อนกลับได้ทีละ tweak หรือทั้งชุด ค่ากลับเป็นของเดิมเป๊ะ (ค่าที่ไม่เคยมี → ลบทิ้ง)
//! 4. ตรวจ "ถูก Windows คืนค่า" (drift) ได้จากการเทียบค่าปัจจุบันกับที่เราตั้งไว้

pub mod catalog;
pub mod sys;

pub use catalog::{builtin as builtin_catalog, Op, Risk, TweakDef};
pub use sys::{Hive, RegData, StartType, SvcState, System};
#[cfg(windows)]
pub use sys::WinSystem;

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use weakclean_cleaner::rusqlite::{params, OptionalExtension};
use weakclean_cleaner::Store;

fn db_err(e: weakclean_cleaner::rusqlite::Error) -> io::Error {
    io::Error::other(e)
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TweakMeta {
    pub id: String,
    pub category: String,
    pub risk: &'static str,
    pub reboot: bool,
    pub profiles: Vec<String>,
    pub name_th: String,
    pub name_en: String,
    pub desc_th: String,
    pub desc_en: String,
    pub requires_admin: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TweakStatus {
    pub id: String,
    /// off | on (เราตั้งไว้และยังอยู่) | external (ตั้งอยู่แล้วโดยไม่ใช่เรา) | drifted (เคยตั้งแต่ถูกเปลี่ยนกลับ) | unavailable
    pub state: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub elevated: bool,
    pub tweaks: Vec<TweakStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub id: String,
    /// needs_admin | verify_failed | หรือข้อความจากระบบ
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    /// None = ไม่มีอะไรถูกเปลี่ยนเลย
    pub event_id: Option<i64>,
    pub applied: Vec<String>,
    /// ตั้งอยู่แล้ว จึงไม่ต้องทำอะไร
    pub skipped: Vec<String>,
    pub failed: Vec<Failure>,
    /// created | failed | skipped
    pub restore_point: &'static str,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RevertResult {
    pub reverted: u32,
    pub failed: Vec<Failure>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRow {
    pub id: i64,
    pub event_id: i64,
    pub tweak_id: String,
    pub ts: i64,
    /// applied | reverted
    pub state: String,
    /// เช่น "GameDVR_Enabled: 1 → 0"
    pub diffs: Vec<String>,
}

/// ค่าเดิมของ op หนึ่งก่อนเราแตะ — ใช้ย้อนกลับ
#[derive(Debug, Clone, Serialize, Deserialize)]
enum Prior {
    Reg { hive: Hive, path: String, name: String, before: Option<RegData>, created_keys: Vec<String> },
    Svc { name: String, before: SvcState, stopped: bool },
}

pub struct Engine {
    sys: Box<dyn System>,
    store: Arc<Store>,
    defs: Vec<TweakDef>,
}

impl Engine {
    pub fn new(sys: Box<dyn System>, store: Arc<Store>, defs: Vec<TweakDef>) -> io::Result<Engine> {
        store.with_conn(|c| {
            c.execute_batch(
                "CREATE TABLE IF NOT EXISTS tweak_changes (
                     id       INTEGER PRIMARY KEY,
                     event_id INTEGER NOT NULL,
                     tweak_id TEXT NOT NULL,
                     ts       INTEGER NOT NULL,
                     priors   TEXT NOT NULL,
                     diffs    TEXT NOT NULL,
                     state    TEXT NOT NULL DEFAULT 'applied'
                 );
                 CREATE INDEX IF NOT EXISTS tweak_changes_tweak ON tweak_changes(tweak_id, state);
                 CREATE INDEX IF NOT EXISTS tweak_changes_event ON tweak_changes(event_id);",
            )
        })
        .map_err(db_err)?;
        Ok(Engine { sys, store, defs })
    }

    pub fn catalog(&self) -> Vec<TweakMeta> {
        self.defs
            .iter()
            .map(|d| TweakMeta {
                id: d.id.clone(),
                category: d.category.clone(),
                risk: d.risk.as_str(),
                reboot: d.reboot,
                profiles: d.profiles.clone(),
                name_th: d.name_th.clone(),
                name_en: d.name_en.clone(),
                desc_th: d.desc_th.clone(),
                desc_en: d.desc_en.clone(),
                requires_admin: d.requires_admin(),
            })
            .collect()
    }

    fn def(&self, id: &str) -> io::Result<&TweakDef> {
        self.defs.iter().find(|d| d.id == id).ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, format!("unknown tweak {id}")))
    }

    /// (จำนวน op ที่ใช้ได้กับเครื่องนี้, ทุก op ตรงกับค่าที่ต้องการหรือไม่)
    fn detect(&self, def: &TweakDef) -> (usize, bool) {
        let (mut applicable, mut all) = (0, true);
        for op in &def.ops {
            match op {
                Op::Registry { hive, path, name, value } => {
                    applicable += 1;
                    if self.sys.reg_get(*hive, path, name).ok().flatten().as_ref() != Some(value) {
                        all = false;
                    }
                }
                Op::Service { name, start, .. } => match self.sys.svc_get(name) {
                    Ok(Some(st)) => {
                        applicable += 1;
                        if st.start != *start {
                            all = false;
                        }
                    }
                    // ไม่มีบริการนี้ในเครื่อง (เช่น Hyper-V guest บนเครื่องจริง) → ข้าม op นี้
                    Ok(None) => {}
                    Err(_) => {
                        applicable += 1;
                        all = false;
                    }
                },
            }
        }
        (applicable, applicable > 0 && all)
    }

    fn has_active_change(&self, tweak_id: &str) -> bool {
        self.store
            .with_conn(|c| c.query_row("SELECT COUNT(*) FROM tweak_changes WHERE tweak_id = ?1 AND state = 'applied'", params![tweak_id], |r| r.get::<_, i64>(0)))
            .map(|n| n > 0)
            .unwrap_or(false)
    }

    pub fn status(&self) -> Status {
        let tweaks = self
            .defs
            .iter()
            .map(|d| {
                let (applicable, matches) = self.detect(d);
                let ours = self.has_active_change(&d.id);
                let state = if applicable == 0 {
                    "unavailable"
                } else {
                    match (matches, ours) {
                        (true, true) => "on",
                        (true, false) => "external",
                        (false, true) => "drifted",
                        (false, false) => "off",
                    }
                };
                TweakStatus { id: d.id.clone(), state }
            })
            .collect();
        Status { elevated: self.sys.is_elevated(), tweaks }
    }

    /// ใช้ tweak ที่เลือก (เฉพาะที่ยังไม่ตั้งอยู่) — `profile` ใช้บันทึกในประวัติเท่านั้น
    pub fn apply(&self, ids: &[String], profile: &str) -> io::Result<ApplyResult> {
        let mut result = ApplyResult { restore_point: "skipped", ..Default::default() };
        let mut todo: Vec<&TweakDef> = Vec::new();
        for id in ids {
            let def = self.def(id)?;
            let (applicable, matches) = self.detect(def);
            if matches {
                result.skipped.push(id.clone());
            } else if applicable == 0 {
                result.failed.push(Failure { id: id.clone(), reason: "unavailable".into() });
            } else if def.requires_admin() && !self.sys.is_elevated() {
                result.failed.push(Failure { id: id.clone(), reason: "needs_admin".into() });
            } else {
                todo.push(def);
            }
        }
        if todo.is_empty() {
            return Ok(result);
        }

        // จุดคืนค่าของ Windows: ทำเมื่อเป็นผู้ดูแลและมี tweak ระดับเครื่อง (HKLM/บริการ) — ล้มเหลวไม่ขวางงาน เพราะเรามีค่าเดิมเก็บเองอยู่แล้ว
        if self.sys.is_elevated() && todo.iter().any(|d| d.requires_admin()) {
            result.restore_point = if self.sys.create_restore_point("WeakClean — before applying tweaks").is_ok() { "created" } else { "failed" };
        }

        let event_id = self.store.add_event("boost", &json!({ "profile": profile, "restorePoint": result.restore_point }))?;
        for def in todo {
            match self.apply_one(def) {
                Ok((priors, diffs)) => {
                    let (p, d) = (serde_json::to_string(&priors).unwrap(), serde_json::to_string(&diffs).unwrap());
                    self.store
                        .with_conn(|c| c.execute("INSERT INTO tweak_changes(event_id, tweak_id, ts, priors, diffs) VALUES (?1, ?2, ?3, ?4, ?5)", params![event_id, def.id, now(), p, d]))
                        .map_err(db_err)?;
                    result.applied.push(def.id.clone());
                }
                Err(reason) => result.failed.push(Failure { id: def.id.clone(), reason }),
            }
        }

        if result.applied.is_empty() {
            self.store.delete_event(event_id)?;
        } else {
            self.store.update_event(event_id, Some(&json!({ "profile": profile, "restorePoint": result.restore_point, "tweaks": result.applied, "failed": result.failed.len() })), None)?;
            result.event_id = Some(event_id);
        }
        Ok(result)
    }

    /// ใช้ tweak หนึ่งตัวแบบ transaction — Err(เหตุผล) เมื่อไม่สำเร็จ และระบบจะกลับเป็นเหมือนก่อนเริ่มแล้ว
    fn apply_one(&self, def: &TweakDef) -> Result<(Vec<Prior>, Vec<String>), String> {
        let mut priors: Vec<Prior> = Vec::new();
        let mut diffs: Vec<String> = Vec::new();
        let mut done: Vec<Prior> = Vec::new();

        // 1) บันทึกค่าเดิมทั้งหมดก่อนเขียนอะไร — อ่านไม่ได้ = ไม่แตะ tweak นี้เลย
        for op in &def.ops {
            match op {
                Op::Registry { hive, path, name, value } => {
                    let before = self.sys.reg_get(*hive, path, name).map_err(|e| e.to_string())?;
                    let created_keys = self.missing_keys(*hive, path);
                    diffs.push(format!("{}: {} → {}", if name.is_empty() { "(Default)" } else { name }, before.as_ref().map_or("(not set)".to_string(), RegData::show), value.show()));
                    priors.push(Prior::Reg { hive: *hive, path: path.clone(), name: name.clone(), before, created_keys });
                }
                Op::Service { name, start, stop } => {
                    let Some(before) = self.sys.svc_get(name).map_err(|e| e.to_string())? else { continue };
                    diffs.push(format!("{name}: {} → {}", before.start.label(), start.label()));
                    priors.push(Prior::Svc { name: name.clone(), before, stopped: *stop && before.running });
                }
            }
        }

        // 2) เขียนทีละ op ล้มเหลวเมื่อไหร่ ย้อนที่ทำไปแล้วทั้งหมด
        let mut pi = priors.iter();
        for op in &def.ops {
            let res: io::Result<()> = match op {
                Op::Registry { hive, path, name, value } => {
                    let p = pi.next().expect("prior per registry op");
                    done.push(p.clone());
                    self.sys.reg_set(*hive, path, name, value)
                }
                Op::Service { name, start, stop } => {
                    if !matches!(self.sys.svc_get(name), Ok(Some(_))) {
                        continue;
                    }
                    let p = pi.next().expect("prior per service op");
                    done.push(p.clone());
                    self.sys.svc_set_start(name, *start).map(|_| {
                        if *stop {
                            let _ = self.sys.svc_stop(name); // หยุดไม่ได้ไม่เป็นไร จะมีผลตอนบูตครั้งหน้า
                        }
                    })
                }
            };
            if let Err(e) = res {
                self.rollback(&done);
                return Err(e.to_string());
            }
        }

        // 3) อ่านกลับมายืนยัน — ถ้า Windows/นโยบายไม่ยอมรับค่า ต้องไม่ทิ้งสถานะครึ่งๆ กลางๆ
        if !self.detect(def).1 {
            self.rollback(&done);
            return Err("verify_failed".into());
        }
        Ok((priors, diffs))
    }

    /// path ที่ยังไม่มีอยู่ (ตื้น→ลึก) — เราจะเป็นคนสร้าง จึงต้องลบทิ้งตอนย้อนกลับ
    fn missing_keys(&self, hive: Hive, path: &str) -> Vec<String> {
        let mut acc = String::new();
        let mut missing = Vec::new();
        for seg in path.split('\\').filter(|s| !s.is_empty()) {
            if !acc.is_empty() {
                acc.push('\\');
            }
            acc.push_str(seg);
            if missing.is_empty() && self.sys.reg_key_exists(hive, &acc) {
                continue;
            }
            missing.push(acc.clone());
        }
        missing
    }

    fn rollback(&self, priors: &[Prior]) {
        for p in priors.iter().rev() {
            let _ = self.restore_prior(p);
        }
    }

    fn restore_prior(&self, prior: &Prior) -> io::Result<()> {
        match prior {
            Prior::Reg { hive, path, name, before, created_keys } => {
                match before {
                    Some(data) => self.sys.reg_set(*hive, path, name, data)?,
                    None => {
                        self.sys.reg_delete_value(*hive, path, name)?;
                        // key ที่เราสร้างขึ้นเอง ลบทิ้งจากในสุดออกมา (ลบได้เฉพาะที่ว่าง ถ้ามีคนเพิ่มของไว้จะไม่แตะ)
                        for key in created_keys.iter().rev() {
                            let _ = self.sys.reg_delete_key(*hive, key);
                        }
                    }
                }
                Ok(())
            }
            Prior::Svc { name, before, stopped } => {
                self.sys.svc_set_start(name, before.start)?;
                if *stopped {
                    let _ = self.sys.svc_start(name);
                }
                Ok(())
            }
        }
    }

    fn load_change(&self, id: i64) -> io::Result<Option<(i64, String, String, String)>> {
        self.store
            .with_conn(|c| c.query_row("SELECT event_id, tweak_id, priors, state FROM tweak_changes WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional())
            .map_err(db_err)
    }

    /// ย้อน tweak หนึ่งรายการกลับเป็นค่าเดิม
    pub fn revert_change(&self, change_id: i64) -> io::Result<RevertResult> {
        let Some((event_id, tweak_id, priors, state)) = self.load_change(change_id)? else {
            return Err(io::Error::new(io::ErrorKind::NotFound, "change not found"));
        };
        let mut res = RevertResult::default();
        if state != "applied" {
            return Ok(res);
        }
        let priors: Vec<Prior> = serde_json::from_str(&priors).map_err(io::Error::other)?;
        let admin_needed = self.defs.iter().find(|d| d.id == tweak_id).is_some_and(|d| d.requires_admin());
        if admin_needed && !self.sys.is_elevated() {
            res.failed.push(Failure { id: tweak_id, reason: "needs_admin".into() });
            return Ok(res);
        }
        let mut errors = Vec::new();
        for p in priors.iter().rev() {
            if let Err(e) = self.restore_prior(p) {
                errors.push(e.to_string());
            }
        }
        if errors.is_empty() {
            self.store.with_conn(|c| c.execute("UPDATE tweak_changes SET state = 'reverted' WHERE id = ?1", params![change_id])).map_err(db_err)?;
            res.reverted = 1;
        } else {
            res.failed.push(Failure { id: tweak_id, reason: errors.join("; ") });
        }
        self.refresh_event_state(event_id)?;
        Ok(res)
    }

    fn refresh_event_state(&self, event_id: i64) -> io::Result<()> {
        let (total, applied): (i64, i64) = self
            .store
            .with_conn(|c| c.query_row("SELECT COUNT(*), COALESCE(SUM(state = 'applied'), 0) FROM tweak_changes WHERE event_id = ?1", params![event_id], |r| Ok((r.get(0)?, r.get(1)?))))
            .map_err(db_err)?;
        let state = if total == 0 || applied == total { "active" } else if applied == 0 { "undone" } else { "partial" };
        self.store.update_event(event_id, None, Some(state))
    }

    fn revert_where(&self, sql: &str, arg: Option<i64>) -> io::Result<RevertResult> {
        let ids: Vec<i64> = self
            .store
            .with_conn(|c| {
                let mut q = c.prepare(sql)?;
                let rows = match arg {
                    Some(a) => q.query_map(params![a], |r| r.get(0))?.collect::<Result<Vec<i64>, _>>(),
                    None => q.query_map([], |r| r.get(0))?.collect::<Result<Vec<i64>, _>>(),
                };
                rows
            })
            .map_err(db_err)?;
        let mut total = RevertResult::default();
        for id in ids {
            let r = self.revert_change(id)?;
            total.reverted += r.reverted;
            total.failed.extend(r.failed);
        }
        Ok(total)
    }

    /// ย้อนทั้งชุด (ตามรายการในประวัติ)
    pub fn revert_event(&self, event_id: i64) -> io::Result<RevertResult> {
        self.revert_where("SELECT id FROM tweak_changes WHERE event_id = ?1 AND state = 'applied' ORDER BY id DESC", Some(event_id))
    }

    /// ย้อนทุกอย่างที่ WeakClean เคยปรับแต่ง (ใหม่สุดก่อน)
    pub fn revert_all(&self) -> io::Result<RevertResult> {
        self.revert_where("SELECT id FROM tweak_changes WHERE state = 'applied' ORDER BY id DESC", None)
    }

    pub fn changes(&self, limit: usize) -> io::Result<Vec<ChangeRow>> {
        self.store
            .with_conn(|c| {
                let mut q = c.prepare("SELECT id, event_id, tweak_id, ts, state, diffs FROM tweak_changes ORDER BY id DESC LIMIT ?1")?;
                let rows = q.query_map(params![limit as i64], |r| {
                    let diffs: String = r.get(5)?;
                    Ok(ChangeRow { id: r.get(0)?, event_id: r.get(1)?, tweak_id: r.get(2)?, ts: r.get(3)?, state: r.get(4)?, diffs: serde_json::from_str(&diffs).unwrap_or_default() })
                })?;
                rows.collect::<Result<Vec<_>, _>>()
            })
            .map_err(db_err)
    }
}

#[cfg(test)]
mod tests;

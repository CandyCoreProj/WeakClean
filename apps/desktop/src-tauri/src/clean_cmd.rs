//! คำสั่ง Tauri ของ cleaner + safety center (crates/weakclean-cleaner)
//!
//! ทุกคำสั่งที่แตะดิสก์จริงรันบน thread แยก (spawn_blocking) เพื่อไม่ให้หน้าจอค้าง

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use weakclean_cleaner::{
    builtin_catalog, CategoryDef, CleanProgress, CleanResult, RestoreResult, Store,
};
use weakclean_cleaner::{scan_sizes, CategorySize, PreviewFile};

const EVENT_PROGRESS: &str = "cleaner://progress";

pub struct Cleaner {
    pub store: Arc<Store>,
    pub defs: Vec<CategoryDef>,
    pub busy: AtomicBool,
}

pub type CleanerState = Arc<Cleaner>;

/// โฟลเดอร์ข้อมูลของ WeakClean (%LOCALAPPDATA%\WeakClean) — ที่เก็บฐานข้อมูล ที่กักกัน และไฟล์ล็อกกันเปิดซ้อน
pub fn data_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("WeakClean")
}

/// เปิดฐานข้อมูล/ที่กักกันที่ %LOCALAPPDATA%\WeakClean แล้วลบถาวรเฉพาะชุดที่หมดอายุ
pub fn init() -> Result<CleanerState, String> {
    let base = data_dir();
    let store = Arc::new(Store::open(&base).map_err(|e| format!("cannot open {}: {e}", base.display()))?);
    let cleaner = Arc::new(Cleaner { store, defs: builtin_catalog(), busy: AtomicBool::new(false) });

    let c = cleaner.clone();
    std::thread::spawn(move || {
        let _ = c.store.purge_expired(c.store.retention_days());
    });
    Ok(cleaner)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryMeta {
    id: String,
    group: &'static str,
    default_on: bool,
    name_th: String,
    name_en: String,
    desc_th: String,
    desc_en: String,
    requires_admin: bool,
}

#[tauri::command]
pub fn cleaner_catalog(state: State<'_, CleanerState>) -> Vec<CategoryMeta> {
    state
        .defs
        .iter()
        .map(|d| CategoryMeta {
            id: d.id.clone(),
            group: d.group.as_str(),
            default_on: d.default_on,
            name_th: d.name_th.clone(),
            name_en: d.name_en.clone(),
            desc_th: d.desc_th.clone(),
            desc_en: d.desc_en.clone(),
            requires_admin: d.requires_admin,
        })
        .collect()
}

/// วัดขนาดของทุกหมวด (อ่านอย่างเดียว)
#[tauri::command]
pub async fn cleaner_scan(state: State<'_, CleanerState>) -> Result<Vec<CategorySize>, String> {
    let c = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || scan_sizes(&c.defs)).await.map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    files: Vec<PreviewFile>,
    total: u64,
}

/// ไฟล์ใหญ่สุดในหมวด ไว้เปิดดูก่อนล้าง
#[tauri::command]
pub async fn cleaner_files(state: State<'_, CleanerState>, id: String, limit: usize) -> Result<Preview, String> {
    let c = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let def = c.defs.iter().find(|d| d.id == id).ok_or("unknown category")?;
        let (files, total) = weakclean_cleaner::preview(def, limit.clamp(1, 200));
        Ok(Preview { files, total })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// ย้ายไฟล์ของหมวดที่เลือกเข้าที่กักกัน (ไม่ลบถาวร) — ความคืบหน้าส่งทาง event `cleaner://progress`
#[tauri::command]
pub async fn cleaner_clean(app: AppHandle, state: State<'_, CleanerState>, ids: Vec<String>) -> Result<CleanResult, String> {
    let c = state.inner().clone();
    if c.busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Err("a clean is already running".into());
    }
    let out = tauri::async_runtime::spawn_blocking(move || {
        let defs: Vec<&CategoryDef> = ids.iter().filter_map(|id| c.defs.iter().find(|d| &d.id == id)).collect();
        if defs.len() != ids.len() {
            return Err("unknown category".to_string());
        }
        let emit = |p: CleanProgress| {
            let _ = app.emit(EVENT_PROGRESS, p);
        };
        let r = c.store.clean(&defs, &emit).map_err(|e| e.to_string());
        c.busy.store(false, Ordering::Release);
        r
    })
    .await
    .map_err(|e| e.to_string())?;
    out
}

#[tauri::command]
pub async fn safety_restore(state: State<'_, CleanerState>, event_id: i64) -> Result<RestoreResult, String> {
    let c = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || c.store.restore(event_id).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/* ───────── ขอสิทธิ์ผู้ดูแลครั้งเดียวแล้วล้างต่อ ───────── */

/// คีย์จำหมวดที่จะล้างต่อ หลังเปิดแอปใหม่แบบผู้ดูแล (อยู่ไม่กี่วินาทีระหว่างปิด-เปิด)
const PENDING_CLEAN: &str = "pending_clean";
/// ยอมรับรายการค้างได้นานสุดกี่วินาที — นานกว่านี้ถือว่าไม่เกี่ยวกับการขอสิทธิ์รอบนั้นแล้ว
const PENDING_CLEAN_MAX_AGE: i64 = 300;

fn unix_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// จำหมวดที่ผู้ใช้ยืนยันไว้ ก่อนขอสิทธิ์ผู้ดูแล (UAC) แล้วเปิดแอปใหม่
#[tauri::command]
pub fn cleaner_pending_set(state: State<'_, CleanerState>, ids: Vec<String>) -> Result<(), String> {
    let payload = format!("{}:{}", unix_now(), ids.join(","));
    state.store.set_setting(PENDING_CLEAN, &payload).map_err(|e| e.to_string())
}

/// อ่านหมวดที่ค้างไว้แล้วลบทิ้งทันที — คืน [] ถ้าไม่มี หรือค้างนานเกิน 5 นาที (กันเผลอล้างเองภายหลัง)
#[tauri::command]
pub fn cleaner_pending_take(state: State<'_, CleanerState>) -> Vec<String> {
    let Some(raw) = state.store.setting(PENDING_CLEAN) else { return Vec::new() };
    let _ = state.store.set_setting(PENDING_CLEAN, "");
    parse_pending(&raw, unix_now())
}

/// แยกรายการที่จำไว้รูปแบบ `ts:id1,id2` — หมดอายุแล้วคืน [] (ผู้ใช้อาจไม่เคยกดยืนยันในรอบนั้นจริง)
fn parse_pending(raw: &str, now: i64) -> Vec<String> {
    let Some((ts, ids)) = raw.split_once(':') else { return Vec::new() };
    if now - ts.parse::<i64>().unwrap_or(0) > PENDING_CLEAN_MAX_AGE {
        return Vec::new();
    }
    ids.split(',').filter(|s| !s.is_empty()).map(str::to_string).collect()
}

#[cfg(test)]
mod tests {
    use super::parse_pending;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn now() -> i64 {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64
    }

    #[test]
    fn pending_clean_only_survives_a_fresh_relaunch() {
        let t = now();
        assert_eq!(parse_pending(&format!("{t}:temp,wu"), t), vec!["temp", "wu"]);
        // ค้างนานเกิน 5 นาที = ไม่ใช่การขอสิทธิ์รอบนั้นแล้ว ต้องไม่ล้างเอง
        assert!(parse_pending(&format!("{}:temp", t - 400), t).is_empty());
        // ไม่มีรายการ / ค่าที่จำไว้ถูกล้างแล้ว
        assert!(parse_pending(&format!("{t}:"), t).is_empty());
        assert!(parse_pending("", t).is_empty());
        assert!(parse_pending("garbage", t).is_empty());
    }
}

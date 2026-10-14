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

/// เปิดฐานข้อมูล/ที่กักกันที่ %LOCALAPPDATA%\WeakClean แล้วลบถาวรเฉพาะชุดที่หมดอายุ
pub fn init() -> Result<CleanerState, String> {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("WeakClean");
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

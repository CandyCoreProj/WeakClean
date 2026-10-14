//! คำสั่ง Tauri ของ Boost (crates/weakclean-tweaks) และภาพรวมของ ประวัติ & กู้คืน ที่รวมทั้งขยะและการปรับแต่ง

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};
use weakclean_cleaner::{EventRow, QuarantineSummary, RestoreResult};
use weakclean_tweaks::{builtin_catalog, ApplyResult, ChangeRow, Engine, RevertResult, Status, TweakMeta, WinSystem};

use crate::clean_cmd::CleanerState;

pub type BoostState = Arc<Engine>;

pub fn init(cleaner: &CleanerState) -> Result<BoostState, String> {
    let engine = Engine::new(Box::new(WinSystem), cleaner.store.clone(), builtin_catalog()).map_err(|e| e.to_string())?;
    Ok(Arc::new(engine))
}

#[tauri::command]
pub fn boost_catalog(state: State<'_, BoostState>) -> Vec<TweakMeta> {
    state.catalog()
}

/// สถานะปัจจุบันของทุก tweak (อ่านจาก registry/services จริง ไม่แก้ไขอะไร)
#[tauri::command]
pub async fn boost_status(state: State<'_, BoostState>) -> Result<Status, String> {
    let e = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || e.status()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn boost_apply(state: State<'_, BoostState>, ids: Vec<String>, profile: String) -> Result<ApplyResult, String> {
    let e = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || e.apply(&ids, &profile).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn boost_revert_change(state: State<'_, BoostState>, change_id: i64) -> Result<RevertResult, String> {
    let e = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || e.revert_change(change_id).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn boost_revert_event(state: State<'_, BoostState>, event_id: i64) -> Result<RevertResult, String> {
    let e = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || e.revert_event(event_id).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// เปิดแอปใหม่ด้วยสิทธิ์ผู้ดูแล (ขึ้นหน้าต่าง UAC) แล้วปิดตัวเดิม — ถ้าผู้ใช้กดไม่อนุญาตจะคืน Err และตัวเดิมยังอยู่
#[tauri::command]
pub fn boost_relaunch_admin(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
        let r = unsafe { ShellExecuteW(std::ptr::null_mut(), wide("runas").as_ptr(), wide(&exe.to_string_lossy()).as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) };
        // ค่า > 32 = สำเร็จ ส่วนน้อยกว่านั้นคือรหัสผิดพลาด (รวมถึงกด "ไม่" ใน UAC)
        if (r as isize) <= 32 {
            return Err("cancelled".into());
        }
        app.exit(0);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("only supported on Windows".into())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafetyOverview {
    events: Vec<EventRow>,
    quarantine: QuarantineSummary,
    /// รายการปรับแต่งย่อยของทุกชุด (ผูกกับ event ด้วย eventId)
    changes: Vec<ChangeRow>,
}

#[tauri::command]
pub async fn safety_overview(cleaner: State<'_, CleanerState>, boost: State<'_, BoostState>) -> Result<SafetyOverview, String> {
    let (c, b) = (cleaner.inner().clone(), boost.inner().clone());
    tauri::async_runtime::spawn_blocking(move || {
        Ok(SafetyOverview {
            events: c.store.events(200).map_err(|e| e.to_string())?,
            quarantine: c.store.quarantine_summary(c.store.retention_days()).map_err(|e| e.to_string())?,
            changes: b.changes(1000).map_err(|e| e.to_string())?,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoAll {
    restore: RestoreResult,
    revert: RevertResult,
}

/// "คืนค่าทุกอย่างที่ WeakClean เคยทำ": กู้ไฟล์ทุกชุดจากที่กักกัน + ย้อนทุกการปรับแต่ง
#[tauri::command]
pub async fn safety_undo_all(cleaner: State<'_, CleanerState>, boost: State<'_, BoostState>) -> Result<UndoAll, String> {
    let (c, b) = (cleaner.inner().clone(), boost.inner().clone());
    tauri::async_runtime::spawn_blocking(move || {
        let mut restore = RestoreResult::default();
        for id in c.store.restorable_events().map_err(|e| e.to_string())? {
            let r = c.store.restore(id).map_err(|e| e.to_string())?;
            restore.restored_files += r.restored_files;
            restore.restored_bytes += r.restored_bytes;
            restore.conflicts += r.conflicts;
            restore.failed += r.failed;
        }
        let revert = b.revert_all().map_err(|e| e.to_string())?;
        Ok(UndoAll { restore, revert })
    })
    .await
    .map_err(|e| e.to_string())?
}

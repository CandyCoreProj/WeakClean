//! หน้า ตั้งค่า: จำนวนวันที่กักกัน, ล้างที่กักกัน, ตำแหน่งข้อมูลของโปรแกรม

use serde::Serialize;
use tauri::State;

use crate::clean_cmd::CleanerState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    retention_days: u64,
    /// โฟลเดอร์ที่เก็บฐานข้อมูลและที่กักกัน
    data_dir: String,
    quarantine_files: u64,
    quarantine_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Purged {
    files: u64,
    bytes: u64,
}

fn read(c: &CleanerState) -> Result<Settings, String> {
    let days = c.store.retention_days();
    let q = c.store.quarantine_summary(days).map_err(|e| e.to_string())?;
    Ok(Settings { retention_days: days, data_dir: c.store.base_dir().to_string_lossy().into_owned(), quarantine_files: q.files, quarantine_bytes: q.bytes })
}

#[tauri::command]
pub async fn settings_get(state: State<'_, CleanerState>) -> Result<Settings, String> {
    let c = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || read(&c)).await.map_err(|e| e.to_string())?
}

/// ตั้งจำนวนวันที่เก็บไฟล์ในที่กักกัน (1–365) — ชุดที่เก่ากว่าค่าใหม่จะถูกลบถาวรทันที
#[tauri::command]
pub async fn settings_set_retention(state: State<'_, CleanerState>, days: u64) -> Result<Purged, String> {
    let c = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (files, bytes) = c.store.set_retention_days(days).map_err(|e| e.to_string())?;
        Ok(Purged { files, bytes })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// ลบถาวรทุกอย่างในที่กักกัน (กู้คืนไม่ได้อีก)
#[tauri::command]
pub async fn quarantine_purge_all(state: State<'_, CleanerState>) -> Result<Purged, String> {
    let c = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (files, bytes) = c.store.purge_all().map_err(|e| e.to_string())?;
        Ok(Purged { files, bytes })
    })
    .await
    .map_err(|e| e.to_string())?
}

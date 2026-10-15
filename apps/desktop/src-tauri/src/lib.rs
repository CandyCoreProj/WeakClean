//! WeakClean — Rust core
//!
//! Phase 0: เปิดหน้าต่าง + คำสั่งทดสอบสะพาน React ↔ Rust
//! Phase 1: scanner (crates/weakclean-scanner) ผ่านคำสั่งใน scan_cmd
//! Phase 3: cleaner + safety (crates/weakclean-cleaner) ผ่านคำสั่งใน clean_cmd
//! Phase 4: tweaks / Boost (crates/weakclean-tweaks) ผ่านคำสั่งใน boost_cmd

use serde::Serialize;

mod background;
mod boost_cmd;
mod clean_cmd;
mod extra_cmd;
mod scan_cmd;
mod settings_cmd;
mod sysinfo_cmd;

#[derive(Serialize)]
pub struct AppInfo {
    version: &'static str,
    os: &'static str,
    arch: &'static str,
}

/// คำสั่งทดสอบว่าฝั่ง React เรียก Rust ได้ (ใช้แสดงเวอร์ชันมุมล่างของเมนู)
#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // เปิดซ้อน = ไม่เปิดโปรแกรมที่สอง แต่เรียกหน้าต่างของตัวที่เปิดอยู่ขึ้นมา
    // (ไฟล์ล็อกถูกจองไว้จนโปรเซสจบ จึงไม่ต้องปลดเอง)
    #[cfg(windows)]
    match background::claim_single_instance(&clean_cmd::data_dir()) {
        Some(lock) => std::mem::forget(lock),
        None => {
            background::focus_existing();
            return;
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(scan_cmd::ScanState::default())
        .manage(extra_cmd::ExtraState::default())
        .setup(|app| {
            use tauri::Manager;
            let cleaner = clean_cmd::init()?;
            app.manage(boost_cmd::init(&cleaner)?);
            // ไอคอนถาด + รอบเตือน ต้องมี state ของ cleaner ก่อนจึงส่งเข้าไปได้
            background::setup(app.handle(), &cleaner)?;
            app.manage(cleaner);
            // เปิดจาก Start Menu = โชว์หน้าต่าง ส่วนเปิดพร้อม Windows (--background) = อยู่ในถาดเงียบๆ
            if !background::launched_in_background() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            scan_cmd::list_drives,
            scan_cmd::start_scan,
            scan_cmd::cancel_scan,
            scan_cmd::scan_children,
            scan_cmd::scan_overview,
            scan_cmd::reveal_in_explorer,
            sysinfo_cmd::system_info,
            settings_cmd::settings_get,
            settings_cmd::settings_set_retention,
            settings_cmd::quarantine_purge_all,
            extra_cmd::scan_old_files,
            extra_cmd::dupes_start,
            extra_cmd::dupes_cancel,
            extra_cmd::dupes_result,
            extra_cmd::quarantine_listed,
            extra_cmd::quarantine_scan_paths,
            extra_cmd::scan_history,
            clean_cmd::cleaner_catalog,
            clean_cmd::cleaner_scan,
            clean_cmd::cleaner_files,
            clean_cmd::cleaner_clean,
            boost_cmd::safety_overview,
            boost_cmd::safety_undo_all,
            boost_cmd::boost_catalog,
            boost_cmd::boost_status,
            boost_cmd::boost_apply,
            boost_cmd::boost_revert_change,
            boost_cmd::boost_revert_event,
            boost_cmd::boost_relaunch_admin,
            clean_cmd::safety_restore,
            clean_cmd::cleaner_pending_set,
            clean_cmd::cleaner_pending_take,
            background::background_status,
            background::background_set_autostart,
            background::background_set_remind,
            background::background_remind_now,
            background::background_lang,
            background::reminder_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running WeakClean");
}

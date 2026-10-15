//! ตัวช่วยเบื้องหลัง: เปิดพร้อม Windows, ไอคอนในถาดระบบ และการเตือนล้างขยะทุกรอบ
//!
//! หลักการเดียวกับทั้งโปรแกรม: ตัวช่วยนี้ไม่ลบอะไรเอง มันแค่ขึ้นการ์ดเตือนแล้วพาไปหน้า ล้างขยะ
//! ให้ผู้ใช้กดยืนยันเอง (การล้างจริงยังต้องกดในแอป และไฟล์ยังถูกย้ายเข้าที่กักกันเหมือนเดิม)

use std::path::Path;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::clean_cmd::CleanerState;

/// รอบการเตือน (วัน) นับจากครั้งล่าสุดที่ล้างขยะสำเร็จ หรือจากครั้งล่าสุดที่เตือนไปแล้ว
const REMIND_DAYS: i64 = 7;
/// ตรวจทุกครึ่งชั่วโมงก็เกินพอสำหรับรอบ 7 วัน
const CHECK_EVERY: Duration = Duration::from_secs(1_800);
/// label ของหน้าต่างเตือน — frontend ใช้ label นี้แยกว่าจะวาดการ์ดเตือนหรือตัวโปรแกรม
pub const REMINDER_WINDOW: &str = "reminder";
/// event ที่สั่งให้หน้าต่างหลักพาไปหน้า ล้างขยะ
const EVENT_CLEAN: &str = "reminder://clean";
/// คีย์ในตาราง settings ของ WeakClean
const KEY_ENABLED: &str = "remind_enabled";
const KEY_LAST: &str = "reminder_last_ts";
const KEY_AUTOSTART_DONE: &str = "autostart_setup";
/// ที่อยู่ของรายการ "เปิดพร้อม Windows" (ของผู้ใช้เอง ไม่ต้องใช้สิทธิ์ผู้ดูแล)
/// ต้องมีชื่อ hive นำหน้า เพราะ reg.exe ไม่รับ path แบบย่อ
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "WeakClean";
/// CREATE_NO_WINDOW — รัน reg.exe แล้วไม่ให้หน้าต่างดำแวบขึ้นมา
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// เวลาที่ควรเตือนครั้งถัดไป — นับจากเหตุการณ์ล่าสุด (ล้างขยะ หรือ เตือนครั้งก่อน) บวก `days` วัน
///
/// ยังไม่เคยล้างและยังไม่เคยเตือน (ติดตั้งใหม่) = เริ่มนับจากตอนนี้ ไม่เตือนทันทีที่เปิดครั้งแรก
fn next_reminder(last_clean: Option<i64>, last_reminder: Option<i64>, days: i64, now: i64) -> i64 {
    let from = match (last_clean, last_reminder) {
        (Some(clean), Some(reminded)) => clean.max(reminded),
        (Some(clean), None) => clean,
        (None, Some(reminded)) => reminded,
        (None, None) => now,
    };
    from + days * 86_400
}

/* ───────── เปิดพร้อม Windows ───────── */

/// คำสั่งที่ Windows จะรันตอนผู้ใช้ล็อกอิน — เปิดแบบเบื้องหลัง ไม่ต้องโชว์หน้าต่าง
fn autostart_command() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    Some(format!("\"{}\" --background", exe.display()))
}

fn reg(args: &[&str]) -> std::io::Result<std::process::Output> {
    let mut cmd = Command::new("reg");
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.output()
}

/// เปิด/ปิดการเปิดพร้อม Windows — เขียนลง HKCU ของผู้ใช้เอง จึงไม่ต้องยกระดับสิทธิ์
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let _ = enabled;
        return Err("only supported on Windows".into());
    }
    #[cfg(windows)]
    {
        // ในโหมดพัฒนา path คือไฟล์ build ชั่วคราว เปิดพร้อม Windows แล้วจะได้หน้าต่างเปล่าตอนบูต
        if cfg!(debug_assertions) {
            return Err("โหมดพัฒนา: การเปิดพร้อม Windows จะทำงานในเวอร์ชันที่ติดตั้งแล้ว".into());
        }
        let out = if enabled {
            let Some(command) = autostart_command() else { return Err("หา path ของโปรแกรมไม่เจอ".into()) };
            reg(&["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", &command, "/f"])
        } else {
            reg(&["delete", RUN_KEY, "/v", RUN_VALUE, "/f"])
        };
        match out {
            Ok(o) if o.status.success() => Ok(()),
            // ปิดตอนที่ยังไม่มีรายการอยู่ = สำเร็จอยู่แล้ว
            Ok(_) if !enabled => Ok(()),
            Ok(o) => Err(String::from_utf8_lossy(&o.stderr).trim().to_string()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// เปิดพร้อม Windows อยู่ไหม — ถามจาก registry ตรงๆ ไม่ได้เดาจากค่าที่เราจำไว้
pub fn autostart_enabled() -> bool {
    #[cfg(windows)]
    {
        reg(&["query", RUN_KEY, "/v", RUN_VALUE]).map(|o| o.status.success()).unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// เปิดใช้ครั้งแรกของแอปที่ติดตั้งจริง: ลงทะเบียนเปิดพร้อม Windows ให้เลย (ปิดได้ในหน้าตั้งค่า)
///
/// โหมด dev ข้ามไป เพราะ path ของ build ชั่วคราวไม่ควรถูกเขียนลง startup ของเครื่อง
pub fn init_autostart_default(cleaner: &CleanerState) {
    if cfg!(debug_assertions) || cleaner.store.setting(KEY_AUTOSTART_DONE).is_some() {
        return;
    }
    if set_autostart(true).is_ok() {
        let _ = cleaner.store.set_setting(KEY_AUTOSTART_DONE, "1");
    }
}

/* ───────── กันเปิดโปรแกรมซ้อน ───────── */

/// จองไฟล์ล็อกแบบไม่แชร์ให้ใคร — คืน None แปลว่ามีตัวอื่นเปิดอยู่แล้ว (โปรเซสจบแล้ว Windows ปลดให้เอง)
///
/// ตอนขอสิทธิ์ผู้ดูแลแล้วเปิดใหม่ ตัวเดิมกำลังปิดอยู่ จึงลองซ้ำสัก 3 วินาทีก่อนตัดสินว่าเป็นการเปิดซ้อน
pub fn claim_single_instance(dir: &Path) -> Option<std::fs::File> {
    for attempt in 0..12 {
        if let Some(file) = try_lock(dir) {
            return Some(file);
        }
        if attempt < 11 {
            std::thread::sleep(Duration::from_millis(250));
        }
    }
    None
}

fn try_lock(dir: &Path) -> Option<std::fs::File> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        std::fs::OpenOptions::new().create(true).write(true).share_mode(0).open(dir.join("weakclean.lock")).ok()
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
        None
    }
}

/// เปิดซ้อน: เรียกหน้าต่างของตัวที่เปิดอยู่ขึ้นมาแทนการเปิดโปรแกรมที่สอง
pub fn focus_existing() {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE};
        let title: Vec<u16> = "WeakClean\0".encode_utf16().collect();
        let hwnd = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
        if !hwnd.is_null() {
            unsafe {
                ShowWindow(hwnd, SW_RESTORE);
                SetForegroundWindow(hwnd);
            }
        }
    }
}

/* ───────── ตัวช่วยตอนเปิดโปรแกรม ───────── */

/// ตั้งค่าตัวช่วยเบื้องหลัง: ไอคอนถาด, ปิดหน้าต่าง = ซ่อนลงถาด และเริ่มรอบเตือน
pub fn setup(app: &AppHandle, cleaner: &CleanerState) -> tauri::Result<()> {
    // ไอคอนถาดใช้ไอคอนเดียวกับตัวโปรแกรม (ฝังมาในไฟล์ exe แล้ว จึงไม่ต้องโหลดรูปตอนรัน)
    if let Some(icon) = app.default_window_icon().cloned() {
        let menu = tray_menu(app, "th")?;
        TrayIconBuilder::with_id("main")
            .icon(icon)
            .tooltip("WeakClean")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "open" => show_main(app),
                "scan" => {
                    show_main(app);
                    let _ = app.emit_to("main", EVENT_CLEAN, ());
                }
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                    show_main(tray.app_handle());
                }
            })
            .build(app)?;
    }

    init_autostart_default(cleaner);

    // กดปิดหน้าต่าง = ซ่อนลงถาด (ตัวเตือนยังทำงานต่อ) ส่วน "ออกจากโปรแกรม" อยู่ที่เมนูถาด
    if let Some(window) = app.get_webview_window("main") {
        let w = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = w.hide();
            }
        });
    }

    start_reminder_loop(app.clone(), cleaner.clone());
    Ok(())
}

/// เปิดพร้อม Windows (มี `--background`) = อยู่แต่ในถาด ไม่ต้องโชว์หน้าต่าง
pub fn launched_in_background() -> bool {
    std::env::args().any(|arg| arg == "--background")
}

fn tray_menu(app: &AppHandle, lang: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let th = lang == "th";
    let open = MenuItem::with_id(app, "open", if th { "เปิด WeakClean" } else { "Open WeakClean" }, true, None::<&str>)?;
    let scan = MenuItem::with_id(app, "scan", if th { "สแกนไฟล์ขยะตอนนี้" } else { "Scan for junk now" }, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", if th { "ออกจากโปรแกรม" } else { "Quit WeakClean" }, true, None::<&str>)?;
    Menu::with_items(app, &[&open, &scan, &PredefinedMenuItem::separator(app)?, &quit])
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/* ───────── การ์ดเตือน ───────── */

/// แสดงการ์ดเตือนมุมขวาล่าง (สร้างหน้าต่างครั้งแรกแล้วใช้ซ้ำครั้งต่อๆ ไป)
fn show_reminder(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(REMINDER_WINDOW) {
        place_bottom_right(&window);
        let _ = window.show();
        return;
    }
    let built = WebviewWindowBuilder::new(app, REMINDER_WINDOW, WebviewUrl::App("index.html".into()))
        // ชื่อต่างจากหน้าต่างหลัก เพราะ focus_existing() ตามหาหน้าต่างหลักจากชื่อ "WeakClean"
        .title("WeakClean Reminder")
        .inner_size(392.0, 168.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .shadow(true)
        .build();
    if let Ok(window) = built {
        place_bottom_right(&window);
        let _ = window.show();
    }
}

/// วางมุมขวาล่างของจอที่หน้าต่างอยู่ เหนือแถบงานขึ้นมา
///
/// shortcut: ไม่ได้ถาม work area จริงของ Windows ระยะ 72 px จึงพอดีกับแถบงานมาตรฐาน
/// (จอที่ตั้งแถบงานใหญ่กว่านั้น การ์ดจะทับแถบงานเล็กน้อย ไม่มีผลกับการทำงาน)
fn place_bottom_right(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else { return };
    let Ok(size) = window.outer_size() else { return };
    let scale = monitor.scale_factor();
    let margin = (24.0 * scale) as i32;
    let above_taskbar = (72.0 * scale) as i32;
    let x = monitor.position().x + monitor.size().width as i32 - size.width as i32 - margin;
    let y = monitor.position().y + monitor.size().height as i32 - size.height as i32 - above_taskbar;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

fn remind_enabled(cleaner: &CleanerState) -> bool {
    cleaner.store.setting(KEY_ENABLED).map(|v| v != "0").unwrap_or(true)
}

fn last_reminder(cleaner: &CleanerState) -> Option<i64> {
    cleaner.store.setting(KEY_LAST).and_then(|v| v.parse().ok())
}

/// เธรดตรวจรอบเตือน: ตื่นทุกครึ่งชั่วโมง ถึงกำหนดแล้วขึ้นการ์ดหนึ่งครั้งต่อรอบ
fn start_reminder_loop(app: AppHandle, cleaner: CleanerState) {
    std::thread::spawn(move || loop {
        if remind_enabled(&cleaner) {
            let last_clean = cleaner.store.last_clean_ts();
            let last = last_reminder(&cleaner);
            if last_clean.is_none() && last.is_none() {
                // ติดตั้งใหม่: เริ่มนับจากวันนี้ ไม่เตือนทันที
                let _ = cleaner.store.set_setting(KEY_LAST, &now().to_string());
            } else if now() >= next_reminder(last_clean, last, REMIND_DAYS, now()) {
                let _ = cleaner.store.set_setting(KEY_LAST, &now().to_string());
                show_reminder(&app);
            }
        }
        std::thread::sleep(CHECK_EVERY);
    });
}

/* ───────── คำสั่งให้หน้าจอเรียก ───────── */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundStatus {
    autostart: bool,
    remind: bool,
    days: i64,
    last_clean_ts: Option<i64>,
    next_reminder_ts: i64,
}

#[tauri::command]
pub async fn background_status(cleaner: State<'_, CleanerState>) -> Result<BackgroundStatus, String> {
    let c = cleaner.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let last_clean = c.store.last_clean_ts();
        Ok(BackgroundStatus {
            autostart: autostart_enabled(),
            remind: remind_enabled(&c),
            days: REMIND_DAYS,
            last_clean_ts: last_clean,
            next_reminder_ts: next_reminder(last_clean, last_reminder(&c), REMIND_DAYS, now()),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn background_set_autostart(enabled: bool) -> Result<(), String> {
    set_autostart(enabled)
}

#[tauri::command]
pub fn background_set_remind(cleaner: State<'_, CleanerState>, enabled: bool) -> Result<(), String> {
    cleaner.store.set_setting(KEY_ENABLED, if enabled { "1" } else { "0" }).map_err(|e| e.to_string())
}

/// ปุ่ม "ลองเตือนเดี๋ยวนี้" ในหน้าตั้งค่า — เตือนเหมือนถึงกำหนดจริง แล้วเริ่มนับรอบใหม่
#[tauri::command]
pub fn background_remind_now(app: AppHandle, cleaner: State<'_, CleanerState>) -> Result<(), String> {
    cleaner.store.set_setting(KEY_LAST, &now().to_string()).map_err(|e| e.to_string())?;
    show_reminder(&app);
    Ok(())
}

/// ผู้ใช้กดบนการ์ดเตือน: `clean` = เปิดโปรแกรมไปหน้า ล้างขยะ, `later` = ปิดการ์ด
#[tauri::command]
pub fn reminder_action(app: AppHandle, action: String) {
    // เปิดหน้าต่างหลักก่อนซ่อนการ์ด เพื่อให้ยังถือสิทธิ์อยู่เบื้องหน้า (Windows จะไม่ให้โปรเซสที่เพิ่งเสีย focus ดึงหน้าต่างขึ้นมา)
    if action == "clean" {
        show_main(&app);
        let _ = app.emit_to("main", EVENT_CLEAN, ());
    }
    if let Some(window) = app.get_webview_window(REMINDER_WINDOW) {
        let _ = window.hide();
    }
}

/// ภาษาของเมนูในถาด — หน้าจอส่งมาให้ตอนเริ่มและตอนสลับภาษา
#[tauri::command]
pub fn background_lang(app: AppHandle, lang: String) {
    if let Some(tray) = app.tray_by_id("main") {
        if let Ok(menu) = tray_menu(&app, &lang) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{next_reminder, reg, RUN_KEY};
    use std::time::{SystemTime, UNIX_EPOCH};

    const DAY: i64 = 86_400;

    fn now() -> i64 {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64
    }

    #[test]
    fn fresh_install_starts_counting_today() {
        let t = now();
        assert_eq!(next_reminder(None, None, 7, t), t + 7 * DAY, "ติดตั้งใหม่ต้องไม่เตือนทันที");
    }

    #[test]
    fn cycle_counts_from_the_latest_of_clean_and_reminder() {
        let t = now();
        // ล้างไป 8 วันแล้ว = ถึงกำหนด
        assert!(next_reminder(Some(t - 8 * DAY), None, 7, t) <= t);
        // เพิ่งล้าง 3 วันก่อน แม้จะเตือนไป 8 วันก่อน ก็ยังไม่ถึงกำหนด
        assert!(next_reminder(Some(t - 3 * DAY), Some(t - 8 * DAY), 7, t) > t);
        // ล้าง 9 วันก่อน แต่เพิ่งเตือนเมื่อวาน = ไม่เตือนซ้ำ (กันรบกวน)
        assert!(next_reminder(Some(t - 9 * DAY), Some(t - DAY), 7, t) > t);
        // ยังไม่เคยล้าง แต่เตือนไป 7 วันแล้ว = ถึงกำหนดอีกครั้ง
        assert!(next_reminder(None, Some(t - 7 * DAY), 7, t) <= t);
    }

    /// path ของโปรแกรมที่ติดตั้งจริงมีช่องว่าง จึงต้องรู้ว่า reg.exe รับคำสั่งที่มีเครื่องหมายคำพูดได้จริง
    /// (เขียนชื่อทดสอบลง HKCU Run แล้วลบทิ้งทันที ไม่แตะรายการ WeakClean ของผู้ใช้)
    #[cfg(windows)]
    #[test]
    fn autostart_command_roundtrips_through_reg_exe() {
        let value = "WeakCleanSelfTest";
        let command = "\"C:\\Program Files\\WeakClean\\weakclean.exe\" --background";
        let added = reg(&["add", RUN_KEY, "/v", value, "/t", "REG_SZ", "/d", command, "/f"]).expect("reg add must run");
        assert!(added.status.success(), "reg add failed: {}", String::from_utf8_lossy(&added.stderr));
        let queried = reg(&["query", RUN_KEY, "/v", value]).expect("reg query must run");
        assert!(queried.status.success(), "the value must be readable back");
        assert!(String::from_utf8_lossy(&queried.stdout).contains("--background"), "the stored command must keep its argument");
        assert!(reg(&["delete", RUN_KEY, "/v", value, "/f"]).expect("reg delete must run").status.success(), "cleanup must succeed");
    }
}

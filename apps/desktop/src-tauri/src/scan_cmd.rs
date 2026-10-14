//! คำสั่ง Tauri ของ scanner — หน้าจอเริ่มสแกน ฟัง event ความคืบหน้า แล้วขอดูโฟลเดอร์ทีละระดับ
//!
//! tree ทั้งก้อนเก็บอยู่ฝั่ง Rust (หลักแสนโฟลเดอร์ ส่งผ่าน IPC ทีเดียวไม่ไหว)
//! หน้าจอเรียก `scan_children` เพื่อขอเฉพาะระดับที่กำลังดู

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use weakclean_scanner::{scan, DriveInfo, ExtStat, FileEntry, NodeView, Progress, ProgressSnapshot, ScanOptions, ScanResult};

const EVENT_PROGRESS: &str = "scan://progress";
const EVENT_DONE: &str = "scan://done";
/// จำนวนโฟลเดอร์ย่อยสูงสุดที่ส่งต่อหนึ่งคำขอ (ที่เหลือรวมเป็น `rest`)
const MAX_CHILDREN: usize = 300;

struct Running {
    cancel: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct ScanState {
    running: Mutex<Option<Running>>,
    pub last: Mutex<Option<Arc<ScanResult>>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    root_path: String,
    size: u64,
    allocated: u64,
    files: u64,
    dirs: u64,
    cloud_size: u64,
    cloud_files: u64,
    errors: u64,
    hardlink_dupes: u64,
    cluster_size: u64,
    elapsed_ms: u64,
    cancelled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Children {
    /// ตัวโฟลเดอร์ที่ขอ (ใช้แสดงยอดรวม และไฟล์ที่อยู่ตรงๆ ในโฟลเดอร์นั้น)
    node: NodeView,
    children: Vec<NodeView>,
    /// โฟลเดอร์ย่อยที่เกิน MAX_CHILDREN รวมเป็นก้อนเดียว
    rest: Option<NodeView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    top_files: Vec<FileEntry>,
    extensions: Vec<ExtStat>,
}

#[tauri::command]
pub fn list_drives() -> Vec<DriveInfo> {
    weakclean_scanner::list_drives()
}

/// เริ่มสแกน (ทำงานเบื้องหลัง) — ความคืบหน้าส่งทาง event `scan://progress` และจบด้วย `scan://done`
#[tauri::command]
pub fn start_scan(app: AppHandle, state: State<'_, ScanState>, path: String) -> Result<(), String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("not a folder: {path}"));
    }

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut running = state.running.lock().unwrap();
        if running.is_some() {
            return Err("a scan is already running".into());
        }
        *running = Some(Running { cancel: cancel.clone() });
    }

    let root = root.to_path_buf();
    let state_app = app.clone();
    std::thread::spawn(move || {
        let progress = Arc::new(Progress::default());
        let finished = Arc::new(AtomicBool::new(false));

        let reporter = {
            let (app, progress, finished) = (app.clone(), progress.clone(), finished.clone());
            std::thread::spawn(move || {
                while !finished.load(Ordering::Relaxed) {
                    let snap: ProgressSnapshot = progress.snapshot();
                    let _ = app.emit(EVENT_PROGRESS, snap);
                    std::thread::sleep(Duration::from_millis(150));
                }
            })
        };

        let result = scan(&root, &ScanOptions::default(), &progress, &cancel);
        finished.store(true, Ordering::Relaxed);
        let _ = reporter.join();

        let st = state_app.state::<ScanState>();
        *st.running.lock().unwrap() = None;

        match result {
            Ok(r) => {
                let summary = ScanSummary {
                    root_path: r.root_path.clone(),
                    size: r.root.size,
                    allocated: r.root.allocated,
                    files: r.root.files,
                    dirs: r.root.dirs,
                    cloud_size: r.root.cloud_size,
                    cloud_files: r.root.cloud_files,
                    errors: r.errors,
                    hardlink_dupes: r.hardlink_dupes,
                    cluster_size: r.cluster_size,
                    elapsed_ms: r.elapsed_ms,
                    cancelled: r.cancelled,
                };
                if !r.cancelled {
                    crate::extra_cmd::record_snapshot(&state_app, &r);
                    *st.last.lock().unwrap() = Some(Arc::new(r));
                }
                let _ = state_app.emit(EVENT_DONE, summary);
            }
            Err(e) => {
                let _ = state_app.emit(EVENT_DONE, ScanFailure { error: e.to_string() });
            }
        }
    });
    Ok(())
}

#[derive(Serialize, Clone)]
struct ScanFailure {
    error: String,
}

#[tauri::command]
pub fn cancel_scan(state: State<'_, ScanState>) {
    if let Some(r) = state.running.lock().unwrap().as_ref() {
        r.cancel.store(true, Ordering::Relaxed);
    }
}

/// ดูโฟลเดอร์ย่อยของ `path` (รายชื่อโฟลเดอร์ไล่จากราก; ว่าง = ราก)
#[tauri::command]
pub fn scan_children(state: State<'_, ScanState>, path: Vec<String>) -> Result<Children, String> {
    let last = state.last.lock().unwrap().clone().ok_or("no scan result yet")?;
    let node = last.root.find(&path).ok_or("folder not found in the last scan")?;

    let children = node.children.iter().take(MAX_CHILDREN).map(|c| c.view()).collect();
    let rest = (node.children.len() > MAX_CHILDREN).then(|| {
        let mut agg = NodeView {
            name: String::new(),
            size: 0,
            allocated: 0,
            files: 0,
            dirs: 0,
            own_size: 0,
            own_files: 0,
            cloud_size: 0,
            cloud_files: 0,
            has_children: false,
        };
        for c in &node.children[MAX_CHILDREN..] {
            agg.size += c.size;
            agg.allocated += c.allocated;
            agg.files += c.files;
            agg.dirs += c.dirs + 1;
        }
        agg
    });
    Ok(Children { node: node.view(), children, rest })
}

#[tauri::command]
pub fn scan_overview(state: State<'_, ScanState>) -> Result<Overview, String> {
    let last = state.last.lock().unwrap().clone().ok_or("no scan result yet")?;
    Ok(Overview { top_files: last.top_files.clone(), extensions: last.extensions.clone() })
}

/// เปิดโฟลเดอร์ใน Explorer (ถ้าเป็นไฟล์จะเลือกไฟล์นั้นให้)
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("path not found: {path}"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("explorer");
        // explorer ต้องการ /select,"path" แบบมีเครื่องหมายคำพูดเฉพาะส่วน path
        if p.is_dir() {
            cmd.raw_arg(format!("\"{path}\""));
        } else {
            cmd.raw_arg(format!("/select,\"{path}\""));
        }
        cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        Err("only supported on Windows".into())
    }
}

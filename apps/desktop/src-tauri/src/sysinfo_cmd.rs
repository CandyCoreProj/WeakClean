//! ข้อมูลเครื่อง (OS, CPU, GPU, RAM) สำหรับหน้าแรก — อ่านอย่างเดียวจาก registry / Windows API

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    os: String,
    cpu: String,
    gpus: Vec<String>,
    ram_bytes: u64,
    threads: u32,
}

#[cfg(windows)]
fn read() -> SystemInfo {
    use weakclean_tweaks::{Hive, RegData, System, WinSystem};
    let sys = WinSystem;
    let text = |path: &str, name: &str| match sys.reg_get(Hive::HKLM, path, name) {
        Ok(Some(RegData::Sz(s))) => Some(s.trim().to_string()).filter(|s| !s.is_empty()),
        _ => None,
    };

    let nt = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
    let build: u32 = text(nt, "CurrentBuildNumber").or_else(|| text(nt, "CurrentBuild")).and_then(|b| b.parse().ok()).unwrap_or(0);
    let mut name = text(nt, "ProductName").unwrap_or_else(|| "Windows".into());
    // Windows 11 ยังเขียน ProductName ว่า "Windows 10 ..." ใน registry — build 22000 ขึ้นไปคือ Windows 11
    if build >= 22000 {
        name = name.replace("Windows 10", "Windows 11");
    }
    let os = match text(nt, "DisplayVersion") {
        Some(v) => format!("{name} {v}"),
        None => name,
    };

    let cpu = text(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString").unwrap_or_else(|| "—".into());

    // การ์ดจอ: ไล่ดู class ของ display adapter (0000, 0001, …)
    let class = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";
    let mut gpus: Vec<String> = Vec::new();
    for i in 0..16 {
        if let Some(d) = text(&format!(r"{class}\{i:04}"), "DriverDesc") {
            let lower = d.to_lowercase();
            if !lower.contains("basic display") && !lower.contains("remote display") && !gpus.contains(&d) {
                gpus.push(d);
            }
        }
    }

    SystemInfo {
        os,
        cpu,
        gpus,
        ram_bytes: total_ram(),
        threads: std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(0),
    }
}

#[cfg(windows)]
fn total_ram() -> u64 {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut m: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    m.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    if unsafe { GlobalMemoryStatusEx(&mut m) } == 0 {
        return 0;
    }
    m.ullTotalPhys
}

#[cfg(not(windows))]
fn read() -> SystemInfo {
    SystemInfo { os: std::env::consts::OS.into(), cpu: "—".into(), gpus: Vec::new(), ram_bytes: 0, threads: 0 }
}

#[tauri::command]
pub fn system_info() -> SystemInfo {
    read()
}

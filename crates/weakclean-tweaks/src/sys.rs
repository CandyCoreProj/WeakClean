//! ชั้นที่แตะระบบ Windows จริง (registry, services, สิทธิ์ผู้ดูแล, restore point) ซ่อนไว้หลัง trait `System`
//! เพื่อให้ engine ทดสอบกับระบบจำลองได้โดยไม่ต้องแตะเครื่องจริง

use serde::{Deserialize, Serialize};
use std::io;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Hive {
    HKCU,
    HKLM,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum RegData {
    Dword(u32),
    Sz(String),
}

impl RegData {
    /// ข้อความสำหรับแสดงในประวัติ เช่น "0", "0xffffffff", "\"0\""
    pub fn show(&self) -> String {
        match self {
            RegData::Dword(v) if *v > 0xFFFF => format!("0x{v:x}"),
            RegData::Dword(v) => v.to_string(),
            RegData::Sz(s) => format!("\"{s}\""),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StartType {
    Auto,
    Manual,
    Disabled,
}

impl StartType {
    pub fn label(self) -> &'static str {
        match self {
            StartType::Auto => "Automatic",
            StartType::Manual => "Manual",
            StartType::Disabled => "Disabled",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SvcState {
    pub start: StartType,
    pub running: bool,
}

pub trait System: Send + Sync {
    fn is_elevated(&self) -> bool;
    /// None = ไม่มีค่านี้ (หรือไม่มี key)
    fn reg_get(&self, hive: Hive, path: &str, name: &str) -> io::Result<Option<RegData>>;
    /// สร้าง key ที่ยังไม่มีให้เอง
    fn reg_set(&self, hive: Hive, path: &str, name: &str, data: &RegData) -> io::Result<()>;
    /// ลบค่า (ไม่มีอยู่แล้วถือว่าสำเร็จ)
    fn reg_delete_value(&self, hive: Hive, path: &str, name: &str) -> io::Result<()>;
    fn reg_key_exists(&self, hive: Hive, path: &str) -> bool;
    /// ลบ key ที่ว่างเปล่า (ไม่ลบแบบ recursive)
    fn reg_delete_key(&self, hive: Hive, path: &str) -> io::Result<()>;
    /// None = ไม่มีบริการนี้ในเครื่อง
    fn svc_get(&self, name: &str) -> io::Result<Option<SvcState>>;
    fn svc_set_start(&self, name: &str, start: StartType) -> io::Result<()>;
    fn svc_stop(&self, name: &str) -> io::Result<()>;
    fn svc_start(&self, name: &str) -> io::Result<()>;
    /// สร้างจุดคืนค่าของ Windows (ต้องเป็นผู้ดูแลและเปิด System Protection ไว้)
    fn create_restore_point(&self, description: &str) -> io::Result<()>;
}

#[cfg(windows)]
pub use win::WinSystem;

#[cfg(windows)]
mod win {
    use super::*;
    use std::ffi::c_void;
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows_sys::Win32::System::Registry::*;
    use windows_sys::Win32::System::Services::*;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    const ERROR_FILE_NOT_FOUND: u32 = 2;
    const ERROR_PATH_NOT_FOUND: u32 = 3;
    const ERROR_SERVICE_DOES_NOT_EXIST: u32 = 1060;
    const ERROR_SERVICE_NOT_ACTIVE: u32 = 1062;
    const ERROR_SERVICE_ALREADY_RUNNING: u32 = 1056;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    pub struct WinSystem;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }
    fn os_err(code: u32) -> io::Error {
        io::Error::from_raw_os_error(code as i32)
    }
    fn root(h: Hive) -> HKEY {
        match h {
            Hive::HKCU => HKEY_CURRENT_USER,
            Hive::HKLM => HKEY_LOCAL_MACHINE,
        }
    }

    struct Key(HKEY);
    impl Drop for Key {
        fn drop(&mut self) {
            unsafe { RegCloseKey(self.0) };
        }
    }

    /// เปิด key; Ok(None) ถ้าไม่มี key นั้น
    fn open(h: Hive, path: &str, access: u32) -> io::Result<Option<Key>> {
        let mut out: HKEY = std::ptr::null_mut();
        let rc = unsafe { RegOpenKeyExW(root(h), wide(path).as_ptr(), 0, access | KEY_WOW64_64KEY, &mut out) };
        match rc {
            0 => Ok(Some(Key(out))),
            ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => Ok(None),
            e => Err(os_err(e)),
        }
    }

    struct Svc(SC_HANDLE);
    impl Drop for Svc {
        fn drop(&mut self) {
            unsafe { CloseServiceHandle(self.0) };
        }
    }

    /// เปิดบริการ; Ok(None) ถ้าไม่มีบริการนี้
    fn open_service(name: &str, access: u32) -> io::Result<Option<Svc>> {
        let scm = unsafe { OpenSCManagerW(std::ptr::null(), std::ptr::null(), SC_MANAGER_CONNECT) };
        if scm.is_null() {
            return Err(io::Error::last_os_error());
        }
        let scm = Svc(scm);
        let h = unsafe { OpenServiceW(scm.0, wide(name).as_ptr(), access) };
        if h.is_null() {
            let code = io::Error::last_os_error().raw_os_error().unwrap_or(0) as u32;
            return if code == ERROR_SERVICE_DOES_NOT_EXIST { Ok(None) } else { Err(os_err(code)) };
        }
        Ok(Some(Svc(h)))
    }

    impl System for WinSystem {
        fn is_elevated(&self) -> bool {
            unsafe {
                let mut token: HANDLE = std::ptr::null_mut();
                if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                    return false;
                }
                let mut e = TOKEN_ELEVATION { TokenIsElevated: 0 };
                let mut ret = 0u32;
                let ok = GetTokenInformation(token, TokenElevation, &mut e as *mut _ as *mut c_void, std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut ret);
                CloseHandle(token);
                ok != 0 && e.TokenIsElevated != 0
            }
        }

        fn reg_get(&self, hive: Hive, path: &str, name: &str) -> io::Result<Option<RegData>> {
            let Some(key) = open(hive, path, KEY_QUERY_VALUE)? else { return Ok(None) };
            let name_w = wide(name);
            let (mut ty, mut len) = (0u32, 0u32);
            let rc = unsafe { RegQueryValueExW(key.0, name_w.as_ptr(), std::ptr::null(), &mut ty, std::ptr::null_mut(), &mut len) };
            match rc {
                0 => {}
                ERROR_FILE_NOT_FOUND => return Ok(None),
                e => return Err(os_err(e)),
            }
            let mut buf = vec![0u8; len as usize + 2];
            let mut len2 = buf.len() as u32;
            let rc = unsafe { RegQueryValueExW(key.0, name_w.as_ptr(), std::ptr::null(), &mut ty, buf.as_mut_ptr(), &mut len2) };
            if rc != 0 {
                return Err(os_err(rc));
            }
            buf.truncate(len2 as usize);
            match ty {
                REG_DWORD if buf.len() >= 4 => Ok(Some(RegData::Dword(u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]])))),
                REG_SZ | REG_EXPAND_SZ => {
                    let units: Vec<u16> = buf.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
                    let end = units.iter().position(|&c| c == 0).unwrap_or(units.len());
                    Ok(Some(RegData::Sz(String::from_utf16_lossy(&units[..end]))))
                }
                // ชนิดอื่นที่เรากู้คืนให้เหมือนเดิมไม่ได้ → ไม่แตะ
                _ => Err(io::Error::new(io::ErrorKind::InvalidData, "unsupported registry value type")),
            }
        }

        fn reg_set(&self, hive: Hive, path: &str, name: &str, data: &RegData) -> io::Result<()> {
            let mut out: HKEY = std::ptr::null_mut();
            let rc = unsafe {
                RegCreateKeyExW(root(hive), wide(path).as_ptr(), 0, std::ptr::null(), REG_OPTION_NON_VOLATILE, KEY_SET_VALUE | KEY_WOW64_64KEY, std::ptr::null(), &mut out, std::ptr::null_mut())
            };
            if rc != 0 {
                return Err(os_err(rc));
            }
            let key = Key(out);
            let (ty, bytes): (u32, Vec<u8>) = match data {
                RegData::Dword(v) => (REG_DWORD, v.to_le_bytes().to_vec()),
                RegData::Sz(s) => (REG_SZ, wide(s).iter().flat_map(|u| u.to_le_bytes()).collect()),
            };
            let rc = unsafe { RegSetValueExW(key.0, wide(name).as_ptr(), 0, ty, bytes.as_ptr(), bytes.len() as u32) };
            if rc != 0 {
                return Err(os_err(rc));
            }
            Ok(())
        }

        fn reg_delete_value(&self, hive: Hive, path: &str, name: &str) -> io::Result<()> {
            let Some(key) = open(hive, path, KEY_SET_VALUE)? else { return Ok(()) };
            match unsafe { RegDeleteValueW(key.0, wide(name).as_ptr()) } {
                0 | ERROR_FILE_NOT_FOUND => Ok(()),
                e => Err(os_err(e)),
            }
        }

        fn reg_key_exists(&self, hive: Hive, path: &str) -> bool {
            matches!(open(hive, path, KEY_QUERY_VALUE), Ok(Some(_)))
        }

        fn reg_delete_key(&self, hive: Hive, path: &str) -> io::Result<()> {
            match unsafe { RegDeleteKeyExW(root(hive), wide(path).as_ptr(), KEY_WOW64_64KEY, 0) } {
                0 | ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => Ok(()),
                e => Err(os_err(e)),
            }
        }

        fn svc_get(&self, name: &str) -> io::Result<Option<SvcState>> {
            let Some(svc) = open_service(name, SERVICE_QUERY_CONFIG | SERVICE_QUERY_STATUS)? else { return Ok(None) };
            // อ่านค่าตั้งต้น (ขนาดบัฟเฟอร์ไม่แน่นอน เรียกสองรอบ)
            let mut needed = 0u32;
            unsafe { QueryServiceConfigW(svc.0, std::ptr::null_mut(), 0, &mut needed) };
            let mut buf = vec![0u8; needed.max(8192) as usize];
            if unsafe { QueryServiceConfigW(svc.0, buf.as_mut_ptr() as *mut QUERY_SERVICE_CONFIGW, buf.len() as u32, &mut needed) } == 0 {
                return Err(io::Error::last_os_error());
            }
            let start_raw = unsafe { (*(buf.as_ptr() as *const QUERY_SERVICE_CONFIGW)).dwStartType };
            let start = match start_raw {
                SERVICE_AUTO_START => StartType::Auto,
                SERVICE_DEMAND_START => StartType::Manual,
                SERVICE_DISABLED => StartType::Disabled,
                // boot/system start = บริการของไดรเวอร์ ไม่ใช่เป้าหมายของเรา
                _ => return Err(io::Error::new(io::ErrorKind::InvalidData, "unsupported service start type")),
            };
            let mut st: SERVICE_STATUS_PROCESS = unsafe { std::mem::zeroed() };
            let mut sz = 0u32;
            if unsafe { QueryServiceStatusEx(svc.0, SC_STATUS_PROCESS_INFO, &mut st as *mut _ as *mut u8, std::mem::size_of::<SERVICE_STATUS_PROCESS>() as u32, &mut sz) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(Some(SvcState { start, running: st.dwCurrentState == SERVICE_RUNNING }))
        }

        fn svc_set_start(&self, name: &str, start: StartType) -> io::Result<()> {
            let svc = open_service(name, SERVICE_CHANGE_CONFIG)?.ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "service not found"))?;
            let t = match start {
                StartType::Auto => SERVICE_AUTO_START,
                StartType::Manual => SERVICE_DEMAND_START,
                StartType::Disabled => SERVICE_DISABLED,
            };
            let ok = unsafe { ChangeServiceConfigW(svc.0, SERVICE_NO_CHANGE, t, SERVICE_NO_CHANGE, std::ptr::null(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null()) };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }

        fn svc_stop(&self, name: &str) -> io::Result<()> {
            let Some(svc) = open_service(name, SERVICE_STOP)? else { return Ok(()) };
            let mut st: SERVICE_STATUS = unsafe { std::mem::zeroed() };
            if unsafe { ControlService(svc.0, SERVICE_CONTROL_STOP, &mut st) } == 0 {
                let code = io::Error::last_os_error().raw_os_error().unwrap_or(0) as u32;
                if code != ERROR_SERVICE_NOT_ACTIVE {
                    return Err(os_err(code));
                }
            }
            Ok(())
        }

        fn svc_start(&self, name: &str) -> io::Result<()> {
            let Some(svc) = open_service(name, SERVICE_START)? else { return Ok(()) };
            if unsafe { StartServiceW(svc.0, 0, std::ptr::null()) } == 0 {
                let code = io::Error::last_os_error().raw_os_error().unwrap_or(0) as u32;
                if code != ERROR_SERVICE_ALREADY_RUNNING {
                    return Err(os_err(code));
                }
            }
            Ok(())
        }

        fn create_restore_point(&self, description: &str) -> io::Result<()> {
            let safe: String = description.chars().filter(|c| !matches!(c, '\'' | '"' | '`' | '$')).collect();
            let script = format!("Checkpoint-Computer -Description '{safe}' -RestorePointType MODIFY_SETTINGS -ErrorAction Stop");
            let out = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
                .creation_flags(CREATE_NO_WINDOW)
                .output()?;
            if out.status.success() {
                Ok(())
            } else {
                Err(io::Error::other(String::from_utf8_lossy(&out.stderr).trim().to_string()))
            }
        }
    }
}
